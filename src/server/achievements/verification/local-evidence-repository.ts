import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { assertEvidenceCapacityInTx } from "./evidence-in-tx";
import {
  achievementEvidenceHeaders as headers,
  achievementEvidenceUnits as units,
  players,
} from "@/db/schema";
import { reconcileDeclaredEvidence, fingerprintDeclaredPage } from "./receipts";
import type {
  StructuralReceiptInput,
  StructuralReceiptResult,
  IdDisposition,
} from "./receipt-contracts";
import {
  decimalRevision,
  localIdentity,
  headerSchema,
  unitSchema,
  parseLocal,
  localCanonical,
  LOCAL_EVIDENCE_VERSION,
  LOCAL_LIMITS,
  MAX_REVISION,
  LocalEvidenceError,
  UNAUTHENTICATED,
  type LocalHeaderInput,
  type LocalUnitInput,
  type EffectiveEvidence,
} from "./persistence-contracts";

type LocalDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
type LocalTransaction = Pick<LocalDatabase, "select" | "insert" | "update" | "delete">;
type Header = typeof headers.$inferSelect;
type Unit = typeof units.$inferSelect;
type Identity = LocalHeaderInput["identity"];
type PreparationInput = Omit<
  StructuralReceiptInput,
  "pages" | "dispositions" | "identity" | "sourceRevision" | "nature"
>;
type Prepared = { inputRevision: string; fingerprint: string; status: "structurally_complete" };
type StoredPreparation = {
  identity: Identity;
  parent: Header;
  revision: bigint;
  unitIds: string[];
  result: StructuralReceiptResult;
  preparationHash: string;
  template: PreparationInput;
  recordIds: string[];
};
const digest = (v: unknown) => createHash("sha256").update(localCanonical(v)).digest("hex");
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
// Conservative upper bound for PostgreSQL JSONB text whitespace; never truncate to fit.
const storageBytes = (v: unknown) => 2 * bytes(v);
const identityWhere = (identity: Identity) =>
  and(
    eq(headers.playerId, identity.playerId),
    eq(headers.platform, identity.platform),
    eq(headers.queue, identity.queue),
    eq(headers.season, identity.season),
  );
const dto = (h: Header) => ({
  ...h,
  inputRevision: h.inputRevision?.toString() ?? null,
  sealedAtRevision: h.sealedAtRevision?.toString() ?? null,
  ...UNAUTHENTICATED,
});

/** Local test injection only. No operational db(), URL, connection factory, routes or callers. */
export function localEvidenceRepository<T extends PgQueryResultHKT>(
  database: PgDatabase<T, typeof schema>,
) {
  // A preparation is a private capability in this repository instance, not a client-provided receipt.
  const prepared = new WeakMap<Prepared, StoredPreparation>();

  async function owner(tx: LocalTransaction, identity: Identity, lock = false) {
    const query = tx
      .select({ id: players.id, platform: players.platform, revision: players.sourceRevision })
      .from(players)
      .where(eq(players.id, identity.playerId));
    const [row] = await (lock ? query.for("update") : query);
    if (!row) throw new LocalEvidenceError("missing");
    if (row.platform !== identity.platform) throw new LocalEvidenceError("conflict");
    return row;
  }
  function expectRevision(actual: bigint, expected: string) {
    if (actual !== BigInt(parseLocal(decimalRevision, expected)))
      throw new LocalEvidenceError("revision");
  }
  async function increment(tx: LocalTransaction, identity: Identity, revision: bigint) {
    if (revision === MAX_REVISION) throw new LocalEvidenceError("limit");
    const [row] = await tx
      .update(players)
      .set({ sourceRevision: sql`${players.sourceRevision} + 1` })
      .where(and(eq(players.id, identity.playerId), eq(players.sourceRevision, revision)))
      .returning({ revision: players.sourceRevision });
    if (!row) throw new LocalEvidenceError("revision");
    return row.revision;
  }
  async function header(tx: LocalTransaction, identity: Identity, id: string) {
    const [h] = await tx
      .select()
      .from(headers)
      .where(and(identityWhere(identity), eq(headers.id, id)));
    if (!h) throw new LocalEvidenceError("missing");
    return h;
  }
  async function operation(tx: LocalTransaction, identity: Identity, key: string) {
    const [h] = await tx
      .select()
      .from(headers)
      .where(and(eq(headers.playerId, identity.playerId), eq(headers.operationKey, key)));
    return h;
  }
  async function limits(
    tx: LocalTransaction,
    identity: Identity,
    headerId: string | null,
    addHeaders: number,
    addUnits: number,
    addBytes: number,
  ) {
    if (headerId !== null) await header(tx, identity, headerId);
    await assertEvidenceCapacityInTx(tx, identity.playerId, headerId, addHeaders, addUnits, addBytes);
  }
  function unitData(input: LocalUnitInput) {
    return { version: LOCAL_EVIDENCE_VERSION, ...input };
  }
  function verifyUnit(h: Header, input: LocalUnitInput) {
    const matchId = new RegExp(`^${h.platform}_[0-9]+$`);
    if (input.kind === "disposition" && !matchId.test(input.disposition.matchId))
      throw new LocalEvidenceError("invalid");
    if (
      input.kind === "page" &&
      input.page.response.state !== "failed" &&
      input.page.response.ids.some((id) => !matchId.test(id))
    )
      throw new LocalEvidenceError("invalid");
    if (
      h.status !== "collecting" ||
      (input.kind === "snapshot" ? h.kind !== "rank_capture" : h.kind !== "match_scan")
    )
      throw new LocalEvidenceError("conflict");
    if (input.kind === "page") {
      if (
        !fingerprintDeclaredPage(input.page) ||
        digest(input.page.identity) !==
          digest({ playerId: h.playerId, platform: h.platform, queue: h.queue, season: h.season })
      )
        throw new LocalEvidenceError("conflict");
      if (
        input.page.response.state !== "failed" &&
        input.page.response.ids.length > input.page.query.count
      )
        throw new LocalEvidenceError("invalid");
    }
    if (input.kind === "snapshot" && input.snapshot.queue !== h.queue)
      throw new LocalEvidenceError("conflict");
    if (input.kind === "disposition" && "detail" in input.disposition && input.disposition.detail) {
      const d = input.disposition.detail;
      if (
        d.matchId !== input.disposition.matchId ||
        (d.playerId !== null && d.playerId !== h.playerId) ||
        (d.platform !== null && d.platform !== h.platform)
      )
        throw new LocalEvidenceError("conflict");
    }
    if (
      input.kind === "disposition" &&
      input.disposition.state === "reused_with_matching_attestation_declared" &&
      digest(input.disposition.attestation.identity) !==
        digest({ playerId: h.playerId, platform: h.platform, queue: h.queue, season: h.season })
    )
      throw new LocalEvidenceError("conflict");
  }
  async function readUnits(
    tx: LocalTransaction,
    identity: Identity,
    headerId: string,
    revision: bigint,
  ) {
    await header(tx, identity, headerId);
    return tx
      .select()
      .from(units)
      .where(
        and(
          eq(units.playerId, identity.playerId),
          eq(units.headerId, headerId),
          lte(units.revision, revision),
        ),
      )
      .orderBy(asc(units.revision), asc(units.ordinal));
  }
  function projectRows(rows: Unit[]): EffectiveEvidence {
    const dispositions = new Map<string, IdDisposition>();
    const predecessors = new Map<string, string>();
    const pages: EffectiveEvidence["pages"] = [];
    for (const row of rows) {
      if (row.kind === "reference") continue;
      const { version, ...value } = row.data;
      if (version !== LOCAL_EVIDENCE_VERSION || digest(row.data) !== row.fingerprint)
        throw new LocalEvidenceError("conflict");
      const input = parseLocal(unitSchema, value);
      if (row.kind !== input.kind || row.unitKey !== input.unitKey || row.ordinal !== input.ordinal)
        throw new LocalEvidenceError("conflict");
      if (input.kind === "page") pages.push(input.page);
      if (input.kind === "disposition") {
        if (
          (predecessors.get(input.disposition.matchId) ?? null) !== input.previousUnitId ||
          row.previousUnitId !== input.previousUnitId ||
          row.entityKey !== input.disposition.matchId
        )
          throw new LocalEvidenceError("conflict");
        dispositions.set(input.disposition.matchId, input.disposition);
        predecessors.set(input.disposition.matchId, row.id);
      }
    }
    return {
      pages,
      dispositions: [...dispositions.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, d]) => d),
      unitIds: rows.map((r) => r.id),
    };
  }

  return {
    async revision(input: unknown) {
      const identity = parseLocal(localIdentity, input);
      return (await owner(database, identity)).revision.toString();
    },
    async insertHeader(input: unknown, expectedRevision: string) {
      const value = parseLocal(headerSchema, input);
      const data = { version: LOCAL_EVIDENCE_VERSION, ...value };
      if (bytes(data) > LOCAL_LIMITS.headerBytes) throw new LocalEvidenceError("limit");
      return database.transaction(async (tx) => {
        const row = await owner(tx, value.identity, true);
        const existing = await operation(tx, value.identity, value.operationKey);
        if (existing) {
          if (digest(existing.data) !== digest(data)) throw new LocalEvidenceError("conflict");
          return dto(existing);
        }
        expectRevision(row.revision, expectedRevision);
        if (value.parentId) await header(tx, value.identity, value.parentId);
        await limits(tx, value.identity, null, 1, 0, storageBytes(data));
        const [h] = await tx
          .insert(headers)
          .values({
            ...value.identity,
            kind: value.kind,
            status: "collecting",
            source: value.source,
            version: LOCAL_EVIDENCE_VERSION,
            operationKey: value.operationKey,
            parentId: value.parentId,
            from: value.interval ? new Date(value.interval.from) : null,
            to: value.interval ? new Date(value.interval.to) : null,
            data,
          })
          .returning();
        await increment(tx, value.identity, row.revision);
        return dto(h);
      });
    },
    /** Batch retries are bounded by caller; one DB transaction, no automatic network retries. */
    async insertUnits(
      identityInput: unknown,
      headerId: string,
      inputs: unknown[],
      expectedRevision: string,
    ) {
      const identity = parseLocal(localIdentity, identityInput);
      if (inputs.length === 0 || inputs.length > 100) throw new LocalEvidenceError("limit");
      const values = inputs.map((v) => parseLocal(unitSchema, v));
      if (
        new Set(values.map((v) => v.unitKey)).size !== values.length ||
        new Set(values.map((v) => v.ordinal)).size !== values.length
      )
        throw new LocalEvidenceError("conflict");
      const data = values.map(unitData);
      if (data.some((v) => bytes(v) > LOCAL_LIMITS.unitBytes))
        throw new LocalEvidenceError("limit");
      return database.transaction(async (tx) => {
        const row = await owner(tx, identity, true);
        const h = await header(tx, identity, headerId);
        const entityKeys = values.flatMap((v) =>
          v.kind === "disposition"
            ? [v.disposition.matchId]
            : v.kind === "snapshot"
              ? [v.snapshot.id]
              : [],
        );
        // Fetch only retry keys and affected entity histories, not every season payload per batch.
        const all = await tx
          .select()
          .from(units)
          .where(
            and(
              eq(units.headerId, headerId),
              or(
                inArray(
                  units.unitKey,
                  values.map((v) => v.unitKey),
                ),
                entityKeys.length ? inArray(units.entityKey, entityKeys) : undefined,
              ),
            ),
          )
          .orderBy(asc(units.ordinal));
        const results: Unit[] = [];
        const pending: Array<{ input: LocalUnitInput; data: Record<string, unknown> }> = [];
        for (let i = 0; i < values.length; i++) {
          const input = values[i];
          verifyUnit(h, input);
          const old = all.find((u) => u.unitKey === input.unitKey);
          if (old) {
            if (
              old.fingerprint !== digest(data[i]) ||
              localCanonical(old.data) !== localCanonical(data[i])
            )
              throw new LocalEvidenceError("conflict");
            results.push(old);
          } else pending.push({ input, data: data[i] });
        }
        if (pending.length) {
          expectRevision(row.revision, expectedRevision);
          await limits(
            tx,
            identity,
            headerId,
            0,
            pending.length,
            pending.reduce((n, v) => n + storageBytes(v.data), 0),
          );
          const nextRevision = await increment(tx, identity, row.revision);
          for (const { input, data: payload } of pending) {
            if (input.kind === "disposition") {
              const preceding = all
                .filter(
                  (u) => u.kind === "disposition" && u.entityKey === input.disposition.matchId,
                )
                .at(-1);
              if (
                (preceding?.id ?? null) !== input.previousUnitId ||
                (preceding && input.ordinal <= preceding.ordinal)
              )
                throw new LocalEvidenceError("conflict");
              if (preceding) {
                const prior = preceding.data.disposition as IdDisposition;
                // A terminal detail is immutable. Replacements need a separately reviewed repair protocol.
                if (
                  ![
                    "pending",
                    "unknown",
                    "unavailable_404",
                    "invalid",
                    "reused_without_attestation",
                  ].includes(prior.state)
                )
                  throw new LocalEvidenceError("conflict");
              }
            }
            if (
              input.kind === "snapshot" &&
              all.some((u) => u.kind === "snapshot" && u.entityKey === input.snapshot.id)
            )
              throw new LocalEvidenceError("conflict");
            const [u] = await tx
              .insert(units)
              .values({
                ...identity,
                headerId,
                kind: input.kind,
                unitKey: input.unitKey,
                ordinal: input.ordinal,
                offset: input.kind === "page" ? input.page.query.start : null,
                attempt: input.kind === "page" ? input.page.attempt : null,
                entityKey:
                  input.kind === "disposition"
                    ? input.disposition.matchId
                    : input.kind === "snapshot"
                      ? input.snapshot.id
                      : null,
                previousUnitId: input.kind === "disposition" ? input.previousUnitId : null,
                revision: nextRevision,
                fingerprint: digest(payload),
                data: payload,
              })
              .returning();
            all.push(u);
            results.push(u);
          }
        }
        return results
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((u) => ({ ...u, revision: u.revision.toString() }));
      });
    },
    async recover(identityInput: unknown, operationKey: string) {
      const identity = parseLocal(localIdentity, identityInput);
      const h = await operation(database, identity, operationKey);
      if (!h) return null;
      if (
        h.platform !== identity.platform ||
        h.queue !== identity.queue ||
        h.season !== identity.season
      )
        throw new LocalEvidenceError("conflict");
      return dto(h);
    },
    async list(identityInput: unknown, afterId: string | null = null) {
      const identity = parseLocal(localIdentity, identityInput);
      return (
        await database
          .select()
          .from(headers)
          .where(and(identityWhere(identity), afterId ? gt(headers.id, afterId) : undefined))
          .orderBy(asc(headers.id))
          .limit(100)
      ).map(dto);
    },
    async effective(identityInput: unknown, headerId: string, atRevision: string) {
      const identity = parseLocal(localIdentity, identityInput);
      const revision = BigInt(parseLocal(decimalRevision, atRevision));
      const rows = await database.transaction(
        async (tx) => {
          if (revision > (await owner(tx, identity)).revision)
            throw new LocalEvidenceError("revision");
          return readUnits(tx, identity, headerId, revision);
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
      return projectRows(rows);
    },
    async prepareSeal(
      identityInput: unknown,
      headerId: string,
      input: PreparationInput,
    ): Promise<Prepared> {
      const identity = parseLocal(localIdentity, identityInput);
      const snapshot = await database.transaction(
        async (tx) => {
          const row = await owner(tx, identity);
          const parent = await header(tx, identity, headerId);
          if (parent.kind !== "match_scan") throw new LocalEvidenceError("conflict");
          const rows = await readUnits(tx, identity, headerId, row.revision);
          return { revision: row.revision, parent, rows };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
      const evidence = projectRows(snapshot.rows);
      // No hashing/evaluators under a write lock or inside the read transaction.
      const result = reconcileDeclaredEvidence({
        ...input,
        identity,
        nature: "synthetic",
        sourceRevision: { state: "declared", value: snapshot.revision.toString() },
        pages: evidence.pages.map((page) => ({ page, expectedFingerprint: null })),
        dispositions: evidence.dispositions,
      });
      if (result.status !== "structurally_complete" || !result.fingerprint || !result.content)
        throw new LocalEvidenceError("incomplete");
      const material = input.materialization.input;
      if (
        material.kind !== "matches" ||
        material.attribution.state !== "known" ||
        material.attribution.origin !== "synthetic"
      )
        throw new LocalEvidenceError("invalid");
      const byMatch = new Map(evidence.dispositions.map((d) => [d.matchId, d]));
      for (const source of material.records) {
        const d = byMatch.get(source.record.matchId);
        if (!d || !("capture" in d) || !("detail" in d) || !d.detail)
          throw new LocalEvidenceError("conflict");
        const { playerId, platform, ...record } = d.detail;
        if (
          playerId !== identity.playerId ||
          platform !== identity.platform ||
          digest(source) !== digest({ record, identity, capture: d.capture })
        )
          throw new LocalEvidenceError("conflict");
      }
      const template: PreparationInput = structuredClone({
        ...input,
        materialization: { ...input.materialization, input: { ...material, records: [] } },
      });
      const recordIds = material.records.map((r) => r.record.matchId);
      if (
        !snapshot.parent.from ||
        !snapshot.parent.to ||
        Date.parse(result.content.target.interval.from) !== snapshot.parent.from.getTime() ||
        Date.parse(result.content.target.interval.to) !== snapshot.parent.to.getTime()
      )
        throw new LocalEvidenceError("conflict");
      const token: Prepared = Object.freeze({
        inputRevision: snapshot.revision.toString(),
        fingerprint: result.fingerprint,
        status: "structurally_complete",
      });
      prepared.set(token, {
        identity,
        parent: snapshot.parent,
        revision: snapshot.revision,
        unitIds: evidence.unitIds,
        result,
        preparationHash: digest(input),
        template,
        recordIds,
      });
      return token;
    },
    async seal(token: Prepared, operationKey: string) {
      const preparation = prepared.get(token);
      if (!preparation) throw new LocalEvidenceError("invalid");
      const { identity, parent, revision, result, unitIds, preparationHash, template, recordIds } =
        preparation;
      // Validate key using the same strict header boundary, never a URL or secret.
      parseLocal(headerSchema, {
        identity,
        operationKey,
        kind: "match_scan",
        source: "unknown",
        parentId: null,
        interval: null,
        capture: {
          state: "legacy",
          source: "unknown",
          endpoint: "unknown",
          captureId: null,
          receivedAt: null,
        },
      });
      const data = {
        version: LOCAL_EVIDENCE_VERSION,
        receiptVersion: result.version,
        canonicalizationVersion: result.canonicalizationVersion,
        fingerprint: token.fingerprint,
        preparationHash,
        template,
        recordIds,
        inputRevision: revision.toString(),
        status: "structurally_complete",
        ...UNAUTHENTICATED,
      };
      if (storageBytes(data) > LOCAL_LIMITS.headerBytes) throw new LocalEvidenceError("limit");
      return database.transaction(async (tx) => {
        const row = await owner(tx, identity, true);
        const existing = await operation(tx, identity, operationKey);
        if (existing) {
          if (
            existing.kind !== "structural_receipt" ||
            existing.parentId !== parent.id ||
            localCanonical(existing.data) !== localCanonical(data)
          )
            throw new LocalEvidenceError("conflict");
          return dto(existing);
        }
        expectRevision(row.revision, revision.toString());
        await header(tx, identity, parent.id);
        const referenceBytes = unitIds.reduce(
          (n, id) => n + storageBytes({ version: LOCAL_EVIDENCE_VERSION, sourceUnitId: id }),
          0,
        );
        if (
          unitIds.length > LOCAL_LIMITS.unitsPerHeader ||
          storageBytes(data) + referenceBytes > LOCAL_LIMITS.bytesPerHeader
        )
          throw new LocalEvidenceError("limit");
        await limits(tx, identity, null, 1, unitIds.length, storageBytes(data) + referenceBytes);
        const next = await increment(tx, identity, revision);
        const [h] = await tx
          .insert(headers)
          .values({
            ...identity,
            kind: "structural_receipt",
            status: "sealed",
            source: "synthetic",
            version: LOCAL_EVIDENCE_VERSION,
            operationKey,
            parentId: parent.id,
            from: parent.from,
            to: parent.to,
            inputRevision: revision,
            sealedAtRevision: next,
            fingerprint: token.fingerprint,
            data,
          })
          .returning();
        // Small reference records preserve the complete immutable source set without copying payloads.
        for (let start = 0; start < unitIds.length; start += 100) {
          await tx.insert(units).values(
            unitIds.slice(start, start + 100).map((id, i) => {
              const payload = { version: LOCAL_EVIDENCE_VERSION, sourceUnitId: id };
              return {
                ...identity,
                headerId: h.id,
                kind: "reference" as const,
                unitKey: `source:${id}`,
                ordinal: start + i,
                referenceUnitId: id,
                revision: next,
                fingerprint: digest(payload),
                data: payload,
              };
            }),
          );
        }
        return dto(h);
      });
    },
    async reproduceSeal(identityInput: unknown, id: string) {
      const identity = parseLocal(localIdentity, identityInput);
      const saved = await database.transaction(
        async (tx) => {
          const h = await header(tx, identity, id);
          if (h.status !== "sealed" || h.inputRevision === null || h.parentId === null)
            throw new LocalEvidenceError("invalid");
          const rows = await readUnits(tx, identity, h.parentId, h.inputRevision);
          const refs = await tx
            .select()
            .from(units)
            .where(eq(units.headerId, h.id))
            .orderBy(asc(units.ordinal));
          return { h, rows, refs };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
      const evidence = projectRows(saved.rows);
      if (
        saved.refs.length !== evidence.unitIds.length ||
        saved.refs.some(
          (u, i) =>
            u.kind !== "reference" ||
            u.referenceUnitId !== evidence.unitIds[i] ||
            u.fingerprint !== digest(u.data),
        )
      )
        throw new LocalEvidenceError("conflict");
      const template = saved.h.data.template as PreparationInput;
      const ids = saved.h.data.recordIds as string[];
      const material = template?.materialization?.input;
      if (material?.kind !== "matches" || !Array.isArray(ids))
        throw new LocalEvidenceError("invalid");
      const byMatch = new Map(evidence.dispositions.map((d) => [d.matchId, d]));
      const records = ids.map((id) => {
        const d = byMatch.get(id);
        if (!d || !("capture" in d) || !("detail" in d) || !d.detail)
          throw new LocalEvidenceError("conflict");
        const { playerId, platform, ...record } = d.detail;
        if (playerId !== identity.playerId || platform !== identity.platform)
          throw new LocalEvidenceError("conflict");
        return { record, identity, capture: d.capture };
      });
      const input = {
        ...template,
        materialization: { ...template.materialization, input: { ...material, records } },
      };
      if (digest(input) !== saved.h.data.preparationHash) throw new LocalEvidenceError("conflict");
      const result = reconcileDeclaredEvidence({
        ...input,
        identity,
        nature: "synthetic",
        sourceRevision: { state: "declared", value: saved.h.inputRevision!.toString() },
        pages: evidence.pages.map((page) => ({ page, expectedFingerprint: null })),
        dispositions: evidence.dispositions,
      });
      if (result.status !== "structurally_complete" || result.fingerprint !== saved.h.fingerprint)
        throw new LocalEvidenceError("conflict");
      return result;
    },
    async sealState(identityInput: unknown, id: string) {
      const identity = parseLocal(localIdentity, identityInput);
      return database.transaction(
        async (tx) => {
          const h = await header(tx, identity, id);
          const row = await owner(tx, identity);
          if (h.status !== "sealed" || h.sealedAtRevision === null)
            throw new LocalEvidenceError("invalid");
          return {
            state:
              row.revision === h.sealedAtRevision ? "local_revision_unchanged" : "review_required",
            currentRevision: row.revision.toString(),
            ...dto(h),
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async deleteEvidence(identityInput: unknown, expectedRevision: string) {
      const identity = parseLocal(localIdentity, identityInput);
      return database.transaction(async (tx) => {
        const row = await owner(tx, identity, true);
        expectRevision(row.revision, expectedRevision);
        // All queues/seasons of this owner: D13 does not leave alternate-scope personal evidence.
        const removed = await tx
          .delete(headers)
          .where(eq(headers.playerId, identity.playerId))
          .returning({ id: headers.id });
        if (removed.length) await increment(tx, identity, row.revision);
        return { deletedHeaders: removed.length };
      });
    },
  };
}
