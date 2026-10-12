import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  achievementEvidenceHeaders as headers,
  achievementEvidenceUnits as units,
  players,
} from "@/db/schema";
import { MatchCaptureError } from "../riot/match-capture";
import { RANKED_CAPTURE_VERSION, type RankedRecord } from "../riot/ranked-capture";
import {
  assertEvidenceCapacityInTx,
  conservativeEvidenceBytes,
  type EvidenceTransaction,
} from "../achievements/verification/evidence-in-tx";
import { LOCAL_LIMITS, localCanonical } from "../achievements/verification/persistence-contracts";

export const RANKED_STREAM_VERSION = "1.2.B.2.G.1-ranked-reception-stream-v1";
type Header = typeof headers.$inferSelect;
type Unit = typeof units.$inferSelect;
type Scope = Pick<Header, "playerId" | "platform" | "queue" | "season">;
type Kind = "identity_capture" | "rank_capture";
type Parent = { headerId: string; unitId: string } | null;
export const rankedEventDigest = (v: unknown) =>
  createHash("sha256").update(localCanonical(v)).digest("hex");
const restrictions = { certification: "not_established", grantAuthorized: false } as const;
function conflict(): never {
  throw new MatchCaptureError("conflict");
}
const same = (a: unknown, b: unknown) => localCanonical(a) === localCanonical(b);
const scoped = (a: Scope, b: Scope) =>
  a.playerId === b.playerId &&
  a.platform === b.platform &&
  a.queue === b.queue &&
  a.season === b.season;
function record(data: Record<string, unknown>): RankedRecord {
  const r = data.record as RankedRecord | undefined;
  if (
    !r ||
    r.version !== RANKED_CAPTURE_VERSION ||
    r.normalizationVersion !== "minimal-ranked-identity-v1" ||
    !["ACCOUNT-V1", "IDENTITY-V1", "LEAGUE-V4"].includes(r.endpoint) ||
    !["synthetic", "unknown", "server_riot_received"].includes(r.source) ||
    typeof r.requestId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(r.requestId) ||
    r.certification !== "not_established" ||
    r.grantAuthorized !== false ||
    data.version !== RANKED_CAPTURE_VERSION ||
    data.certification !== "not_established" ||
    data.grantAuthorized !== false
  )
    return conflict();
  return r;
}
function metadata(kind: Kind, r: RankedRecord, parentId: string | null) {
  return {
    version: RANKED_STREAM_VERSION,
    semantics: "immutable_reception_units",
    lifecycle: "append_only",
    kind,
    recordVersion: r.version,
    normalizationVersion: r.normalizationVersion,
    endpoint: r.endpoint,
    source: r.source,
    parentId,
    ...restrictions,
  };
}
function validateHeader(h: Header, data: Record<string, unknown>) {
  const r = record(data);
  if (
    h.status !== "collecting" ||
    h.source !== r.source ||
    h.inputRevision !== null ||
    h.sealedAtRevision !== null ||
    h.fingerprint !== null ||
    h.from !== null ||
    h.to !== null ||
    (h.kind !== "identity_capture" && h.kind !== "rank_capture") ||
    (h.kind === "rank_capture") !== (r.endpoint === "LEAGUE-V4")
  )
    conflict();
  if (h.version === RANKED_STREAM_VERSION) {
    const m = metadata(h.kind as Kind, r, h.parentId);
    if (
      !same(h.data, m) ||
      h.operationKey !== `ranked-stream:${rankedEventDigest({ ...hScope(h), ...m })}`
    )
      conflict();
  } else if (
    h.version !== RANKED_CAPTURE_VERSION ||
    !same(h.data, data) ||
    h.operationKey !==
      `${h.kind === "identity_capture" ? "identity" : "league"}:${r.requestId}:${h.queue}`
  )
    conflict();
}
const hScope = (h: Scope): Scope => ({
  playerId: h.playerId,
  platform: h.platform,
  queue: h.queue,
  season: h.season,
});
function validateUnit(h: Header, u: Unit) {
  validateHeader(h, u.data);
  const r = record(u.data);
  const snapshot = u.data.snapshot as { inserted?: boolean } | null | undefined;
  if (
    !scoped(h, u) ||
    u.headerId !== h.id ||
    u.fingerprint !== rankedEventDigest(u.data) ||
    u.kind !== (snapshot?.inserted ? "snapshot" : "disposition") ||
    u.previousUnitId !== null ||
    u.referenceUnitId !== null ||
    u.offset !== null ||
    u.attempt !== null ||
    u.entityKey !== (snapshot?.inserted ? null : h.kind) ||
    u.unitKey !== (h.version === RANKED_STREAM_VERSION ? `event:${r.requestId}` : "event")
  )
    conflict();
}
function referenceData(eventUnitId: string, identityUnitId: string) {
  return {
    version: RANKED_STREAM_VERSION,
    role: "identity_for_rank_event",
    eventUnitId,
    identityUnitId,
    ...restrictions,
  };
}
function validateReference(h: Header, u: Unit, refs: Unit[], parent: Parent) {
  if (h.version !== RANKED_STREAM_VERSION) {
    if (refs.length) conflict();
    return;
  }
  if (!parent) {
    if (refs.length || h.parentId !== null) conflict();
    return;
  }
  const ref = refs[0];
  if (
    refs.length !== 1 ||
    !ref ||
    !scoped(h, ref) ||
    ref.headerId !== h.id ||
    ref.kind !== "reference" ||
    ref.referenceUnitId !== parent.unitId ||
    h.parentId !== parent.headerId ||
    ref.unitKey !== `identity:${record(u.data).requestId}` ||
    ref.ordinal !== u.ordinal + 1 ||
    ref.revision !== u.revision ||
    ref.previousUnitId !== null ||
    ref.entityKey !== null ||
    ref.offset !== null ||
    ref.attempt !== null ||
    !same(ref.data, referenceData(u.id, parent.unitId)) ||
    ref.fingerprint !== rankedEventDigest(ref.data)
  )
    conflict();
}

/** Internal lookup of an exact reception, never latest/favourable. Caller holds owner lock.
 * Searches both formats before append, including other streams to reject changed scope/parent. */
export async function findRankedEventInTx(
  tx: EvidenceTransaction,
  scope: Scope,
  kind: Kind,
  requestId: string,
) {
  const [old] = await tx
    .select()
    .from(headers)
    .where(
      and(
        eq(headers.playerId, scope.playerId),
        eq(
          headers.operationKey,
          `${kind === "identity_capture" ? "identity" : "league"}:${requestId}:${scope.queue}`,
        ),
      ),
    )
    .for("update");
  const found = await tx
    .select({ h: headers, u: units })
    .from(units)
    .innerJoin(headers, eq(units.headerId, headers.id))
    .where(
      and(
        eq(units.playerId, scope.playerId),
        eq(headers.queue, scope.queue),
        eq(units.unitKey, `event:${requestId}`),
      ),
    );
  if (found.length > 1 || (old && found.length)) conflict();
  if (old) {
    const us = await tx.select().from(units).where(eq(units.headerId, old.id));
    if (us.length !== 1 || !scoped(old, scope) || old.kind !== kind) conflict();
    validateUnit(old, us[0]);
    return { header: old, unit: us[0] };
  }
  const f = found[0];
  if (!f) return null;
  if (!scoped(f.h, scope) || f.h.kind !== kind) conflict();
  validateUnit(f.h, f.u);
  return { header: f.h, unit: f.u };
}

/** No tx/lease/IO/R increment here. The caller already owns lease -> player; header is locked. */
export async function appendRankedEventInTx(
  tx: EvidenceTransaction,
  scope: Scope,
  kind: Kind,
  data: Record<string, unknown>,
  parent: Parent,
) {
  const r = record(data);
  if (
    (kind === "identity_capture" && parent) ||
    (kind === "rank_capture") !== (r.endpoint === "LEAGUE-V4")
  )
    conflict();
  if (conservativeEvidenceBytes(data) > LOCAL_LIMITS.unitBytes)
    throw new MatchCaptureError("limit");
  if (parent) {
    const [p] = await tx
      .select({ h: headers, u: units })
      .from(units)
      .innerJoin(headers, eq(headers.id, units.headerId))
      .where(and(eq(units.id, parent.unitId), eq(headers.id, parent.headerId)));
    if (
      !p ||
      !scoped(p.h, scope) ||
      p.h.kind !== "identity_capture" ||
      p.u.data.identityMatch !== data.identityMatch
    )
      conflict();
    validateUnit(p.h, p.u);
  }
  const prior = await findRankedEventInTx(tx, scope, kind, r.requestId);
  if (prior) {
    if (!same(prior.unit.data, data) || prior.header.parentId !== (parent?.headerId ?? null))
      conflict();
    const refs = await tx
      .select()
      .from(units)
      .where(
        and(eq(units.headerId, prior.header.id), eq(units.unitKey, `identity:${r.requestId}`)),
      );
    validateReference(prior.header, prior.unit, refs, parent);
    return { headerId: prior.header.id, inserted: false };
  }
  const m = metadata(kind, r, parent?.headerId ?? null);
  const operationKey = `ranked-stream:${rankedEventDigest({ ...scope, ...m })}`;
  const [existing] = await tx
    .select()
    .from(headers)
    .where(and(eq(headers.playerId, scope.playerId), eq(headers.operationKey, operationKey)))
    .for("update");
  let h = existing;
  if (h) {
    if (!scoped(h, scope)) conflict();
    validateHeader(h, data);
  } else {
    await assertEvidenceCapacityInTx(tx, scope.playerId, null, 1, 0, conservativeEvidenceBytes(m));
    [h] = await tx
      .insert(headers)
      .values({
        ...scope,
        kind,
        source: r.source,
        version: RANKED_STREAM_VERSION,
        operationKey,
        status: "collecting",
        parentId: parent?.headerId ?? null,
        data: m,
      })
      .returning();
  }
  const [last] = await tx
    .select({ ordinal: units.ordinal, revision: units.revision })
    .from(units)
    .where(eq(units.headerId, h.id))
    .orderBy(desc(units.ordinal))
    .limit(1);
  const ordinal = (last?.ordinal ?? -1) + 1;
  const [revision] = await tx
    .select({ value: sql<string>`(${players.sourceRevision} + 1)::text` })
    .from(players)
    .where(eq(players.id, scope.playerId));
  const destination = BigInt(revision.value);
  if (last && last.revision > destination) conflict();
  const id = randomUUID();
  const refData = parent ? referenceData(id, parent.unitId) : null;
  await assertEvidenceCapacityInTx(
    tx,
    scope.playerId,
    h.id,
    0,
    parent ? 2 : 1,
    conservativeEvidenceBytes(data) + (refData ? conservativeEvidenceBytes(refData) : 0),
  );
  const base = { ...scope, headerId: h.id, revision: destination };
  const inserted: (typeof units.$inferInsert)[] = [
    {
      ...base,
      id,
      kind: (data.snapshot as { inserted?: boolean } | null)?.inserted ? "snapshot" : "disposition",
      unitKey: `event:${r.requestId}`,
      ordinal,
      entityKey: (data.snapshot as { inserted?: boolean } | null)?.inserted ? null : kind,
      data,
      fingerprint: rankedEventDigest(data),
    },
  ];
  if (parent && refData)
    inserted.push({
      ...base,
      kind: "reference",
      unitKey: `identity:${r.requestId}`,
      ordinal: ordinal + 1,
      referenceUnitId: parent.unitId,
      data: refData,
      fingerprint: rankedEventDigest(refData),
    });
  await tx.insert(units).values(inserted);
  return { headerId: h.id, inserted: true };
}

/** Pure private reader for a materialized, scoped set (parents included). No DB consumer/grants.
 * Keeps ALL events, validates both formats and rejects double representation. Not D's seal format. */
export function projectRankedEvents(hs: Header[], us: Unit[]) {
  const byHeader = new Map<string, Unit[]>();
  for (const u of us) {
    const group = byHeader.get(u.headerId) ?? [];
    group.push(u);
    byHeader.set(u.headerId, group);
  }
  const byUnit = new Map(us.map((u) => [u.id, u]));
  const byId = new Map(hs.map((h) => [h.id, h]));
  const seen = new Set<string>();
  const events: { header: Header; unit: Unit; identityUnitId: string | null }[] = [];
  for (const h of hs) {
    if (
      (h.kind !== "identity_capture" && h.kind !== "rank_capture") ||
      h.version === "1.2.B.2.D-local-evidence-v1"
    )
      continue;
    if (![RANKED_CAPTURE_VERSION, RANKED_STREAM_VERSION].includes(h.version)) conflict();
    const group = (byHeader.get(h.id) ?? []).sort((a, b) => a.ordinal - b.ordinal);
    if (!group.length || (h.version === RANKED_CAPTURE_VERSION && group.length !== 1)) conflict();
    if (group.some((u, i) => u.ordinal !== i || (i > 0 && u.revision < group[i - 1].revision)))
      conflict();
    let references = 0;
    const refsByEvent = new Map<unknown, Unit[]>();
    for (const ref of group.filter((u) => u.kind === "reference")) {
      const list = refsByEvent.get(ref.data.eventUnitId) ?? [];
      list.push(ref);
      refsByEvent.set(ref.data.eventUnitId, list);
    }
    for (const u of group.filter((u) => u.kind !== "reference")) {
      validateUnit(h, u);
      const r = record(u.data);
      const key = `${h.playerId}:${h.queue}:${r.requestId}`;
      if (seen.has(key)) conflict();
      seen.add(key);
      const refs = refsByEvent.get(u.id) ?? [];
      let parent: Parent = null;
      if (h.parentId) {
        const ph = byId.get(h.parentId);
        const pu =
          h.version === RANKED_CAPTURE_VERSION
            ? (byHeader.get(h.parentId) ?? [])[0]
            : byUnit.get(refs[0]?.referenceUnitId ?? "");
        if (!ph || !pu || !scoped(h, ph) || ph.kind !== "identity_capture" || pu.headerId !== ph.id)
          conflict();
        validateUnit(ph, pu);
        if (pu.revision > u.revision || pu.data.identityMatch !== u.data.identityMatch) conflict();
        parent = { headerId: ph.id, unitId: pu.id };
      }
      validateReference(h, u, refs, parent);
      references += refs.length;
      events.push({ header: h, unit: u, identityUnitId: parent?.unitId ?? null });
    }
    if (references !== group.filter((u) => u.kind === "reference").length) conflict();
  }
  return events.sort((a, b) =>
    a.unit.revision < b.unit.revision
      ? -1
      : a.unit.revision > b.unit.revision
        ? 1
        : a.header.kind.localeCompare(b.header.kind) ||
          a.header.id.localeCompare(b.header.id) ||
          a.unit.ordinal - b.unit.ordinal,
  );
}
