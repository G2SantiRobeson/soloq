import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  achievementEvidenceHeaders as headers,
  achievementEvidenceUnits as units,
  players,
  matches,
  playerMatches,
} from "@/db/schema";
import { RANKED_QUEUES, type RankedQueue } from "@/lib/queues";
import { CURRENT_SEASON } from "@/lib/season";
import { RiotClient } from "../riot/client";
import {
  MatchCaptureError,
  MATCH_CAPTURE_VERSION,
  validStoredMatchKey,
  type MatchCaptureHandle,
  type MatchCaptureRecord,
} from "../riot/match-capture";
import { leaseContext, type SyncTransaction } from "./progress";
import { lockSourcePlayers, markSourceChanged } from "./source-revision";
import {
  assertEvidenceCapacityInTx,
  conservativeEvidenceBytes,
} from "../achievements/verification/evidence-in-tx";
import { localCanonical, LOCAL_LIMITS } from "../achievements/verification/persistence-contracts";

const scanSchema = z
  .strictObject({
    version: z.literal(MATCH_CAPTURE_VERSION),
    scanId: z.uuid(),
    phase: z.enum(["recent", "season_backfill", "incremental_repair"]),
    from: z.iso.datetime({ precision: 3 }),
    to: z.iso.datetime({ precision: 3 }),
    lifecycle: z.enum(["active", "import_finished", "interrupted"]),
    prefix: z.enum(["observed_from_zero", "prefix_unknown"]),
    initialOffset: z.number().int().nonnegative(),
    initialPending: z.array(z.string().max(64)).max(100),
    finishedAt: z.iso.datetime({ precision: 3 }).nullable(),
    certification: z.literal("not_established"),
    grantAuthorized: z.literal(false),
    recoverableCoverage: z.literal("not_established"),
  })
  .refine(
    (v) =>
      Date.parse(v.from) < Date.parse(v.to) &&
      (v.lifecycle === "import_finished") === (v.finishedAt !== null),
  );
type ScanData = z.infer<typeof scanSchema>;
export type MatchScan = {
  playerId: string;
  platform: typeof players.$inferSelect.platform;
  from: string;
  to: string;
  roots: { id: string; queue: RankedQueue }[];
};
export type MatchDisposition =
  | "pending"
  | "unknown"
  | "unavailable_404"
  | "resolved"
  | "excluded_with_basis"
  | "reused_without_attestation";
type NewUnit = {
  key: string;
  kind: "page" | "disposition";
  entity: string | null;
  offset: number | null;
  attempt: number | null;
  data: Record<string, unknown>;
};
const digest = (data: unknown) => createHash("sha256").update(localCanonical(data)).digest("hex");
const parseScan = (data: unknown): ScanData => {
  const parsed = scanSchema.safeParse(data);
  if (!parsed.success) throw new MatchCaptureError("lifecycle");
  return parsed.data;
};

/** Lease is acquired by SW. No network/tx/savepoint/revision UPDATE inside these primitives. */
async function ownerInTx(
  tx: SyncTransaction,
  client: RiotClient,
  scan: Pick<MatchScan, "playerId" | "platform">,
) {
  await lockSourcePlayers(tx, [scan.playerId]);
  const [p] = await tx
    .select({
      id: players.id,
      platform: players.platform,
      puuid: players.puuid,
      enabled: players.enabled,
      revision: players.sourceRevision,
    })
    .from(players)
    .where(eq(players.id, scan.playerId));
  if (!p || p.platform !== scan.platform || !p.enabled) throw new MatchCaptureError("scope");
  void client; // Fencing belongs exclusively to the existing SW.
  return p;
}
export async function openMatchScansInTx(
  tx: SyncTransaction,
  client: RiotClient,
  player: typeof players.$inferSelect,
  phase: ScanData["phase"],
  from: Date,
  to: Date,
  offset = 0,
  pending: string[] = [],
  exhausted = false,
): Promise<MatchScan> {
  const scan: MatchScan = {
    playerId: player.id,
    platform: player.platform,
    from: from.toISOString(),
    to: to.toISOString(),
    roots: [],
  };
  if (from >= to || pending.some((id) => !validStoredMatchKey(id)))
    throw new MatchCaptureError("invalid");
  await ownerInTx(tx, client, scan);
  const candidates = await tx
    .select()
    .from(headers)
    .where(
      and(
        eq(headers.playerId, player.id),
        eq(headers.version, MATCH_CAPTURE_VERSION),
        sql`${headers.data}->>'phase' = ${phase}`,
      ),
    )
    .orderBy(asc(headers.id))
    .for("update");
  for (const queue of RANKED_QUEUES) {
    const active = candidates.filter(
      (h) => h.queue === queue && parseScan(h.data).lifecycle === "active",
    );
    if (active.length > 1) throw new MatchCaptureError("lifecycle");
    const prior = active[0];
    if (
      prior &&
      (prior.kind !== "match_scan" ||
        prior.status !== "collecting" ||
        parseScan(prior.data).from !== prior.from?.toISOString() ||
        parseScan(prior.data).to !== prior.to?.toISOString())
    )
      throw new MatchCaptureError("lifecycle");
    const matching =
      prior &&
      prior.platform === player.platform &&
      prior.season === CURRENT_SEASON.id &&
      prior.from?.getTime() === from.getTime() &&
      prior.to?.getTime() === to.getTime();
    if (prior && !matching) {
      const next = { ...parseScan(prior.data), lifecycle: "interrupted" };
      await assertEvidenceCapacityInTx(
        tx,
        player.id,
        prior.id,
        0,
        0,
        Math.max(0, conservativeEvidenceBytes(next) - conservativeEvidenceBytes(prior.data)),
      );
      await tx.update(headers).set({ data: next }).where(eq(headers.id, prior.id));
      markSourceChanged(tx, player.id);
    }
    if (matching) {
      scan.roots.push({ id: prior.id, queue });
      continue;
    }
    const data: ScanData = {
      version: MATCH_CAPTURE_VERSION,
      scanId: randomUUID(),
      phase,
      from: scan.from,
      to: scan.to,
      lifecycle: "active",
      prefix:
        offset > 0 || pending.length > 0 || exhausted ? "prefix_unknown" : "observed_from_zero",
      initialOffset: offset,
      initialPending: [...pending],
      finishedAt: null,
      certification: "not_established",
      grantAuthorized: false,
      recoverableCoverage: "not_established",
    };
    parseScan(data); // Validate new roots too, before any cursor/evidence commit.
    if (conservativeEvidenceBytes(data) > LOCAL_LIMITS.headerBytes)
      throw new MatchCaptureError("limit");
    await assertEvidenceCapacityInTx(tx, player.id, null, 1, 0, conservativeEvidenceBytes(data));
    const [h] = await tx
      .insert(headers)
      .values({
        playerId: player.id,
        platform: player.platform,
        queue,
        season: CURRENT_SEASON.id,
        kind: "match_scan",
        status: "collecting",
        source: "unknown",
        version: MATCH_CAPTURE_VERSION,
        operationKey: `match:${data.scanId}`,
        from,
        to,
        data,
      })
      .returning({ id: headers.id });
    scan.roots.push({ id: h.id, queue });
    markSourceChanged(tx, player.id);
  }
  return scan;
}

async function appendInTx(
  tx: SyncTransaction,
  client: RiotClient,
  scan: MatchScan,
  root: MatchScan["roots"][number],
  proposed: NewUnit[],
) {
  await ownerInTx(tx, client, scan);
  const [h] = await tx
    .select()
    .from(headers)
    .where(
      and(
        eq(headers.id, root.id),
        eq(headers.playerId, scan.playerId),
        eq(headers.platform, scan.platform),
        eq(headers.queue, root.queue),
        eq(headers.season, CURRENT_SEASON.id),
      ),
    )
    .for("update");
  if (
    !h ||
    h.version !== MATCH_CAPTURE_VERSION ||
    h.kind !== "match_scan" ||
    h.status !== "collecting" ||
    h.from?.toISOString() !== scan.from ||
    h.to?.toISOString() !== scan.to
  )
    throw new MatchCaptureError("scope");
  const metadata = parseScan(h.data);
  if (metadata.lifecycle !== "active" || metadata.from !== scan.from || metadata.to !== scan.to)
    throw new MatchCaptureError("lifecycle");
  if (new Set(proposed.map((p) => p.key)).size !== proposed.length)
    throw new MatchCaptureError("conflict");
  const entities = [...new Set(proposed.flatMap((p) => (p.entity === null ? [] : [p.entity])))];
  const old = proposed.length
    ? await tx
        .select()
        .from(units)
        .where(
          and(
            eq(units.headerId, h.id),
            or(
              inArray(
                units.unitKey,
                proposed.map((p) => p.key),
              ),
              entities.length ? inArray(units.entityKey, entities) : undefined,
              proposed.some((p) => p.kind === "page") ? eq(units.kind, "page") : undefined,
            ),
          ),
        )
        .orderBy(asc(units.ordinal))
    : [];
  // Fail closed on tampered/version-mixed rows before extending their causal chain.
  const predecessors = new Map<string, string>();
  for (const u of old) {
    if (u.data.version !== MATCH_CAPTURE_VERSION || u.fingerprint !== digest(u.data))
      throw new MatchCaptureError("conflict");
    if (u.kind === "disposition" && u.entityKey && entities.includes(u.entityKey)) {
      if ((predecessors.get(u.entityKey) ?? null) !== u.previousUnitId)
        throw new MatchCaptureError("conflict");
      predecessors.set(u.entityKey, u.id);
    }
  }
  const [counts] = await tx
    .select({ ordinal: sql<number>`coalesce(max(${units.ordinal}), -1)` })
    .from(units)
    .where(eq(units.headerId, h.id));
  let ordinal = Number(counts.ordinal) + 1;
  const fresh: (typeof units.$inferInsert)[] = [];
  const tail = new Map<string, typeof units.$inferSelect>();
  for (const u of old) if (u.kind === "disposition" && u.entityKey) tail.set(u.entityKey, u);
  for (const input of proposed) {
    const retry = old.find((u) => u.unitKey === input.key);
    const core = { version: MATCH_CAPTURE_VERSION, ...input.data };
    if (retry) {
      const { indexComparison: ignored, ...stored } = retry.data;
      void ignored;
      if (
        retry.fingerprint !== digest(retry.data) ||
        localCanonical(stored) !== localCanonical(core)
      )
        throw new MatchCaptureError("conflict");
      continue;
    }
    const changedPage =
      input.kind === "page" &&
      old.some(
        (u) =>
          u.kind === "page" &&
          u.offset === input.offset &&
          localCanonical((u.data.record as MatchCaptureRecord).ids) !==
            localCanonical((input.data.record as MatchCaptureRecord).ids),
      );
    const data = {
      version: MATCH_CAPTURE_VERSION,
      ...input.data,
      ...(input.kind === "page"
        ? { indexComparison: changedPage ? "requires_review" : "unproven" }
        : {}),
    };
    if (conservativeEvidenceBytes(data) > LOCAL_LIMITS.unitBytes)
      throw new MatchCaptureError("limit");
    const hash = digest(data);
    // A changed page is retained as another attempt, never overwritten or silently selected.
    const previous = input.entity ? tail.get(input.entity) : undefined;
    const id = randomUUID();
    const u: typeof units.$inferInsert = {
      id,
      playerId: scan.playerId,
      platform: scan.platform,
      queue: root.queue,
      season: CURRENT_SEASON.id,
      headerId: h.id,
      unitKey: input.key,
      kind: input.kind,
      ordinal: ordinal++,
      offset: input.offset,
      attempt:
        input.kind === "page"
          ? Math.max(
              0,
              ...old
                .filter((u) => u.kind === "page" && u.offset === input.offset)
                .map((u) => u.attempt ?? 0),
            ) + 1
          : null,
      entityKey: input.entity,
      previousUnitId: previous?.id ?? null,
      revision: 0n,
      fingerprint: hash,
      data,
    };
    fresh.push(u);
    // Proposed entity keys are unique in the pending/detail batches; chain is persisted in causal order.
  }
  if (!fresh.length) return;
  await assertEvidenceCapacityInTx(
    tx,
    scan.playerId,
    h.id,
    0,
    fresh.length,
    fresh.reduce((n, u) => n + conservativeEvidenceBytes(u.data), 0),
  );
  const [destination] = await tx
    .select({ revision: sql<string>`(${players.sourceRevision} + 1)::text` })
    .from(players)
    .where(eq(players.id, scan.playerId));
  for (const u of fresh) u.revision = BigInt(destination.revision);
  for (let i = 0; i < fresh.length; i += 100)
    await tx.insert(units).values(fresh.slice(i, i + 100));
  markSourceChanged(tx, scan.playerId);
}
export async function captureReusedInTx(
  tx: SyncTransaction,
  client: RiotClient,
  scan: MatchScan,
  matchIds: string[],
  operationKey: string,
) {
  if (matchIds.length > 100 || matchIds.some((id) => !validStoredMatchKey(id)))
    throw new MatchCaptureError("invalid");
  for (const root of [...scan.roots].sort((a, b) => a.id.localeCompare(b.id))) {
    await appendInTx(
      tx,
      client,
      scan,
      root,
      [...new Set(matchIds)].map((matchId) => ({
        key: `reuse:${operationKey}:${matchId}`,
        kind: "disposition",
        entity: matchId,
        offset: null,
        attempt: null,
        data: {
          state: "reused_without_attestation",
          matchId,
          record: null,
          sourceConfirmation: "legacy_no_reception",
          certification: "not_established",
          grantAuthorized: false,
        },
      })),
    );
  }
}

function captureInput(
  client: RiotClient,
  scan: MatchScan,
  player: typeof players.$inferSelect,
  handle: MatchCaptureHandle,
) {
  const record = client.confirmedMatchInput(handle, {
    playerId: scan.playerId,
    platform: scan.platform,
    puuid: player.puuid,
  });
  if (record.source === "server_riot_received" && !leaseContext(client))
    throw new MatchCaptureError("unleased");
  return record;
}
async function verifyBindingInTx(
  tx: SyncTransaction,
  client: RiotClient,
  scan: MatchScan,
  player: typeof players.$inferSelect,
  handle: MatchCaptureHandle,
) {
  const p = await ownerInTx(tx, client, scan);
  if (p.puuid !== player.puuid) throw new MatchCaptureError("scope");
  return captureInput(client, scan, player, handle);
}
export async function capturePageInTx(
  tx: SyncTransaction,
  client: RiotClient,
  scan: MatchScan,
  player: typeof players.$inferSelect,
  handle: MatchCaptureHandle,
) {
  const record = await verifyBindingInTx(tx, client, scan, player, handle);
  if (
    record.endpoint !== "MATCH-V5-IDS" ||
    !record.query ||
    record.query.startTime !== Math.floor(Date.parse(scan.from) / 1000) ||
    record.query.endTime !== Math.floor(Date.parse(scan.to) / 1000)
  )
    throw new MatchCaptureError("scope");
  for (const root of [...scan.roots].sort((a, b) => a.id.localeCompare(b.id))) {
    const query = record.query;
    const event: NewUnit = {
      key: `page:${record.requestId}`,
      kind: "page",
      entity: null,
      offset: query.start,
      attempt: record.receptions.length,
      data: {
        record,
        pageShape:
          record.ids === null
            ? "unknown"
            : record.ids.length === 0
              ? "empty"
              : record.ids.length < 100
                ? "short"
                : "full",
        terminalByImportPolicy: record.ids !== null && record.ids.length < 100,
        query: { ...query, queue: null, type: null, timeSemantics: "unconfirmed" },
      },
    };
    const pending: NewUnit[] = [...new Set(record.ids ?? [])].map((id) => ({
      key: `pending:${record.requestId}:${id}`,
      kind: "disposition",
      entity: id,
      offset: null,
      attempt: null,
      data: { state: "pending", matchId: id, reception: null },
    }));
    await appendInTx(tx, client, scan, root, [event, ...pending]);
  }
}
export async function captureDispositionInTx(
  tx: SyncTransaction,
  client: RiotClient,
  scan: MatchScan,
  player: typeof players.$inferSelect,
  matchId: string,
  state: MatchDisposition,
  handle: MatchCaptureHandle | null,
  operationKey: string,
) {
  if (!validStoredMatchKey(matchId) || handle === null) throw new MatchCaptureError("invalid");
  const record: MatchCaptureRecord | null = handle
    ? await verifyBindingInTx(tx, client, scan, player, handle)
    : null;
  if (record && (record.endpoint !== "MATCH-V5-DETAIL" || record.requestedMatchId !== matchId))
    throw new MatchCaptureError("scope");
  const d = record?.detail;
  let sourceConfirmed = false;
  if (state === "resolved" && d) {
    const [source] = await tx
      .select({
        queueId: matches.queueId,
        mapId: matches.mapId,
        timestamp: matches.timestamp,
        win: playerMatches.win,
        championId: playerMatches.championId,
      })
      .from(playerMatches)
      .innerJoin(matches, eq(matches.id, playerMatches.matchId))
      .where(and(eq(playerMatches.playerId, scan.playerId), eq(playerMatches.matchId, matchId)));
    sourceConfirmed =
      !!source &&
      source.queueId === d.queueId &&
      source.mapId === d.mapId &&
      source.timestamp.getTime() === d.timestampMs &&
      source.win === d.win &&
      source.championId === d.championId;
  }
  for (const root of [...scan.roots].sort((a, b) => a.id.localeCompare(b.id))) {
    let effective = state;
    const issues: string[] = [];
    if (!d) effective = record?.receptions.at(-1)?.status === 404 ? "unavailable_404" : "unknown";
    if (d) {
      if (d.matchId !== matchId || d.matchingCount !== 1) {
        issues.push("identity_or_match_ambiguous");
        effective = "unknown";
      }
      if (d.queueId !== (root.queue === "RANKED_SOLO_5x5" ? 420 : 440)) issues.push("other_queue");
      if (d.mapId !== 11 || d.gameMode !== "CLASSIC") issues.push("other_mode_map");
      if (d.timestampMs < Date.parse(scan.from) || d.timestampMs >= Date.parse(scan.to))
        issues.push("outside_target_interval");
      if (d.win === null || d.championId === null) {
        issues.push("competitive_fields_unknown");
        effective = "unknown";
      }
      if (effective === "resolved" && issues.length)
        effective =
          issues.includes("identity_or_match_ambiguous") ||
          issues.includes("competitive_fields_unknown")
            ? "unknown"
            : "excluded_with_basis";
    }
    if (
      d &&
      effective === "excluded_with_basis" &&
      !issues.some((issue) =>
        ["other_queue", "other_mode_map", "outside_target_interval"].includes(issue),
      )
    )
      effective = "unknown";
    if (effective === "resolved" && !sourceConfirmed) {
      issues.push("source_not_confirmed");
      effective = "unknown";
    }
    await appendInTx(tx, client, scan, root, [
      {
        key: `disposition:${operationKey}:${matchId}`,
        kind: "disposition",
        entity: matchId,
        offset: null,
        attempt: null,
        data: {
          state: effective,
          matchId,
          record,
          issues,
          sourceConfirmation: sourceConfirmed
            ? "stored_and_compared"
            : state === "reused_without_attestation"
              ? "legacy_no_reception"
              : "none",
          certification: "not_established",
          grantAuthorized: false,
        },
      },
    ]);
  }
}
export async function finishMatchScansInTx(
  tx: SyncTransaction,
  client: RiotClient,
  scan: MatchScan,
) {
  await ownerInTx(tx, client, scan);
  const roots = await tx
    .select()
    .from(headers)
    .where(
      and(
        eq(headers.playerId, scan.playerId),
        inArray(
          headers.id,
          scan.roots.map((r) => r.id),
        ),
      ),
    )
    .orderBy(asc(headers.id))
    .for("update");
  if (roots.length !== 2) throw new MatchCaptureError("scope");
  for (const h of roots) {
    const data = parseScan(h.data);
    if (
      h.platform !== scan.platform ||
      h.version !== MATCH_CAPTURE_VERSION ||
      h.season !== CURRENT_SEASON.id ||
      h.status !== "collecting" ||
      h.kind !== "match_scan" ||
      !scan.roots.some((r) => r.id === h.id && r.queue === h.queue) ||
      data.from !== scan.from ||
      data.to !== scan.to ||
      h.from?.toISOString() !== scan.from ||
      h.to?.toISOString() !== scan.to
    )
      throw new MatchCaptureError("lifecycle");
    if (data.lifecycle === "import_finished") continue;
    if (data.lifecycle !== "active") throw new MatchCaptureError("lifecycle");
    // Import finished is deliberately NOT scan_complete, a structural receipt or seal.
    const next = { ...data, lifecycle: "import_finished", finishedAt: new Date().toISOString() };
    await assertEvidenceCapacityInTx(
      tx,
      scan.playerId,
      h.id,
      0,
      0,
      Math.max(0, conservativeEvidenceBytes(next) - conservativeEvidenceBytes(h.data)),
    );
    await tx
      .update(headers)
      .set({
        data: next,
      })
      .where(eq(headers.id, h.id));
    markSourceChanged(tx, scan.playerId);
  }
}

/** Read-only diagnostic projection. Keeps all original events; never a grant/receipt consumer. */
export async function projectMatchDispositionsInTx(
  tx: SyncTransaction,
  headerId: string,
  playerId: string,
) {
  return tx
    .selectDistinctOn([units.entityKey], {
      matchId: units.entityKey,
      data: units.data,
      id: units.id,
    })
    .from(units)
    .where(
      and(
        eq(units.headerId, headerId),
        eq(units.playerId, playerId),
        eq(units.kind, "disposition"),
      ),
    )
    .orderBy(asc(units.entityKey), desc(units.ordinal));
}
