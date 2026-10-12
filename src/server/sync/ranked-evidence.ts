import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  players,
  matches,
  playerMatches,
  rankedSnapshots,
  achievementEvidenceHeaders as headers,
  achievementEvidenceUnits as units,
} from "@/db/schema";
import { RANKED_QUEUES, type RankedQueue } from "@/lib/queues";
import { CURRENT_SEASON } from "@/lib/season";
import type { Platform } from "@/lib/routing";
import { RiotClient } from "../riot/client";
import { MatchCaptureError, type MatchCaptureHandle } from "../riot/match-capture";
import {
  RANKED_CAPTURE_VERSION,
  REMAKE_CLASSIFIER_VERSION,
  type RankedCaptureHandle,
  type RankedRecord,
} from "../riot/ranked-capture";
import { leaseContext, type SyncTransaction } from "./progress";
import {
  lockSourcePlayers,
  markSourceChanged,
  classifyStoredRemake,
  SourceConflict,
} from "./source-revision";
import {
  assertEvidenceCapacityInTx,
  conservativeEvidenceBytes,
} from "../achievements/verification/evidence-in-tx";
import { LOCAL_LIMITS, localCanonical } from "../achievements/verification/persistence-contracts";
import { appendRankedEventInTx, findRankedEventInTx } from "./ranked-event-store";

type Player = typeof players.$inferSelect;
type Snapshot = typeof rankedSnapshots.$inferSelect;
export type SnapshotLink = { snapshot: Snapshot; inserted: boolean };
const digest = (data: unknown) => createHash("sha256").update(localCanonical(data)).digest("hex");
const restrictions = { certification: "not_established", grantAuthorized: false } as const;
// Stable opaque projection ID; reception IDs themselves remain the original server UUIDs.
function projectionId(requestId: string, playerId: string, queue: RankedQueue) {
  const hex = digest({ requestId, playerId, queue }).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function authorized(client: RiotClient, record: Pick<RankedRecord, "source" | "receptions">) {
  // Unobserved method fixtures remain unknown, not an operational producer.
  if (
    (record.source !== "unknown" || record.receptions.some((r) => r.outcome !== "unobserved")) &&
    !leaseContext(client)
  )
    throw new MatchCaptureError("unleased");
}
async function owner(tx: SyncTransaction, player: Player) {
  await lockSourcePlayers(tx, [player.id]);
  const [stored] = await tx.select().from(players).where(eq(players.id, player.id));
  if (!stored || stored.platform !== player.platform || stored.puuid !== player.puuid)
    throw new MatchCaptureError("scope");
  return stored;
}

/** One immutable owner-scoped event. Caller holds lease/player, never own tx or R UPDATE. */
async function eventInTx(
  tx: SyncTransaction,
  player: Player,
  queue: RankedQueue,
  kind: "identity_capture" | "rank_capture" | "match_scan",
  key: string,
  source: RankedRecord["source"],
  data: Record<string, unknown>,
  snapshot = false,
  parentId: string | null = null,
  identityUnitId: string | null = null,
) {
  const content = { version: RANKED_CAPTURE_VERSION, ...data, ...restrictions };
  if (kind !== "match_scan") {
    if ((parentId === null) !== (identityUnitId === null)) throw new MatchCaptureError("scope");
    const event = await appendRankedEventInTx(
      tx,
      {
        playerId: player.id,
        platform: player.platform,
        queue,
        season: CURRENT_SEASON.id,
      },
      kind,
      content,
      parentId && identityUnitId ? { headerId: parentId, unitId: identityUnitId } : null,
    );
    if (event.inserted) markSourceChanged(tx, player.id);
    return event.headerId;
  }
  key = `${key}:${queue}`;
  if (conservativeEvidenceBytes(content) > LOCAL_LIMITS.unitBytes)
    throw new MatchCaptureError("limit");
  const [existing] = await tx
    .select()
    .from(headers)
    .where(
      and(
        eq(headers.playerId, player.id),
        eq(headers.platform, player.platform),
        eq(headers.queue, queue),
        eq(headers.season, CURRENT_SEASON.id),
        eq(headers.operationKey, key),
      ),
    )
    .for("update");
  if (existing) {
    const existingUnits = await tx.select().from(units).where(eq(units.headerId, existing.id));
    const unit = existingUnits[0];
    if (
      existing.kind !== kind ||
      existing.version !== RANKED_CAPTURE_VERSION ||
      existing.source !== source ||
      existing.status !== "collecting" ||
      existing.parentId !== parentId ||
      localCanonical(existing.data) !== localCanonical(content) ||
      existingUnits.length !== 1 ||
      !unit ||
      unit.kind !== (snapshot ? "snapshot" : "disposition") ||
      unit.fingerprint !== digest(unit.data) ||
      localCanonical(unit.data) !== localCanonical(content)
    )
      throw new MatchCaptureError("conflict");
    return existing.id;
  }
  if (parentId) {
    const [parent] = await tx
      .select({ id: headers.id })
      .from(headers)
      .where(
        and(
          eq(headers.id, parentId),
          eq(headers.playerId, player.id),
          eq(headers.platform, player.platform),
          eq(headers.queue, queue),
          eq(headers.season, CURRENT_SEASON.id),
          eq(headers.kind, "identity_capture"),
        ),
      );
    if (!parent) throw new MatchCaptureError("scope");
  }
  await assertEvidenceCapacityInTx(tx, player.id, null, 1, 0, conservativeEvidenceBytes(content));
  const [h] = await tx
    .insert(headers)
    .values({
      playerId: player.id,
      platform: player.platform,
      queue,
      season: CURRENT_SEASON.id,
      kind,
      source,
      status: "collecting",
      version: RANKED_CAPTURE_VERSION,
      operationKey: key,
      parentId,
      data: content,
    })
    .returning({ id: headers.id });
  await assertEvidenceCapacityInTx(tx, player.id, h.id, 0, 1, conservativeEvidenceBytes(content));
  const [revision] = await tx
    .select({ value: sql<string>`(${players.sourceRevision} + 1)::text` })
    .from(players)
    .where(eq(players.id, player.id));
  await tx.insert(units).values({
    playerId: player.id,
    platform: player.platform,
    queue,
    season: CURRENT_SEASON.id,
    headerId: h.id,
    kind: snapshot ? "snapshot" : "disposition",
    unitKey: "event",
    ordinal: 0,
    entityKey: snapshot ? null : kind,
    revision: BigInt(revision.value),
    fingerprint: digest(content),
    data: content,
  });
  markSourceChanged(tx, player.id);
  return h.id;
}
export async function captureIdentityInTx(
  tx: SyncTransaction,
  client: RiotClient,
  player: Player,
  handle: RankedCaptureHandle,
) {
  const stored = await owner(tx, player);
  const input = client.confirmedRankedInput(handle, {
    playerId: stored.id,
    platform: stored.platform,
    puuid: stored.puuid,
  });
  if (input.record.endpoint === "LEAGUE-V4") throw new MatchCaptureError("scope");
  authorized(client, input.record);
  const ids = new Map<RankedQueue, string>();
  for (const queue of RANKED_QUEUES)
    ids.set(
      queue,
      await eventInTx(
        tx,
        stored,
        queue,
        "identity_capture",
        `identity:${input.record.requestId}`,
        input.record.source,
        {
          captureId: projectionId(input.record.requestId, stored.id, queue),
          record: input.record,
          identityMatch: input.identityMatch,
          scopeMeaning: "projection_for_ranked_queue",
        },
      ),
    );
  return { identityMatch: input.identityMatch, ids, handle };
}
export async function captureLeagueInTx(
  tx: SyncTransaction,
  client: RiotClient,
  player: Player,
  handle: RankedCaptureHandle,
  identity: Awaited<ReturnType<typeof captureIdentityInTx>> | null,
  snapshots: Map<RankedQueue, SnapshotLink> = new Map(),
) {
  const stored = await owner(tx, player);
  const { record } = client.confirmedRankedInput(handle, {
    playerId: stored.id,
    platform: stored.platform,
    puuid: stored.puuid,
  });
  if (record.endpoint !== "LEAGUE-V4") throw new MatchCaptureError("scope");
  authorized(client, record);
  const identityInput = identity
    ? client.confirmedRankedInput(identity.handle, {
        playerId: stored.id,
        platform: stored.platform,
        puuid: stored.puuid,
      })
    : null;
  if (
    identityInput &&
    (identityInput.record.endpoint === "LEAGUE-V4" ||
      identityInput.identityMatch !== identity?.identityMatch)
  )
    throw new MatchCaptureError("scope");
  for (const queue of RANKED_QUEUES) {
    const parentId = identity?.ids.get(queue) ?? null;
    let identityUnitId: string | null = null;
    if (identity) {
      const parent = parentId
        ? await findRankedEventInTx(
            tx,
            {
              playerId: stored.id,
              platform: stored.platform,
              queue,
              season: CURRENT_SEASON.id,
            },
            "identity_capture",
            identityInput!.record.requestId,
          )
        : null;
      if (
        !parent ||
        parent.header.id !== parentId ||
        parent.unit.data.identityMatch !== identity.identityMatch ||
        localCanonical(parent.unit.data.record) !== localCanonical(identityInput!.record)
      )
        throw new MatchCaptureError("scope");
      identityUnitId = parent.unit.id;
    }
    const entries = record.entries?.filter((e) => e.queue === queue) ?? null;
    const link = snapshots.get(queue);
    let snapshotData: Record<string, unknown> | null = null;
    if (link) {
      const s = link.snapshot;
      const [actual] = await tx
        .select()
        .from(rankedSnapshots)
        .where(
          and(
            eq(rankedSnapshots.id, s.id),
            eq(rankedSnapshots.playerId, player.id),
            eq(rankedSnapshots.queue, queue),
          ),
        );
      if (
        !actual ||
        localCanonical({ ...actual, timestamp: actual.timestamp.toISOString() }) !==
          localCanonical({ ...s, timestamp: s.timestamp.toISOString() })
      )
        throw new SourceConflict();
      const selected = entries?.[0];
      if (
        selected &&
        (s.tier !== selected.tier ||
          s.division !== selected.division ||
          s.leaguePoints !== selected.leaguePoints ||
          s.wins !== selected.wins ||
          s.losses !== selected.losses)
      )
        throw new SourceConflict();
      if (
        !selected &&
        (s.tier !== "UNRANKED" ||
          s.division !== "" ||
          s.leaguePoints !== 0 ||
          s.wins !== 0 ||
          s.losses !== 0)
      )
        throw new SourceConflict();
      snapshotData = {
        id: s.id,
        timestamp: s.timestamp.toISOString(),
        inserted: link.inserted,
        origin: entries?.length ? "observational_first_entry" : "existing_absence_policy",
        tier: s.tier,
        division: s.division,
        leaguePoints: s.leaguePoints,
        wins: s.wins,
        losses: s.losses,
      };
    }
    if (link && (record.entries === null || identity?.identityMatch !== true))
      throw new MatchCaptureError("scope");
    await eventInTx(
      tx,
      stored,
      queue,
      "rank_capture",
      `league:${record.requestId}`,
      record.source,
      {
        captureId: projectionId(record.requestId, stored.id, queue),
        record: { ...record, entries },
        entryPresent: entries === null ? null : entries.length > 0,
        queueAmbiguous: entries !== null && entries.length > 1,
        identityMatch: identity?.identityMatch ?? null,
        snapshot: snapshotData,
      },
      link?.inserted ?? false,
      parentId,
      identityUnitId,
    );
  }
}

/** Fetch is outside SW. Protect match before discovering/locking all personal owners. */
export async function captureRemakeInTx(
  tx: SyncTransaction,
  client: RiotClient,
  platform: Platform,
  matchId: string,
  handle: MatchCaptureHandle,
) {
  const record = client.confirmedRemakeInput(handle, platform);
  authorized(client, record);
  if (record.requestedMatchId !== matchId) throw new MatchCaptureError("scope");
  const [storedMatch] = await tx
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .for("update");
  if (!storedMatch) throw new MatchCaptureError("scope");
  const associated = await tx
    .select({ id: playerMatches.playerId })
    .from(playerMatches)
    .where(eq(playerMatches.matchId, matchId));
  await lockSourcePlayers(
    tx,
    associated.map((p) => p.id),
  );
  const owners = associated.length
    ? await tx
        .select()
        .from(players)
        .where(
          inArray(
            players.id,
            associated.map((p) => p.id),
          ),
        )
        .orderBy(asc(players.id))
    : [];
  if (owners.some((p) => p.platform !== platform)) throw new MatchCaptureError("scope");
  const detail = record.detail;
  const matching = detail !== null && detail.matchId === matchId;
  if (
    matching &&
    (detail.queueId !== storedMatch.queueId ||
      detail.mapId !== storedMatch.mapId ||
      detail.timestampMs !== storedMatch.timestamp.getTime())
  )
    throw new SourceConflict();
  const before = storedMatch.isRemake;
  const classification = matching ? detail.remake.observationalIsRemake : null;
  const basis = !matching
    ? "unresolved"
    : detail.remake.truePresent > 0
      ? "true_marker_present"
      : detail.remake.falsePresent > 0 && detail.remake.absent === 0
        ? "all_markers_false"
        : "unknown";
  const prior = owners.length
    ? await tx
        .select()
        .from(headers)
        .where(
          and(
            inArray(
              headers.playerId,
              owners.map((p) => p.id),
            ),
            inArray(
              headers.operationKey,
              RANKED_QUEUES.map((queue) => `remake:${record.requestId}:${queue}`),
            ),
          ),
        )
    : [];
  if (
    prior.length &&
    (prior.length !== owners.length * RANKED_QUEUES.length ||
      (classification !== null && before !== classification))
  )
    throw new MatchCaptureError("conflict");
  if (!prior.length && classification !== null)
    await classifyStoredRemake(tx, matchId, classification);
  for (const p of owners)
    for (const queue of RANKED_QUEUES)
      await eventInTx(tx, p, queue, "match_scan", `remake:${record.requestId}`, record.source, {
        captureId: projectionId(record.requestId, p.id, queue),
        record,
        requestedMatchId: matchId,
        receivedMatchId: detail?.matchId ?? null,
        matchIdMatches: matching,
        previousClassification: prior.length
          ? prior.find((h) => h.playerId === p.id && h.queue === queue)?.data.previousClassification
          : before,
        classification,
        classifierVersion: REMAKE_CLASSIFIER_VERSION,
        basis,
        contradictoryMarkers:
          (detail?.remake.truePresent ?? 0) > 0 && (detail?.remake.falsePresent ?? 0) > 0,
        scopeMeaning: "personal_projection_of_shared_match",
        targetQueue: queue === "RANKED_SOLO_5x5" ? 420 : 440,
        belongsToTargetQueue: storedMatch.queueId === (queue === "RANKED_SOLO_5x5" ? 420 : 440),
      });
  return { matching, classification };
}
