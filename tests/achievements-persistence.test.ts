import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { localEvidenceRepository } from "@/server/achievements/verification/local-evidence-repository";
import {
  LOCAL_EVIDENCE_VERSION,
  MAX_REVISION,
  localCanonical,
  type LocalHeaderInput,
  type LocalUnitInput,
} from "@/server/achievements/verification/persistence-contracts";
import { materializeAchievementEvidence } from "@/server/achievements/verification/materialize";
import { EVIDENCE_FORMAT_VERSION } from "@/server/achievements/verification/materialization-contracts";
import {
  STRUCTURAL_RECEIPT_VERSION,
  type StructuralReceiptInput,
} from "@/server/achievements/verification/receipt-contracts";
import { fixedScope, match } from "./achievements-fixtures";

const pg = new PGlite();
const db = drizzle(pg, { schema });
const repo = localEvidenceRepository(db);
const identity = {
  playerId: "11111111-1111-4111-8111-111111111111",
  platform: "LA2",
  queue: "RANKED_SOLO_5x5",
  season: "2026",
} as const;
const other = { ...identity, playerId: "22222222-2222-4222-8222-222222222222" };
const legacy = {
  state: "legacy",
  source: "stored",
  endpoint: "unknown",
  captureId: null,
  receivedAt: null,
} as const;
const capture = (id: string) =>
  ({
    state: "declared",
    source: "synthetic",
    endpoint: "MATCH-V5",
    captureId: id,
    receivedAt: "2026-11-02T00:00:00Z",
  }) as const;
const records = Array.from({ length: 5 }, (_, i) => match(i, { matchId: `LA2_${i + 1}` }));
const interval = {
  from: records[0].timestamp,
  to: new Date(Date.parse(records.at(-1)!.timestamp) + 1).toISOString(),
};
const headerInput = (
  key = "scan:1",
  owner: LocalHeaderInput["identity"] = identity,
): LocalHeaderInput => ({
  identity: owner,
  operationKey: key,
  kind: "match_scan",
  source: "unknown",
  parentId: null,
  interval,
  capture: legacy,
});
const pending = (key = "pending:1", ordinal = 0): LocalUnitInput => ({
  kind: "disposition",
  unitKey: key,
  ordinal,
  previousUnitId: null,
  disposition: { state: "pending", matchId: "LA2_1" },
});
const resolveFirst = (previousUnitId: string, ordinal = 1): LocalUnitInput => ({
  kind: "disposition",
  unitKey: "resolved:1",
  ordinal,
  previousUnitId,
  disposition: {
    state: "resolved",
    matchId: "LA2_1",
    detail: { ...records[0], playerId: identity.playerId, platform: identity.platform },
    capture: capture("detail:1"),
  },
});
const query = {
  startTime: Math.floor(Date.parse(interval.from) / 1000),
  endTime: Math.ceil(Date.parse(interval.to) / 1000),
  start: 0,
  count: 10,
  queue: null,
  type: null,
  timeSemantics: "unconfirmed",
} as const;
const page = (
  ids = records.map((r) => r.matchId),
): Extract<LocalUnitInput, { kind: "page" }>["page"] => ({
  scanId: "scan:1",
  attempt: 1,
  identity,
  query,
  capture: capture("page:0"),
  response: { state: "success", ids },
});
const digest = (v: unknown) => createHash("sha256").update(localCanonical(v)).digest("hex");
async function makePlayer(id: string) {
  await db.insert(schema.players).values({
    id,
    gameName: "Synthetic",
    tagLine: "TEST",
    puuid: `fixture-${id}`,
    platform: "LA2",
    scanStart: new Date("2026-01-01Z"),
  });
}
async function revision() {
  return repo.revision(identity);
}
async function scan() {
  return repo.insertHeader(headerInput(), await revision());
}
async function fixtureSeal() {
  const h = await scan();
  const dispositions = records.map((r, i) => ({
    state: "resolved" as const,
    matchId: r.matchId,
    detail: { ...r, playerId: identity.playerId, platform: identity.platform },
    capture: capture(`detail:${i + 1}`),
  }));
  const values: LocalUnitInput[] = [
    { kind: "page", unitKey: "page:0:1", ordinal: 0, page: page() },
    ...dispositions.map((d, i) => ({
      kind: "disposition" as const,
      unitKey: `detail:${i + 1}`,
      ordinal: i + 1,
      previousUnitId: null,
      disposition: d,
    })),
  ];
  await repo.insertUnits(identity, h.id, values, await revision());
  function preparation(
    at: string,
  ): Omit<
    StructuralReceiptInput,
    "pages" | "dispositions" | "identity" | "sourceRevision" | "nature"
  > {
    const material = {
      version: EVIDENCE_FORMAT_VERSION,
      identity,
      scope: fixedScope,
      attribution: { state: "known", origin: "synthetic" },
      sourceRevision: { state: "declared", value: at },
      coverage: {
        source: "imported_history",
        historyStatus: "completed",
        unavailable: 0,
        intervalCoverage: "unproven",
      },
      manifest: { state: "declared", recordIds: records.map((r) => r.matchId) },
      kind: "matches",
      code: "unstoppable",
      records: records.map((record, i) => ({
        record,
        identity,
        capture: capture(`detail:${i + 1}`),
      })),
    } as const;
    const result = materializeAchievementEvidence(material);
    if (!result.contentFingerprint || !result.metadataFingerprint) throw Error("Invalid fixture");
    return {
      version: STRUCTURAL_RECEIPT_VERSION,
      scanId: "scan:1",
      query,
      target: {
        kind: "win_streak",
        interval: { ...interval, precision: "milliseconds", bounds: "half_open" },
        chosenWinIds: records.map((r) => r.matchId),
      },
      indexChange: { state: "unproven" },
      materialization: {
        input: structuredClone(material) as StructuralReceiptInput["materialization"]["input"],
        expectedContentFingerprint: result.contentFingerprint,
        expectedMetadataFingerprint: result.metadataFingerprint,
      },
    };
  }
  const input = preparation(await revision());
  const token = await repo.prepareSeal(identity, h.id, input);
  return { h, token, input, preparation };
}
const migrationFiles = readdirSync("drizzle")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const evidenceMigration = "0007_local_evidence_persistence.sql";
let legacyPreserved = false;
beforeAll(async () => {
  for (const file of migrationFiles.filter((file) => file < evidenceMigration))
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
  await pg.exec(
    `INSERT INTO players (id,game_name,tag_line,puuid,platform,scan_start) VALUES ('${identity.playerId}','Legacy','TEST','fictitious-legacy','LA2','2026-01-01T00:00:00Z');`,
  );
  await pg.exec(`INSERT INTO matches (id,queue_id,map_id,timestamp,duration) VALUES ('LA2_777',420,11,'2026-10-01T00:00:00Z',1800);
    INSERT INTO player_matches (player_id,match_id,champion,champion_id,position,kills,deaths,assists,cs,damage,win) VALUES ('${identity.playerId}','LA2_777','Synthetic',107,'JUNGLE',1,1,1,1,1,true);
    INSERT INTO ranked_snapshots (player_id,queue,tier,division,league_points,wins,losses) VALUES ('${identity.playerId}','RANKED_SOLO_5x5','DIAMOND','I',49,1,1);`);
  const tables = ["players", "matches", "player_matches", "ranked_snapshots", "sync_locks"];
  const prior = await Promise.all(
    tables.map((t) => pg.query(`SELECT to_jsonb(t) AS row FROM ${t} t ORDER BY to_jsonb(t)::text`)),
  );
  await pg.exec(readFileSync(`drizzle/${evidenceMigration}`, "utf8"));
  const after = await Promise.all(
    tables.map((t) =>
      pg.query(
        `SELECT ${t === "players" ? "to_jsonb(t) - 'source_revision'" : "to_jsonb(t)"} AS row FROM ${t} t ORDER BY to_jsonb(t)::text`,
      ),
    ),
  );
  legacyPreserved =
    JSON.stringify(prior.map((r) => r.rows)) === JSON.stringify(after.map((r) => r.rows));
  expect(await revision()).toBe("0");
  expect(await repo.list(identity)).toEqual([]);
  // Preserve the incremental 0007 assertion while exercising D on the latest constraints.
  for (const file of migrationFiles.filter((file) => file > evidenceMigration))
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
});
beforeEach(async () => {
  await db.delete(schema.players);
  await db.delete(schema.matches);
  await makePlayer(identity.playerId);
  await makePlayer(other.playerId);
});
afterAll(async () => {
  await pg.close();
});

describe("B.2.D migration and boundaries", () => {
  it("preserves legacy rows, null remake and unknown evidence without retrospective capture", () => {
    expect(legacyPreserved).toBe(true);
  });
  it("only adds two tables, one source column and additive constraints", () => {
    expect(migrationFiles.filter((file) => file <= evidenceMigration)).toHaveLength(8);
    const migration = readFileSync(`drizzle/${evidenceMigration}`, "utf8");
    expect(migration.match(/CREATE TABLE /g)).toHaveLength(2);
    expect(migration.match(/ADD COLUMN /g)).toHaveLength(1);
    expect(migration).not.toMatch(/(?:^|\n)\s*(DROP|UPDATE|DELETE|TRUNCATE|INSERT)\b/i);
    expect(migration).toContain('"source_revision" bigint DEFAULT 0 NOT NULL');
  });
  it("preserves all seven previous SQL hashes and journal entries", () => {
    const hashes = [
      "e27b3e40d42e52e77915441f24d1fd555040d2b7090f1e69685f3587ac27a57f",
      "d660c761bcc96627cf547541abdc b8e57588efb2d35a5d5c5838ebac3de0a094".replace(/ /g, ""),
      "d8cd002d35f692b1837e69180c5cbf8eaf15c664043685b9e70f0156b5772a7d",
      "acfb96077add6e8a42bbadcf212af53ecdb9e142e09cd5a8f05819e00dee7a04",
      "f35ddec7bcc709099a443d5112e80c421448b9206c5610b80b3a304f0beb43d5",
      "5a430264b495b7bc918d6ec6f73615eb4ab512d8a6e2ab4f9c3b32ffd5b23d82",
      "68395b97bf08755de2d87aa359c81f544afe4f62b9965685d92105f56e83270f",
    ];
    expect(
      migrationFiles.slice(0, 7).map((f) =>
        createHash("sha256")
          .update(readFileSync(`drizzle/${f}`))
          .digest("hex"),
      ),
    ).toEqual(hashes);
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    expect(journal.entries.slice(0, 7).map((v: { when: number }) => v.when)).toEqual([
      1791167254332, 1791168227900, 1791228584719, 1791242930764, 1791317502399, 1791520550115,
      1791587693380,
    ]);
    expect(
      journal.entries.map((v: { idx: number; tag: string }) => [v.idx, `${v.tag}.sql`]),
    ).toEqual(migrationFiles.map((f, i) => [i, f]));
    const current = JSON.parse(readFileSync("drizzle/meta/0007_snapshot.json", "utf8"));
    const previous = JSON.parse(readFileSync("drizzle/meta/0006_snapshot.json", "utf8"));
    expect(current.prevId).toBe(previous.id);
  });
  it("uses bigint without JSON precision loss", async () => {
    const n = 9007199254740993n;
    await db
      .update(schema.players)
      .set({ sourceRevision: n })
      .where(eq(schema.players.id, identity.playerId));
    expect(await revision()).toBe("9007199254740993");
    await repo.insertHeader(headerInput(), n.toString());
    expect(JSON.stringify({ revision: await revision() })).toBe('{"revision":"9007199254740994"}');
  });
  it("rejects negative revisions in PostgreSQL", async () => {
    await expect(
      db
        .update(schema.players)
        .set({ sourceRevision: -1n })
        .where(eq(schema.players.id, identity.playerId)),
    ).rejects.toThrow();
  });
  it.each(["-1", "01", "1.0", "1e3", "9223372036854775808"])(
    "rejects noncanonical/out-of-range revision %s",
    async (r) => {
      await expect(repo.insertHeader(headerInput(), r)).rejects.toMatchObject({ code: "invalid" });
      expect(await revision()).toBe("0");
    },
  );
  it("overflow rolls back header insertion", async () => {
    await db
      .update(schema.players)
      .set({ sourceRevision: MAX_REVISION })
      .where(eq(schema.players.id, identity.playerId));
    await expect(repo.insertHeader(headerInput(), MAX_REVISION.toString())).rejects.toMatchObject({
      code: "limit",
    });
    expect(await repo.list(identity)).toEqual([]);
  });
  it("keeps local repository server-only and unconnected", () => {
    const file = "src/server/achievements/verification/local-evidence-repository.ts";
    const code = readFileSync(file, "utf8");
    expect(code).toContain('import "server-only"');
    expect(code).not.toMatch(
      /from ["']@\/db["']|process\.env|fetch\(|DATABASE_URL|RiotClient|console\./,
    );
    function sourceFiles(path: string): string[] {
      return readdirSync(path, { withFileTypes: true }).flatMap((f) =>
        f.isDirectory()
          ? sourceFiles(resolve(path, f.name))
          : /\.(ts|tsx|mjs)$/.test(f.name)
            ? [resolve(path, f.name)]
            : [],
      );
    }
    for (const path of [...sourceFiles("src"), ...sourceFiles("scripts")].filter(
      (p) => !p.endsWith("local-evidence-repository.ts"),
    ))
      expect(readFileSync(path, "utf8")).not.toContain('from "./local-evidence-repository"');
  });
});

describe("private local header and unit transactions", () => {
  it("keeps legacy reception unknown and immutable", async () => {
    const h = await scan();
    expect(h.data).toMatchObject({ capture: legacy, source: "unknown" });
    expect(h.inputRevision).toBeNull();
    expect(h.sealedAtRevision).toBeNull();
    expect(h.grantAuthorized).toBe(false);
  });
  it("replays header without second revision even with old expected revision", async () => {
    const a = await scan();
    const b = await repo.insertHeader(headerInput(), "0");
    expect(b.id).toBe(a.id);
    expect(await revision()).toBe("1");
  });
  it("same operation key with differing content fails closed", async () => {
    await scan();
    await expect(
      repo.insertHeader({ ...headerInput(), interval: null }, "0"),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await revision()).toBe("1");
  });
  it("recovers after uncertain response in a new repository instance", async () => {
    const h = await scan();
    expect((await localEvidenceRepository(db).recover(identity, "scan:1"))?.id).toBe(h.id);
    expect(await revision()).toBe("1");
  });
  it("returns no operation for unknown key", async () => {
    expect(await repo.recover(identity, "absent")).toBeNull();
  });
  it("stale expected revision rolls back a new header", async () => {
    await scan();
    await expect(repo.insertHeader(headerInput("next"), "0")).rejects.toMatchObject({
      code: "revision",
    });
    expect(await repo.list(identity)).toHaveLength(1);
  });
  it.each(["riot", "stored"])("does not authenticate %s declarations", async (source) => {
    await expect(repo.insertHeader({ ...headerInput(), source }, "0")).rejects.toMatchObject({
      code: "invalid",
    });
  });
  it.each(["puuid", "DATABASE_URL", "token", "payload", "grantAuthorized"])(
    "rejects unexpected field %s without logging it",
    async (key) => {
      await expect(
        repo.insertHeader({ ...headerInput(), [key]: "sensitive" }, "0"),
      ).rejects.toMatchObject({ code: "invalid", message: "Local evidence: invalid" });
    },
  );
  it("rejects foreign owner at repository boundary", async () => {
    const h = await repo.insertHeader(headerInput("other", other), "0");
    await expect(repo.insertUnits(identity, h.id, [pending()], "0")).rejects.toMatchObject({
      code: "missing",
    });
  });
  it("does not leak another owner/scope through recover", async () => {
    await scan();
    expect(await repo.recover(other, "scan:1")).toBeNull();
    await expect(repo.recover({ ...identity, season: "2025" }, "scan:1")).rejects.toMatchObject({
      code: "conflict",
    });
  });
  it("rejects different platform owner and cross-scope parents", async () => {
    const h = await scan();
    await expect(
      repo.insertHeader(
        {
          ...headerInput("child"),
          identity: { ...identity, queue: "RANKED_FLEX_SR" },
          parentId: h.id,
        },
        "1",
      ),
    ).rejects.toMatchObject({ code: "missing" });
    await expect(repo.revision({ ...identity, platform: "LA1" })).rejects.toMatchObject({
      code: "conflict",
    });
  });
  it("inserts a batch with exactly one DB arithmetic increment", async () => {
    const h = await scan();
    await repo.insertUnits(
      identity,
      h.id,
      [
        pending(),
        { ...pending("pending:2", 1), disposition: { state: "unknown", matchId: "LA2_2" } },
      ],
      "1",
    );
    expect(await revision()).toBe("2");
  });
  it("idempotent unit replay preserves ID, revision and count", async () => {
    const h = await scan();
    const a = await repo.insertUnits(identity, h.id, [pending()], "1");
    const b = await repo.insertUnits(identity, h.id, [pending()], "1");
    expect(b).toEqual(a);
    expect(await revision()).toBe("2");
  });
  it("same unit key with differing contents rejects entire batch", async () => {
    const h = await scan();
    await repo.insertUnits(identity, h.id, [pending()], "1");
    await expect(
      repo.insertUnits(
        identity,
        h.id,
        [
          { ...pending(), disposition: { state: "unknown", matchId: "LA2_1" } },
          { ...pending("new", 1), disposition: { state: "pending", matchId: "LA2_2" } },
        ],
        "2",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await repo.effective(identity, h.id, "2")).unitIds).toHaveLength(1);
    expect(await revision()).toBe("2");
  });
  it("duplicate ordinal constraint rolls back revision and all units", async () => {
    const h = await scan();
    await repo.insertUnits(identity, h.id, [pending()], "1");
    await expect(
      repo.insertUnits(
        identity,
        h.id,
        [{ ...pending("collision"), disposition: { state: "pending", matchId: "LA2_2" } }],
        "2",
      ),
    ).rejects.toThrow();
    expect(await revision()).toBe("2");
  });
  it("missing predecessor and stale transition fail closed", async () => {
    const h = await scan();
    const [p] = await repo.insertUnits(identity, h.id, [pending()], "1");
    await expect(
      repo.insertUnits(identity, h.id, [resolveFirst(other.playerId)], "2"),
    ).rejects.toMatchObject({ code: "conflict" });
    await repo.insertUnits(identity, h.id, [resolveFirst(p.id)], "2");
    await expect(
      repo.insertUnits(identity, h.id, [{ ...resolveFirst(p.id, 2), unitKey: "retry:wrong" }], "3"),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await revision()).toBe("3");
  });
  it("preserves event history and projects pending→resolved to each exact revision", async () => {
    const h = await scan();
    const [p] = await repo.insertUnits(identity, h.id, [pending()], "1");
    await repo.insertUnits(identity, h.id, [resolveFirst(p.id)], "2");
    expect((await repo.effective(identity, h.id, "2")).dispositions[0].state).toBe("pending");
    const effective = await repo.effective(identity, h.id, "3");
    expect(effective.dispositions[0].state).toBe("resolved");
    expect(effective.unitIds).toHaveLength(2);
    expect(await repo.effective(identity, h.id, "3")).toEqual(effective);
  });
  it("does not replace a terminal detail with another successful detail", async () => {
    const h = await scan();
    const value = { ...resolveFirst(other.playerId), previousUnitId: null };
    const [p] = await repo.insertUnits(identity, h.id, [value], "1");
    await expect(
      repo.insertUnits(identity, h.id, [{ ...resolveFirst(p.id, 2), unitKey: "changed" }], "2"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("unknown/404 details stay incomplete rather than becoming resolved", async () => {
    const h = await scan();
    await repo.insertUnits(
      identity,
      h.id,
      [{ ...pending(), disposition: { state: "unavailable_404", matchId: "LA2_1" } }],
      "1",
    );
    expect((await repo.effective(identity, h.id, "2")).dispositions).toEqual([
      { state: "unavailable_404", matchId: "LA2_1" },
    ]);
  });
  it("rejects projection from the future", async () => {
    const h = await scan();
    await expect(repo.effective(identity, h.id, "2")).rejects.toMatchObject({ code: "revision" });
  });
  it("rejects page/detail owner mismatches", async () => {
    const h = await scan();
    await expect(
      repo.insertUnits(
        identity,
        h.id,
        [{ kind: "page", unitKey: "page", ordinal: 0, page: { ...page(), identity: other } }],
        "1",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const d = resolveFirst(other.playerId);
    if (d.kind !== "disposition" || d.disposition.state !== "resolved") throw Error("fixture");
    d.previousUnitId = null;
    d.disposition.detail.playerId = other.playerId;
    await expect(repo.insertUnits(identity, h.id, [d], "1")).rejects.toMatchObject({
      code: "conflict",
    });
  });
  it("rejects oversized batch and no evidence is silently truncated", async () => {
    const h = await scan();
    await expect(
      repo.insertUnits(
        identity,
        h.id,
        Array.from({ length: 101 }, (_, i) => pending(`p:${i}`, i)),
        "1",
      ),
    ).rejects.toMatchObject({ code: "limit" });
    expect((await repo.effective(identity, h.id, "1")).unitIds).toEqual([]);
  });
  it("rejects oversized unit in DB even if repository is bypassed", async () => {
    const h = await scan();
    await expect(
      db.insert(schema.achievementEvidenceUnits).values({
        ...identity,
        headerId: h.id,
        kind: "snapshot",
        unitKey: "big",
        ordinal: 0,
        revision: 1n,
        fingerprint: "0".repeat(64),
        data: { value: "x".repeat(16384) },
      }),
    ).rejects.toThrow();
  });
  it("enforces header count budget under the owner lock", async () => {
    await db.insert(schema.achievementEvidenceHeaders).values(
      Array.from({ length: 1000 }, (_, i) => ({
        ...identity,
        kind: "match_scan" as const,
        status: "collecting" as const,
        source: "unknown" as const,
        version: LOCAL_EVIDENCE_VERSION,
        operationKey: `limit:${i}`,
        data: {},
      })),
    );
    await expect(scan()).rejects.toMatchObject({ code: "limit" });
    expect(await revision()).toBe("0");
  });
  it("supports rank captures without touching actual ranked snapshots", async () => {
    const h = await repo.insertHeader({ ...headerInput(), kind: "rank_capture" }, "0");
    const value: LocalUnitInput = {
      kind: "snapshot",
      unitKey: "snapshot:1",
      ordinal: 0,
      capture: legacy,
      snapshot: {
        id: "synthetic:1",
        queue: identity.queue,
        timestamp: interval.from,
        tier: "DIAMOND",
        division: "I",
        leaguePoints: 49,
        wins: 2,
        losses: 1,
      },
    };
    await repo.insertUnits(identity, h.id, [value], "1");
    expect(await db.select().from(schema.rankedSnapshots)).toEqual([]);
    await expect(
      repo.insertUnits(identity, h.id, [pending("wrong", 1)], "2"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("local structural seal and D13", () => {
  it("seals R→R+1 without hashing its own revision and remains untrusted", async () => {
    const { token } = await fixtureSeal();
    const h = await repo.seal(token, "seal:1");
    expect(h.inputRevision).toBe("2");
    expect(h.sealedAtRevision).toBe("3");
    expect(h.fingerprint).toBe(token.fingerprint);
    expect(h.data.inputRevision).toBe("2");
    expect(h.data).not.toHaveProperty("sealedAtRevision");
    expect(h).toMatchObject({
      grantAuthorized: false,
      certification: "not_established",
      provenanceAuthentication: "not_performed",
    });
    expect((await repo.sealState(identity, h.id)).state).toBe("local_revision_unchanged");
  });
  it("replays same seal without new ID, references or revision", async () => {
    const { token } = await fixtureSeal();
    const a = await repo.seal(token, "seal:1");
    const b = await repo.seal(token, "seal:1");
    expect(b.id).toBe(a.id);
    expect(await revision()).toBe("3");
    expect(
      await db
        .select()
        .from(schema.achievementEvidenceUnits)
        .where(eq(schema.achievementEvidenceUnits.headerId, a.id)),
    ).toHaveLength(6);
  });
  it("can reproduce full receipt after process restart using references and minimal context", async () => {
    const { token } = await fixtureSeal();
    const h = await repo.seal(token, "seal:1");
    const result = await localEvidenceRepository(db).reproduceSeal(identity, h.id);
    expect(result.fingerprint).toBe(token.fingerprint);
    expect(result.grantAuthorized).toBe(false);
    expect(result.certification).toBe("not_established");
    expect(result.content?.sourceRevision).toEqual({ state: "declared", value: "2" });
  });
  it("does not accept fabricated preparation token", async () => {
    await expect(
      repo.seal(
        { inputRevision: "0", fingerprint: "0".repeat(64), status: "structurally_complete" },
        "fake",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await revision()).toBe("0");
  });
  it("later source requires review without self invalidation or altering original fingerprint", async () => {
    const { h: scanHeader, token } = await fixtureSeal();
    const h = await repo.seal(token, "seal:1");
    await repo.insertUnits(
      identity,
      scanHeader.id,
      [{ ...pending("later", 10), disposition: { state: "pending", matchId: "LA2_99" } }],
      "3",
    );
    expect((await repo.sealState(identity, h.id)).state).toBe("review_required");
    expect((await repo.reproduceSeal(identity, h.id)).fingerprint).toBe(token.fingerprint);
  });
  it("stale preparation fails with no seal or revision increment", async () => {
    const { token } = await fixtureSeal();
    await repo.insertHeader(headerInput("later"), "2");
    await expect(repo.seal(token, "seal:1")).rejects.toMatchObject({ code: "revision" });
    expect(await repo.recover(identity, "seal:1")).toBeNull();
    expect(await revision()).toBe("3");
  });
  it("conflicting operation key rolls back", async () => {
    const { token } = await fixtureSeal();
    await repo.insertHeader(headerInput("taken"), "2");
    await expect(repo.seal(token, "taken")).rejects.toMatchObject({ code: "conflict" });
    expect(await revision()).toBe("3");
  });
  it("failed reference insert rolls back receipt and arithmetic revision", async () => {
    const { token } = await fixtureSeal();
    await pg.exec(
      `CREATE FUNCTION local_test_fail_ref() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'reference' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER local_fail_ref BEFORE INSERT ON achievement_evidence_units FOR EACH ROW EXECUTE FUNCTION local_test_fail_ref();`,
    );
    try {
      await expect(repo.seal(token, "seal:1")).rejects.toThrow();
      expect(await revision()).toBe("2");
      expect(await repo.recover(identity, "seal:1")).toBeNull();
    } finally {
      await pg.exec(
        "DROP TRIGGER local_fail_ref ON achievement_evidence_units; DROP FUNCTION local_test_fail_ref();",
      );
    }
    const h = await repo.seal(token, "seal:1");
    expect(h.sealedAtRevision).toBe("3");
  });
  it("incomplete capture cannot seal and cannot invent terminal pages", async () => {
    const { h, preparation } = await fixtureSeal();
    await repo.insertUnits(
      identity,
      h.id,
      [{ ...pending("unresolved", 10), disposition: { state: "pending", matchId: "LA2_99" } }],
      "2",
    );
    await expect(repo.prepareSeal(identity, h.id, preparation("3"))).rejects.toMatchObject({
      code: "incomplete",
    });
  });
  it("missing stored terminal page blocks sealing even with matching revision", async () => {
    const { h, input } = await fixtureSeal();
    const [p] = await db
      .select()
      .from(schema.achievementEvidenceUnits)
      .where(eq(schema.achievementEvidenceUnits.headerId, h.id));
    await db
      .delete(schema.achievementEvidenceUnits)
      .where(eq(schema.achievementEvidenceUnits.id, p.id));
    await expect(repo.prepareSeal(identity, h.id, input)).rejects.toMatchObject({
      code: "incomplete",
    });
  });
  it("does not accept a materialization that claims Riot provenance", async () => {
    const { h, input } = await fixtureSeal();
    input.materialization.input.attribution = { state: "known", origin: "riot" };
    const rematerialized = materializeAchievementEvidence(input.materialization.input);
    if (!rematerialized.contentFingerprint || !rematerialized.metadataFingerprint)
      throw Error("fixture");
    input.materialization.expectedContentFingerprint = rematerialized.contentFingerprint;
    input.materialization.expectedMetadataFingerprint = rematerialized.metadataFingerprint;
    await expect(repo.prepareSeal(identity, h.id, input)).rejects.toMatchObject({
      code: "invalid",
    });
  });
  it("serialized seal revisions remain decimal strings beyond Number.MAX_SAFE_INTEGER", async () => {
    await db
      .update(schema.players)
      .set({ sourceRevision: 9007199254740993n })
      .where(eq(schema.players.id, identity.playerId));
    const { token } = await fixtureSeal();
    const h = await repo.seal(token, "large:seal");
    const value = JSON.parse(JSON.stringify(h));
    expect(value.inputRevision).toBe("9007199254740995");
    expect(value.sealedAtRevision).toBe("9007199254740996");
  });
  it("a late failure in a unit batch rolls back prefix and revision", async () => {
    const h = await scan();
    const good = {
      ...pending("first"),
      disposition: { state: "pending" as const, matchId: "LA2_2" },
    };
    await expect(
      repo.insertUnits(identity, h.id, [good, resolveFirst(other.playerId, 1)], "1"),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await repo.effective(identity, h.id, "1")).unitIds).toEqual([]);
    expect(await revision()).toBe("1");
  });
  it("foreign source reference fails even under a valid owned header", async () => {
    const a = await scan();
    const [u] = await repo.insertUnits(identity, a.id, [pending()], "1");
    const b = await repo.insertHeader(headerInput("other:header", other), "0");
    await expect(
      db
        .insert(schema.achievementEvidenceUnits)
        .values({
          ...other,
          headerId: b.id,
          kind: "reference",
          unitKey: "foreign",
          ordinal: 0,
          referenceUnitId: u.id,
          revision: 1n,
          fingerprint: "0".repeat(64),
          data: {},
        }),
    ).rejects.toThrow();
  });
  it("rejects oversized page instead of truncating discovered IDs", async () => {
    const h = await scan();
    const ids = Array.from({ length: 100 }, (_, i) => `LA2_${String(i).padStart(220, "1")}`);
    await expect(
      repo.insertUnits(
        identity,
        h.id,
        [
          {
            kind: "page",
            unitKey: "huge:page",
            ordinal: 0,
            page: { ...page(ids), query: { ...query, count: 100 } },
          },
        ],
        "1",
      ),
    ).rejects.toMatchObject({ code: "limit" });
    expect((await repo.effective(identity, h.id, "1")).unitIds).toEqual([]);
  });
  it("immutable payload corruption is detected before projection", async () => {
    const h = await scan();
    const [u] = await repo.insertUnits(identity, h.id, [pending()], "1");
    await db
      .update(schema.achievementEvidenceUnits)
      .set({
        data: {
          version: LOCAL_EVIDENCE_VERSION,
          ...pending(),
          disposition: { state: "unknown", matchId: "LA2_1" },
        },
      })
      .where(eq(schema.achievementEvidenceUnits.id, u.id));
    await expect(repo.effective(identity, h.id, "2")).rejects.toMatchObject({ code: "conflict" });
  });
  it("DB rejects cross-owner/scope links independent of repository", async () => {
    const h = await scan();
    const [u] = await repo.insertUnits(identity, h.id, [pending()], "1");
    const base = {
      ...identity,
      headerId: h.id,
      kind: "reference" as const,
      unitKey: "ref",
      ordinal: 1,
      revision: 2n,
      fingerprint: digest({}),
      data: {},
      referenceUnitId: u.id,
    };
    await expect(
      db.insert(schema.achievementEvidenceUnits).values({ ...base, playerId: other.playerId }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.achievementEvidenceUnits).values({ ...base, season: "2025" }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.achievementEvidenceHeaders).values({
        ...other,
        kind: "match_scan",
        status: "collecting",
        source: "unknown",
        version: LOCAL_EVIDENCE_VERSION,
        operationKey: "parent:foreign",
        parentId: h.id,
        data: {},
      }),
    ).rejects.toThrow();
  });
  it("DB requires owner and cannot seal with null fingerprint/revision", async () => {
    await expect(
      pg.exec(
        "INSERT INTO achievement_evidence_headers (player_id,platform,queue,season,kind,status,source,version,operation_key,data) VALUES (NULL,'LA2','RANKED_SOLO_5x5','2026','match_scan','collecting','unknown','v','bad','{}')",
      ),
    ).rejects.toThrow();
    const h = await scan();
    await expect(
      db.insert(schema.achievementEvidenceHeaders).values({
        ...identity,
        kind: "structural_receipt",
        status: "sealed",
        source: "synthetic",
        version: LOCAL_EVIDENCE_VERSION,
        operationKey: "bad:seal",
        parentId: h.id,
        inputRevision: 1n,
        data: {},
      }),
    ).rejects.toThrow();
  });
  it("deleting owner cascades captures, events, receipts and references, preserves other owner", async () => {
    const { token } = await fixtureSeal();
    await repo.seal(token, "seal:1");
    const otherHeader = await repo.insertHeader(headerInput("other", other), "0");
    await repo.insertUnits(other, otherHeader.id, [pending()], "1");
    await db.delete(schema.players).where(eq(schema.players.id, identity.playerId));
    expect(
      await db
        .select()
        .from(schema.achievementEvidenceHeaders)
        .where(eq(schema.achievementEvidenceHeaders.playerId, identity.playerId)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.achievementEvidenceUnits)
        .where(eq(schema.achievementEvidenceUnits.playerId, identity.playerId)),
    ).toEqual([]);
    expect(await repo.list(other)).toHaveLength(1);
    expect(await repo.effective(other, otherHeader.id, "2")).toMatchObject({
      dispositions: [{ state: "pending" }],
    });
  });
  it("private evidence deletion is transactional, owner-wide and leaves no personal tombstone", async () => {
    const { token } = await fixtureSeal();
    await repo.seal(token, "seal:1");
    await repo.insertHeader(headerInput("flex", { ...identity, queue: "RANKED_FLEX_SR" }), "3");
    await repo.insertHeader(headerInput("other", other), "0");
    await expect(repo.deleteEvidence(identity, "3")).rejects.toMatchObject({ code: "revision" });
    expect(await repo.list(identity)).toHaveLength(2);
    expect(await repo.deleteEvidence(identity, "4")).toEqual({ deletedHeaders: 3 });
    expect(await repo.list(identity)).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.achievementEvidenceUnits)
        .where(eq(schema.achievementEvidenceUnits.playerId, identity.playerId)),
    ).toEqual([]);
    expect(await repo.list(other)).toHaveLength(1);
    expect(await revision()).toBe("5");
    expect(await repo.deleteEvidence(identity, "5")).toEqual({ deletedHeaders: 0 });
    expect(await revision()).toBe("5");
  });
  it("never touches operational matches, snapshots, sync lock or grant storage", async () => {
    const before = await Promise.all([
      db.select().from(schema.matches),
      db.select().from(schema.playerMatches),
      db.select().from(schema.rankedSnapshots),
      db.select().from(schema.syncLocks),
    ]);
    const { token } = await fixtureSeal();
    await repo.seal(token, "seal:1");
    const after = await Promise.all([
      db.select().from(schema.matches),
      db.select().from(schema.playerMatches),
      db.select().from(schema.rankedSnapshots),
      db.select().from(schema.syncLocks),
    ]);
    expect(after).toEqual(before);
    const tables = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`,
    );
    expect(tables.rows.map((r) => r.table_name)).not.toContain("achievement_grants");
  });
});
