import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { headerSchema } from "@/server/achievements/verification/persistence-contracts";
import { operationalCaptureInputSchema } from "@/server/achievements/verification/operational-capture-contracts";

const base = "81d617c93e23d8dffe1681a6f0c90e24d03946ab";
const file = "0008_operational_capture_support.sql";
const migrationSql = readFileSync(`drizzle/${file}`, "utf8");
const pg = new PGlite();
const db = drizzle(pg, { schema });
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const headerId = "33333333-3333-4333-8333-333333333333";
const unitId = "44444444-4444-4444-8444-444444444444";
const prefixDir = mkdtempSync(join(tmpdir(), "soloq-0008-"));
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const originalJournal = JSON.parse(
  execFileSync("git", ["show", `${base}:drizzle/meta/_journal.json`], {
    encoding: "utf8",
    windowsHide: true,
  }),
);
const oldFiles = originalJournal.entries.map(
  (entry: { tag: string }) => `${entry.tag}.sql`,
) as string[];
let oldRows: unknown[];
let migratedRows: unknown[];
let oldConstraints: { conname: string; definition: string }[];

async function rows() {
  const tables = [
    "players",
    "matches",
    "player_matches",
    "ranked_snapshots",
    "sync_locks",
    "admin_sessions",
    "login_attempts",
    "achievement_evidence_headers",
    "achievement_evidence_units",
  ];
  // Text preserves bigint and JSON fingerprints exactly, without JS numeric rounding.
  const result = [];
  for (const table of tables)
    result.push(
      (
        await pg.query(
          `SELECT row_to_json(t)::text AS row FROM ${table} t ORDER BY row_to_json(t)::text`,
        )
      ).rows,
    );
  return result;
}
async function constraints() {
  return (
    await pg.query<{ conname: string; definition: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
     WHERE conrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace) ORDER BY conname`,
    )
  ).rows;
}
async function players() {
  for (const id of [owner, other])
    await db
      .insert(schema.players)
      .values({
        id,
        gameName: "Synthetic",
        tagLine: "TEST",
        puuid: `fictional-${id}`,
        platform: "LA2",
        scanStart: new Date("2026-01-01T00:00:00Z"),
        sourceRevision: 9007199254740993n,
      });
}
async function header(patch: Partial<typeof schema.achievementEvidenceHeaders.$inferInsert> = {}) {
  return db
    .insert(schema.achievementEvidenceHeaders)
    .values({
      id: headerId,
      playerId: owner,
      platform: "LA2",
      queue: "RANKED_SOLO_5x5",
      season: "2026",
      kind: "identity_capture",
      status: "collecting",
      source: "server_riot_received",
      version: "sql-fixture-only-v1",
      operationKey: "fixture:identity",
      data: { fixture: true, receivedAt: null, captureId: null },
      ...patch,
    })
    .returning();
}
async function unit(patch: Partial<typeof schema.achievementEvidenceUnits.$inferInsert> = {}) {
  return db
    .insert(schema.achievementEvidenceUnits)
    .values({
      id: unitId,
      playerId: owner,
      headerId,
      platform: "LA2",
      queue: "RANKED_SOLO_5x5",
      season: "2026",
      kind: "snapshot",
      unitKey: "fixture:unit",
      ordinal: 0,
      revision: 9007199254740993n,
      fingerprint: "a".repeat(64),
      data: { fixture: true },
      ...patch,
    })
    .returning();
}
beforeAll(async () => {
  mkdirSync(join(prefixDir, "meta"));
  writeFileSync(join(prefixDir, "meta", "_journal.json"), JSON.stringify(originalJournal));
  for (const name of oldFiles) copyFileSync(resolve("drizzle", name), join(prefixDir, name));
  // Actual installed Drizzle migrator, not individual ALTER statements.
  await migrate(db, { migrationsFolder: prefixDir });
  await players();
  await header({ kind: "rank_capture", source: "unknown" });
  await unit();
  await header({
    id: "55555555-5555-4555-8555-555555555555",
    playerId: other,
    source: "synthetic",
    kind: "match_scan",
    operationKey: "fixture:other",
  });
  await header({
    id: "66666666-6666-4666-8666-666666666666",
    kind: "structural_receipt",
    source: "synthetic",
    status: "sealed",
    parentId: headerId,
    operationKey: "fixture:seal",
    inputRevision: 9007199254740992n,
    sealedAtRevision: 9007199254740993n,
    fingerprint: "b".repeat(64),
  });
  await pg.exec(`INSERT INTO matches(id,queue_id,map_id,timestamp,duration,is_remake) VALUES ('LA2_1',420,11,'2026-10-01T00:00:00Z',1800,NULL);
    INSERT INTO player_matches(player_id,match_id,champion,champion_id,position,kills,deaths,assists,cs,damage,win) VALUES ('${owner}','LA2_1','Synthetic',107,'JUNGLE',1,1,1,1,1,true);
    INSERT INTO ranked_snapshots(player_id,queue,tier,division,league_points,wins,losses) VALUES ('${owner}','RANKED_SOLO_5x5','DIAMOND','I',49,1,1);
    INSERT INTO sync_locks(name,owner,expires_at) VALUES ('riot','${owner}','2026-10-01T00:00:00Z');`);
  oldRows = await rows();
  oldConstraints = await constraints();
  await migrate(db, { migrationsFolder: "drizzle" });
  migratedRows = await rows();
});
beforeEach(async () => {
  await pg.exec("TRUNCATE players, matches, sync_locks CASCADE");
  await players();
});
afterAll(async () => {
  await pg.close();
  if (dirname(prefixDir) !== tmpdir() || !basename(prefixDir).startsWith("soloq-0008-"))
    throw Error("Invalid disposable directory");
  rmSync(prefixDir, { recursive: true, force: true });
});

describe("0008 operational capture SQL support only", () => {
  it("preserves every legacy row, bigint, fingerprint, source and nullable reception field", () => {
    expect(migratedRows).toEqual(oldRows);
    expect(JSON.stringify(migratedRows)).toContain("9007199254740993");
    expect(JSON.stringify(migratedRows)).not.toContain("server_riot_received");
  });
  it("contains exactly four reviewed constraint statements and no incidental DDL or DML", () => {
    expect(migrationSql.split("--> statement-breakpoint").map((s) => s.trim())).toEqual([
      'ALTER TABLE "achievement_evidence_headers" DROP CONSTRAINT "evidence_header_kind";',
      'ALTER TABLE "achievement_evidence_headers" DROP CONSTRAINT "evidence_header_source";',
      "ALTER TABLE \"achievement_evidence_headers\" ADD CONSTRAINT \"evidence_header_kind\" CHECK (\"achievement_evidence_headers\".\"kind\" IN ('rank_capture', 'match_scan', 'structural_receipt', 'identity_capture'));",
      'ALTER TABLE "achievement_evidence_headers" ADD CONSTRAINT "evidence_header_source" CHECK ("achievement_evidence_headers"."source" IN (\'unknown\', \'synthetic\', \'server_riot_received\'));',
    ]);
    expect(migrationSql).not.toMatch(
      /\b(?:UPDATE|DELETE|INSERT|TRUNCATE|CREATE TABLE|DROP TABLE|ADD COLUMN)\b/i,
    );
  });
  it("preserves all constraints except the two explicitly widened checks", async () => {
    const excluded = new Set(["evidence_header_kind", "evidence_header_source"]);
    expect((await constraints()).filter((r) => !excluded.has(r.conname))).toEqual(
      oldConstraints.filter((r) => !excluded.has(r.conname)),
    );
    expect((await constraints()).filter((r) => excluded.has(r.conname))).toHaveLength(2);
  });
  it("registers nine migrations, including the generated SQL hash, and reruns without changes", async () => {
    const before = (
      await pg.query(
        "SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at",
      )
    ).rows;
    expect(before).toHaveLength(9);
    expect(before[8]).toEqual({
      hash: createHash("sha256").update(migrationSql).digest("hex"),
      created_at: String(journal.entries[8].when),
    });
    await migrate(db, { migrationsFolder: "drizzle" });
    expect(
      (
        await pg.query(
          "SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at",
        )
      ).rows,
    ).toEqual(before);
  });
  it("keeps the exact historical SQL, snapshots and journal prefix", () => {
    const names = [
      ...oldFiles,
      ...Array.from({ length: 8 }, (_, i) => `meta/${String(i).padStart(4, "0")}_snapshot.json`),
    ];
    for (const name of names) {
      const original = execFileSync("git", ["show", `${base}:drizzle/${name}`], {
        windowsHide: true,
      });
      expect(
        createHash("sha256")
          .update(readFileSync(`drizzle/${name}`))
          .digest("hex"),
        name,
      ).toBe(createHash("sha256").update(original).digest("hex"));
    }
    expect(journal.entries).toHaveLength(9);
    expect(journal.entries.slice(0, 8)).toEqual(originalJournal.entries);
    expect(journal.entries[8]).toMatchObject({
      idx: 8,
      version: "7",
      tag: "0008_operational_capture_support",
      breakpoints: true,
    });
    expect(journal.entries[8].when).toBeGreaterThan(journal.entries[7].when);
    expect(
      readdirSync("drizzle")
        .filter((f) => f.endsWith(".sql"))
        .sort(),
    ).toEqual([...oldFiles, file]);
  });
  it("links the generated snapshot to 0007 with only two check differences", () => {
    const prev = JSON.parse(readFileSync("drizzle/meta/0007_snapshot.json", "utf8"));
    const next = JSON.parse(readFileSync("drizzle/meta/0008_snapshot.json", "utf8"));
    expect(next.prevId).toBe(prev.id);
    expect(next.id).not.toBe(prev.id);
    const checks = next.tables["public.achievement_evidence_headers"].checkConstraints;
    expect(checks.evidence_header_kind.value).toContain("'identity_capture'");
    expect(checks.evidence_header_source.value).toContain("'server_riot_received'");
    checks.evidence_header_kind =
      prev.tables["public.achievement_evidence_headers"].checkConstraints.evidence_header_kind;
    checks.evidence_header_source =
      prev.tables["public.achievement_evidence_headers"].checkConstraints.evidence_header_source;
    expect({ ...next, id: prev.id, prevId: prev.prevId }).toEqual(prev);
  });
  it("rolls back constraint drops if migration replacement fails", async () => {
    const temporary = new PGlite();
    try {
      await migrate(drizzle(temporary), { migrationsFolder: prefixDir });
      const before = (
        await temporary.query(
          "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='achievement_evidence_headers'::regclass ORDER BY conname",
        )
      ).rows;
      await expect(
        temporary.transaction(async (tx) => {
          await tx.exec(migrationSql.split("--> statement-breakpoint")[0]);
          await tx.exec(migrationSql.split("--> statement-breakpoint")[1]);
          await tx.exec("SELECT 1/0");
        }),
      ).rejects.toThrow();
      expect(
        (
          await temporary.query(
            "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='achievement_evidence_headers'::regclass ORDER BY conname",
          )
        ).rows,
      ).toEqual(before);
      expect((await temporary.query("SELECT * FROM achievement_evidence_headers")).rows).toEqual(
        [],
      );
    } finally {
      await temporary.close();
    }
  });
  it.each(["unknown", "synthetic", "server_riot_received"] as const)(
    "accepts source %s as a database label, never proof",
    async (source) => {
      const [h] = await header({ source });
      expect(h.source).toBe(source);
      expect(h.data).toEqual({ fixture: true, receivedAt: null, captureId: null });
      expect(
        (await db.select({ r: schema.players.sourceRevision }).from(schema.players))[0].r,
      ).toBe(9007199254740993n);
    },
  );
  it.each(["rank_capture", "match_scan", "identity_capture"] as const)(
    "accepts scoped collecting %s",
    async (kind) => {
      expect((await header({ kind }))[0]).toMatchObject({
        kind,
        playerId: owner,
        platform: "LA2",
        queue: "RANKED_SOLO_5x5",
        season: "2026",
      });
    },
  );
  it.each(["authenticated", "client", "riot"])("rejects arbitrary source %s", async (source) => {
    await expect(
      pg.query(
        `INSERT INTO achievement_evidence_headers(player_id,platform,queue,season,kind,status,source,version,operation_key,data) VALUES ($1,'LA2','RANKED_SOLO_5x5','2026','identity_capture','collecting',$2,'fixture','invalid','{}')`,
        [owner, source],
      ),
    ).rejects.toThrow();
  });
  it.each(["grant", "identity_global", "arbitrary"])("rejects arbitrary kind %s", async (kind) => {
    await expect(
      pg.query(
        `INSERT INTO achievement_evidence_headers(player_id,platform,queue,season,kind,status,source,version,operation_key,data) VALUES ($1,'LA2','RANKED_SOLO_5x5','2026',$2,'collecting','unknown','fixture','invalid','{}')`,
        [owner, kind],
      ),
    ).rejects.toThrow();
  });
  it("keeps identity tied to one ranked scope, not all queues", async () => {
    await header();
    await expect(unit({ queue: "RANKED_FLEX_SR" })).rejects.toThrow();
    await expect(unit({ season: "2025" })).rejects.toThrow();
    await expect(unit({ platform: "NA1" })).rejects.toThrow();
    await expect(
      pg.exec(`UPDATE achievement_evidence_headers SET queue='all' WHERE id='${headerId}'`),
    ).rejects.toThrow();
    await expect(
      pg.exec(`UPDATE achievement_evidence_headers SET queue=NULL WHERE id='${headerId}'`),
    ).rejects.toThrow();
  });
  it("requires an existing owner and rejects cross-owner parent and unit references", async () => {
    await expect(header({ playerId: headerId })).rejects.toThrow();
    await expect(
      pg.query(
        `INSERT INTO achievement_evidence_headers(player_id,platform,queue,season,kind,status,source,version,operation_key,data) VALUES (NULL,'LA2','RANKED_SOLO_5x5','2026','identity_capture','collecting','unknown','fixture','invalid','{}')`,
      ),
    ).rejects.toThrow();
    await header();
    await unit();
    await expect(
      header({
        id: "55555555-5555-4555-8555-555555555555",
        playerId: other,
        operationKey: "other:parent",
        parentId: headerId,
      }),
    ).rejects.toThrow();
    await expect(
      unit({ id: "55555555-5555-4555-8555-555555555555", playerId: other }),
    ).rejects.toThrow();
  });
  it("cascades all owner evidence and preserves another player's evidence", async () => {
    await header();
    await unit();
    const otherHeader = "55555555-5555-4555-8555-555555555555";
    await header({ id: otherHeader, playerId: other, operationKey: "other:identity" });
    await unit({
      id: "66666666-6666-4666-8666-666666666666",
      playerId: other,
      headerId: otherHeader,
    });
    await pg.query("DELETE FROM players WHERE id=$1", [owner]);
    expect(
      (await db.select().from(schema.achievementEvidenceHeaders)).map((h) => h.playerId),
    ).toEqual([other]);
    expect(
      (await db.select().from(schema.achievementEvidenceUnits)).map((u) => u.playerId),
    ).toEqual([other]);
  });
  it("preserves RLS, policy absence and role denial with populated new-value rows", async () => {
    await header();
    await unit();
    const tables = (
      await pg.query<{ tablename: string; rowsecurity: boolean }>(
        "SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows;
    expect(tables).toHaveLength(9);
    expect(tables.every((t) => t.rowsecurity)).toBe(true);
    expect(tables.map((t) => t.tablename)).not.toContain("achievement_grants");
    expect((await pg.query("SELECT * FROM pg_policies WHERE schemaname='public'")).rows).toEqual(
      [],
    );
    expect(await db.select().from(schema.achievementEvidenceHeaders)).toHaveLength(1);
    await pg.exec(
      "CREATE ROLE capture_reader; GRANT USAGE ON SCHEMA public TO capture_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO capture_reader; SET ROLE capture_reader",
    );
    try {
      for (const t of tables)
        expect((await pg.query(`SELECT * FROM ${t.tablename}`)).rows).toEqual([]);
    } finally {
      await pg.exec("RESET ROLE; DROP OWNED BY capture_reader; DROP ROLE capture_reader");
    }
  });
  it.each([
    { status: "sealed" },
    { kind: "structural_receipt" },
    { inputRevision: 0n },
    { fingerprint: "a".repeat(64) },
    { from: new Date("2026-10-01T00:00:00Z") },
    { parentId: headerId },
    { operationKey: "" },
  ] as const)("preserves invalid combinations $status $kind", async (patch) => {
    await expect(header(patch)).rejects.toThrow();
  });
  it("keeps seal R→R+1 and fingerprint checks", async () => {
    await header();
    const seal = {
      id: "55555555-5555-4555-8555-555555555555",
      kind: "structural_receipt",
      status: "sealed",
      parentId: headerId,
      operationKey: "fixture:seal",
      inputRevision: 9007199254740993n,
      sealedAtRevision: 9007199254740994n,
      fingerprint: "a".repeat(64),
    } as const;
    await expect(header({ ...seal, sealedAtRevision: 9007199254740995n })).rejects.toThrow();
    await expect(header({ ...seal, fingerprint: "bad" })).rejects.toThrow();
    await expect(header(seal)).resolves.toHaveLength(1);
    await expect(unit({ fingerprint: "bad" })).rejects.toThrow();
    await expect(unit({ revision: -1n })).rejects.toThrow();
  });
  it("keeps unique keys, JSON limits and reference integrity", async () => {
    await expect(header({ data: { text: "x".repeat(65536) } })).rejects.toThrow();
    await header();
    await unit();
    await expect(header({ id: "55555555-5555-4555-8555-555555555555" })).rejects.toThrow();
    await expect(unit({ id: "55555555-5555-4555-8555-555555555555" })).rejects.toThrow();
    await expect(
      unit({
        id: "55555555-5555-4555-8555-555555555555",
        unitKey: "new",
        ordinal: 1,
        data: { text: "x".repeat(16384) },
      }),
    ).rejects.toThrow();
    await expect(
      unit({
        id: "55555555-5555-4555-8555-555555555555",
        unitKey: "new",
        ordinal: 1,
        kind: "reference",
        referenceUnitId: headerId,
      }),
    ).rejects.toThrow();
  });
  it("does not widen D/E.2.1 trust contracts just because SQL permits a label", () => {
    expect(
      headerSchema.safeParse({
        identity: { playerId: owner, platform: "LA2", queue: "RANKED_SOLO_5x5", season: "2026" },
        operationKey: "fixture",
        kind: "identity_capture",
        source: "server_riot_received",
        parentId: null,
        interval: null,
        capture: {
          state: "declared",
          source: "server_riot_received",
          endpoint: "ACCOUNT-V1",
          captureId: null,
          receivedAt: null,
        },
      }).success,
    ).toBe(false);
    expect(operationalCaptureInputSchema.safeParse({ trust: "received_by_server" }).success).toBe(
      false,
    );
  });
});
