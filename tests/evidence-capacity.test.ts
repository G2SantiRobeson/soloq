import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import {
  appendRankedEventInTx,
  projectRankedEvents,
  rankedEventDigest,
  RANKED_STREAM_VERSION,
} from "@/server/sync/ranked-event-store";
import { RANKED_CAPTURE_VERSION, type RankedRecord } from "@/server/riot/ranked-capture";
import {
  lockSourcePlayers,
  markSourceChanged,
  flushSourceRevisions,
} from "@/server/sync/source-revision";
import { LOCAL_LIMITS } from "@/server/achievements/verification/persistence-contracts";
import { assertEvidenceCapacityInTx } from "@/server/achievements/verification/evidence-in-tx";
import { syncWrite } from "@/server/sync/progress";
import { RiotClient } from "@/server/riot/client";

const pg = new PGlite();
const queries: string[] = [];
const database = drizzle(pg, {
  schema,
  logger: {
    logQuery(q) {
      queries.push(q);
    },
  },
});
vi.mock("@/db", () => ({ db: () => database }));
const H = schema.achievementEvidenceHeaders,
  U = schema.achievementEvidenceUnits;
const playerId = "11111111-1111-4111-8111-111111111111";
const scope = {
  playerId,
  platform: "LA2" as const,
  queue: "RANKED_SOLO_5x5" as const,
  season: "2026",
};
const restrictions = { certification: "not_established", grantAuthorized: false } as const;
function capture(
  endpoint: RankedRecord["endpoint"] = "IDENTITY-V1",
  source: RankedRecord["source"] = "synthetic",
  lp = 49,
) {
  const requestId = randomUUID();
  return {
    version: RANKED_CAPTURE_VERSION,
    captureId: randomUUID(),
    identityMatch: true,
    record: {
      version: RANKED_CAPTURE_VERSION,
      normalizationVersion: "minimal-ranked-identity-v1",
      requestId,
      endpoint,
      source,
      receptions: [
        {
          captureId: requestId,
          receptionId: randomUUID(),
          receivedAt: "2026-10-12T00:00:00.000Z",
          validatedAt: "2026-10-12T00:00:00.001Z",
          failedAt: null,
          attempt: 1,
          outcome: "success",
          status: 200,
          retryAfterMs: null,
        },
      ],
      entries:
        endpoint === "LEAGUE-V4"
          ? [
              {
                queue: scope.queue,
                tier: "DIAMOND",
                division: "I",
                leaguePoints: lp,
                wins: 20,
                losses: 10,
              },
            ]
          : null,
      ignoredEntries: endpoint === "LEAGUE-V4" ? 0 : null,
      ...restrictions,
    },
    ...(endpoint === "LEAGUE-V4"
      ? { entryPresent: true, queueAmbiguous: false, snapshot: null }
      : { scopeMeaning: "projection_for_ranked_queue" }),
    ...restrictions,
  };
}
type Data = ReturnType<typeof capture> & Record<string, unknown>;
const hs = () => database.select().from(H);
const us = () => database.select().from(U);
const revision = async () =>
  (await database.select().from(schema.players).where(eq(schema.players.id, playerId)))[0]
    .sourceRevision;
async function persist(
  identity: Data,
  rank: Data | null = null,
  queues = [scope.queue] as (typeof H.$inferSelect.queue)[],
  season = scope.season,
) {
  return syncWrite(new RiotClient(), async (tx) => {
    await lockSourcePlayers(tx, [playerId]);
    for (const queue of queues) {
      const owner = { ...scope, queue, season };
      const i = await appendRankedEventInTx(tx, owner, "identity_capture", identity, null);
      if (i.inserted) markSourceChanged(tx, playerId);
      if (rank) {
        const entries = rank.record.entries?.filter((entry) => entry.queue === queue) ?? null;
        const projected = {
          ...rank,
          record: { ...rank.record, entries },
          entryPresent: entries === null ? null : entries.length > 0,
          queueAmbiguous: entries !== null && entries.length > 1,
        };
        const [unit] = await tx
          .select()
          .from(U)
          .where(
            sql`${U.headerId}=${i.headerId} and (${U.unitKey}=${`event:${identity.record.requestId}`} or ${U.unitKey}='event')`,
          );
        const r = await appendRankedEventInTx(tx, owner, "rank_capture", projected, {
          headerId: i.headerId,
          unitId: unit.id,
        });
        if (r.inserted) markSourceChanged(tx, playerId);
      }
    }
    await flushSourceRevisions(tx);
  });
}
async function legacy(
  data: Data,
  kind: "identity_capture" | "rank_capture",
  parentId: string | null = null,
) {
  return syncWrite(new RiotClient(), async (tx) => {
    await lockSourcePlayers(tx, [playerId]);
    const [h] = await tx
      .insert(H)
      .values({
        ...scope,
        kind,
        status: "collecting",
        source: data.record.source,
        version: RANKED_CAPTURE_VERSION,
        operationKey: `${kind === "identity_capture" ? "identity" : "league"}:${data.record.requestId}:${scope.queue}`,
        parentId,
        data,
      })
      .returning();
    await tx.insert(U).values({
      ...scope,
      headerId: h.id,
      unitKey: "event",
      ordinal: 0,
      kind: "disposition",
      entityKey: kind,
      revision: sql`(select source_revision+1 from players where id=${playerId})`,
      fingerprint: rankedEventDigest(data),
      data,
    });
    markSourceChanged(tx, playerId);
    await flushSourceRevisions(tx);
    return h;
  });
}
beforeAll(async () => {
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
});
beforeEach(async () => {
  await pg.exec("TRUNCATE players CASCADE");
  await database.insert(schema.players).values({
    id: playerId,
    platform: scope.platform,
    puuid: "synthetic-private",
    gameName: "Synthetic",
    tagLine: "G1",
    scanStart: new Date("2026-01-01T00:00:00Z"),
  });
  queries.length = 0;
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => pg.close());

describe("G.1 immutable containers (PGlite, exclusively fabricated receptions)", () => {
  it("keeps every one of 100 two-queue verifications with immutable headers and exact event hashes", async () => {
    let first: Awaited<ReturnType<typeof hs>> = [];
    let freshQueries = 0,
      warmQueries = 0;
    for (let n = 0; n < 100; n++) {
      const start = queries.length;
      await persist(capture(), capture("LEAGUE-V4"), ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"]);
      if (n === 0) {
        freshQueries = queries.length - start;
        first = await hs();
      }
      if (n === 1) warmQueries = queries.length - start;
    }
    const headers = await hs(),
      units = await us();
    expect(headers).toEqual(first);
    expect(headers).toHaveLength(4);
    expect(headers.every((h) => h.version === RANKED_STREAM_VERSION)).toBe(true);
    expect(units).toHaveLength(600);
    const events = projectRankedEvents(headers, units);
    expect(events).toHaveLength(400);
    expect(new Set(events.map((e) => e.unit.id)).size).toBe(400);
    expect(await revision()).toBe(100n);
    expect(events.every((e) => e.unit.fingerprint === rankedEventDigest(e.unit.data))).toBe(true);
    expect(
      events
        .filter((e) => e.header.kind === "rank_capture")
        .every((e) => e.identityUnitId !== null),
    ).toBe(true);
    const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
    const newBytes =
      headers.reduce((s, h) => s + size(h.data), 0) + units.reduce((s, u) => s + size(u.data), 0);
    const oldBytes = 2 * events.reduce((s, e) => s + size(e.unit.data), 0);
    const actual = await database
      .select({ bytes: sql<string>`sum(octet_length(${U.data}::text))::text` })
      .from(U);
    const measurement = {
      checks: 100,
      oldHeaders: 400,
      newHeaders: 4,
      oldUnits: 400,
      newUnits: 600,
      compactOldBytes: oldBytes,
      compactNewBytes: newBytes,
      pgUnitJsonBytes: Number(actual[0].bytes),
      freshQueries,
      warmQueries,
      estimate1000: {
        oldHeaders: 4000,
        newHeaders: 4,
        oldUnits: 4000,
        newUnits: 6000,
        compactOldBytes: oldBytes * 10,
        compactNewBytes: newBytes * 10 - 9 * headers.reduce((s, h) => s + size(h.data), 0),
      },
    };
    mkdirSync("artifacts", { recursive: true });
    writeFileSync("artifacts/g1-capacity.json", JSON.stringify(measurement, null, 2));
  });
  it("same retry after later receptions keeps exact old content and R; new request is distinct", async () => {
    const i = capture(),
      r = capture("LEAGUE-V4");
    await persist(i, r);
    await persist(capture(), capture("LEAGUE-V4"));
    const before = await us();
    await persist(i, r);
    expect(await us()).toEqual(before);
    expect(await revision()).toBe(2n);
    expect(await hs()).toHaveLength(2);
    expect(projectRankedEvents(await hs(), await us())).toHaveLength(4);
  });
  it("cannot substitute a different identity reception on retry of the same league request", async () => {
    const r = capture("LEAGUE-V4");
    await persist(capture(), r);
    const before = await us();
    await expect(persist(capture(), r)).rejects.toMatchObject({ code: "conflict" });
    expect(await us()).toEqual(before);
    expect(await revision()).toBe(1n);
  });
  it("keeps different seasons, queues and owners separate", async () => {
    await persist(capture(), capture("LEAGUE-V4"));
    await persist(capture(), capture("LEAGUE-V4"), ["RANKED_SOLO_5x5"], "2027");
    await persist(capture(), capture("LEAGUE-V4"), ["RANKED_FLEX_SR"]);
    expect(await hs()).toHaveLength(6);
    expect(projectRankedEvents(await hs(), await us())).toHaveLength(6);
  });
  it("splits unknown/synthetic/server source literals; a fabricated literal never authenticates Riot", async () => {
    for (const source of ["unknown", "synthetic", "server_riot_received"] as const)
      await persist(capture("IDENTITY-V1", source), capture("LEAGUE-V4", source));
    const headers = await hs();
    expect(headers).toHaveLength(6);
    const events = projectRankedEvents(headers, await us());
    expect(
      events.every((e) => e.header.source === (e.unit.data.record as RankedRecord).source),
    ).toBe(true);
    expect(
      events.every(
        (e) =>
          e.unit.data.grantAuthorized === false && e.unit.data.certification === "not_established",
      ),
    ).toBe(true);
  });
  it("separates ACCOUNT and IDENTITY semantics without destroying either event", async () => {
    await persist(capture("ACCOUNT-V1"));
    await persist(capture());
    expect(await hs()).toHaveLength(2);
    expect(projectRankedEvents(await hs(), await us())).toHaveLength(2);
  });
  it("recovers legacy event headers unchanged and reads old+new together", async () => {
    const i = capture(),
      r = capture("LEAGUE-V4"),
      old = await legacy(i, "identity_capture");
    await legacy(r, "rank_capture", old.id);
    const before = await hs(),
      units = await us();
    await persist(i, r);
    expect(await hs()).toEqual(before);
    expect(await us()).toEqual(units);
    expect(await revision()).toBe(2n);
    await persist(capture(), capture("LEAGUE-V4"));
    expect(await hs()).toHaveLength(4);
    expect(projectRankedEvents(await hs(), await us())).toHaveLength(4);
    expect((await hs()).filter((h) => h.version === RANKED_CAPTURE_VERSION)).toEqual(before);
  });
  it("blocks double representation across old and optimized formats", async () => {
    const i = capture();
    await persist(i);
    await legacy(i, "identity_capture");
    const h = await hs(),
      u = await us();
    expect(() => projectRankedEvents(h, u)).toThrow();
    await expect(persist(i)).rejects.toMatchObject({ code: "conflict" });
  });
  it("retains contradictory observations rather than choosing a favourable event", async () => {
    await persist(capture(), capture("LEAGUE-V4", "synthetic", 49));
    await persist(capture(), capture("LEAGUE-V4", "synthetic", 28));
    const ranks = projectRankedEvents(await hs(), await us()).filter(
      (e) => e.header.kind === "rank_capture",
    );
    expect(ranks.map((e) => (e.unit.data.record as RankedRecord).entries![0].leaguePoints)).toEqual(
      [49, 28],
    );
  });
  it("unsupported contract/version or lifecycle corruption never reuses an old container", async () => {
    const i = capture();
    await persist(i);
    await database.update(H).set({ version: "unsupported-future" });
    const before = await us();
    await expect(persist(i)).rejects.toMatchObject({ code: "conflict" });
    expect(await us()).toEqual(before);
    const h = await hs();
    expect(() => projectRankedEvents(h, before)).toThrow();
  });
  it("different local D version is not adopted as a reception stream", async () => {
    await database.insert(H).values({
      ...scope,
      kind: "rank_capture",
      source: "synthetic",
      status: "collecting",
      version: "1.2.B.2.D-local-evidence-v1",
      operationKey: "local:untouched",
      data: { contract: "local" },
    });
    await persist(capture(), capture("LEAGUE-V4"));
    expect(await hs()).toHaveLength(3);
    expect(projectRankedEvents(await hs(), await us())).toHaveLength(2);
  });
  it("late failure rolls back reused-container appends, links, source and revision", async () => {
    await persist(capture(), capture("LEAGUE-V4"));
    const before = await us();
    await pg.exec(
      "CREATE FUNCTION g1_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='reference' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER g1_fail BEFORE INSERT ON achievement_evidence_units FOR EACH ROW EXECUTE FUNCTION g1_fail()",
    );
    try {
      await expect(persist(capture(), capture("LEAGUE-V4"))).rejects.toThrow();
      expect(await us()).toEqual(before);
      expect(await revision()).toBe(1n);
    } finally {
      await pg.exec("DROP TRIGGER g1_fail ON achievement_evidence_units; DROP FUNCTION g1_fail()");
    }
  });
  it("rejects per-unit JSON exceeding the unchanged limit without creating a container", async () => {
    await expect(
      persist({ ...capture(), padding: "x".repeat(LOCAL_LIMITS.unitBytes) }),
    ).rejects.toMatchObject({ code: "limit" });
    expect(await hs()).toHaveLength(0);
    expect(await revision()).toBe(0n);
  });
  it("accounts for the actual JSONB header bytes at the precise aggregate boundary", async () => {
    await persist(capture());
    const [h] = await hs();
    const [used] = await database
      .select({ bytes: sql<string>`sum(octet_length(${U.data}::text))::text` })
      .from(U);
    const reservation =
      LOCAL_LIMITS.bytesPerHeader -
      Number(used.bytes) -
      Buffer.byteLength(JSON.stringify(h.data), "utf8");
    await syncWrite(new RiotClient(), async (tx) => {
      await lockSourcePlayers(tx, [playerId]);
      await expect(
        assertEvidenceCapacityInTx(tx, playerId, h.id, 0, 0, reservation),
      ).rejects.toMatchObject({ code: "limit" });
    });
    expect(await revision()).toBe(1n);
  });
  it("an altered lifecycle cannot silently join the append-only container", async () => {
    await persist(capture());
    const [h] = await hs();
    await database.update(H).set({ data: { ...h.data, lifecycle: "finished" } });
    await expect(persist(capture())).rejects.toMatchObject({ code: "conflict" });
    expect(await revision()).toBe(1n);
  });
  it("1,000 existing headers permit append to the compatible stream, not a new stream", async () => {
    await persist(capture());
    await pg.exec(`INSERT INTO achievement_evidence_headers(player_id,platform,queue,season,kind,status,source,version,operation_key,data)
      SELECT '${playerId}','LA2','RANKED_SOLO_5x5','2026','match_scan','collecting','unknown','fixture','filler:'||i,'{}'::jsonb FROM generate_series(1,999) i`);
    await persist(capture());
    expect(await revision()).toBe(2n);
    expect(await hs()).toHaveLength(1000);
    await expect(persist(capture("ACCOUNT-V1"))).rejects.toMatchObject({ code: "limit" });
    expect(await revision()).toBe(2n);
    expect(await hs()).toHaveLength(1000);
  });
  it.each(["units", "header_bytes", "player_bytes"])(
    "preserves the strict %s aggregate cap and rolls back on overflow",
    async (limit) => {
      await persist(capture());
      const [header] = await hs();
      // SQL-valid filler rows solely to exercise exact PostgreSQL accounting, not capture evidence.
      const count = limit === "units" ? 99999 : 4096,
        length = limit === "units" ? 0 : 8192;
      await pg.exec(`INSERT INTO achievement_evidence_units(player_id,header_id,platform,queue,season,kind,unit_key,ordinal,revision,fingerprint,data)
      SELECT '${playerId}','${header.id}','LA2','RANKED_SOLO_5x5','2026','snapshot','filler:'||i,i,1,repeat('0',64),jsonb_build_object('padding',repeat('x',${length})) FROM generate_series(1,${count}) i`);
      if (limit === "player_bytes") {
        const [other] = await database
          .insert(H)
          .values({
            ...scope,
            kind: "match_scan",
            source: "unknown",
            status: "collecting",
            version: "fixture",
            operationKey: "other:bytes",
            data: {},
          })
          .returning();
        await pg.exec(`INSERT INTO achievement_evidence_units(player_id,header_id,platform,queue,season,kind,unit_key,ordinal,revision,fingerprint,data)
        SELECT '${playerId}','${other.id}','LA2','RANKED_SOLO_5x5','2026','snapshot','filler:'||i,i,1,repeat('0',64),jsonb_build_object('padding',repeat('x',8192)) FROM generate_series(1,4096) i`);
      }
      const before = await revision();
      await expect(persist(capture())).rejects.toMatchObject({ code: "limit" });
      expect(await revision()).toBe(before);
      await syncWrite(new RiotClient(), async (tx) => {
        await lockSourcePlayers(tx, [playerId]);
        await expect(
          assertEvidenceCapacityInTx(tx, playerId, header.id, 0, 1, 1),
        ).rejects.toMatchObject({ code: "limit" });
      });
    },
  );
  it("D13 cascades old+new+references and preserves another owner's evidence", async () => {
    await legacy(capture(), "identity_capture");
    await persist(capture(), capture("LEAGUE-V4"));
    const other = randomUUID();
    await database.insert(schema.players).values({
      id: other,
      platform: "LA2",
      puuid: "other-synthetic",
      gameName: "Other",
      tagLine: "G1",
      scanStart: new Date("2026-01-01T00:00:00Z"),
    });
    const [header] = await database
      .insert(H)
      .values({
        ...scope,
        playerId: other,
        kind: "identity_capture",
        source: "unknown",
        status: "collecting",
        version: "fixture",
        operationKey: "other",
        data: {},
      })
      .returning();
    await database.delete(schema.players).where(eq(schema.players.id, playerId));
    expect(await hs()).toEqual([header]);
    expect(await us()).toHaveLength(0);
  });
  it("rejects corrupted fingerprints, ordinal gaps and absent identity references", async () => {
    await persist(capture(), capture("LEAGUE-V4"));
    const h = await hs(),
      u = await us();
    expect(() =>
      projectRankedEvents(
        h,
        u.map((v, i) => (i === 0 ? { ...v, fingerprint: "0".repeat(64) } : v)),
      ),
    ).toThrow();
    expect(() =>
      projectRankedEvents(
        h,
        u.map((v, i) => (i === 0 ? { ...v, ordinal: 99 } : v)),
      ),
    ).toThrow();
    expect(() =>
      projectRankedEvents(
        h,
        u.filter((v) => v.kind !== "reference"),
      ),
    ).toThrow();
  });
});
