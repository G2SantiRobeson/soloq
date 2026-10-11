import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { achievementReader, consistentAchievementReader } from "@/server/achievements/queries";
import { evaluateStoredAchievements } from "@/server/achievements/evaluate";
import { achievementPresentation } from "@/server/achievements/presentation";
import { readPlayerAchievements } from "@/server/achievements/service";
import { ACHIEVEMENT_DEMO_PLAYER_ID } from "@/server/achievements/demo";
import { seasonStart } from "@/lib/season";
import { currentAchievementScope } from "@/lib/achievements";
import type { AchievementReader } from "@/server/achievements/contracts";
import { profileAchievementPresentation } from "@/server/achievements/profile";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const factory = vi.hoisted(() => ({ calls: 0, fail: false }));
vi.mock("@/db", () => ({
  db: () => {
    factory.calls++;
    if (factory.fail) throw new Error("secret-connection-must-not-escape");
    return database;
  },
}));
const reader = achievementReader(database);
const playerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const request = { playerId, view: "soloq", season: "2026", asOf: "2026-11-01T00:00:00Z" };
beforeAll(async () => {
  for (const f of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`drizzle/${f}`, "utf8"));
});
beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  factory.calls = 0;
  factory.fail = false;
  await database.delete(schema.players);
  await database.delete(schema.matches);
  await database.insert(schema.players).values({
    id: playerId,
    puuid: "fictitious-private-identity",
    gameName: "Fixture",
    tagLine: "TEST",
    platform: "LA2",
    scanStart: seasonStart("LA2"),
    backfillSeason: "2026",
    backfillStatus: "running",
    backfillProcessed: 60,
    backfillDiscovered: 90,
    backfillUnavailable: 2,
  });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await pg.close();
});
async function games(
  n = 50,
  overrides: Partial<typeof schema.matches.$inferInsert> = {},
  owner = playerId,
) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `LA2_${String(i).padStart(6, "0")}`,
    queueId: 420,
    mapId: 11,
    timestamp: new Date(Date.parse("2026-10-01T12:00:00Z") + i * 60000),
    duration: 1800,
    isRemake: false,
    ...overrides,
  }));
  await database.insert(schema.matches).values(rows);
  await database.insert(schema.playerMatches).values(
    rows.map((m, i) => ({
      playerId: owner,
      matchId: m.id,
      champion: "Fixture",
      championId: i < Math.ceil(n * 0.7) ? 157 : 99,
      position: "MIDDLE",
      kills: 1,
      deaths: 1,
      assists: 1,
      cs: 1,
      damage: 1,
      win: true,
    })),
  );
}
async function ranks(extra: Partial<typeof schema.rankedSnapshots.$inferInsert> = {}) {
  await database.insert(schema.rankedSnapshots).values(
    [80, 25, 80].map((leaguePoints, i) => ({
      playerId,
      queue: "RANKED_SOLO_5x5" as const,
      tier: "DIAMOND",
      division: "I",
      leaguePoints,
      wins: 20 + i,
      losses: 10 + i,
      timestamp: new Date(`2026-09-0${i + 1}T12:00:00Z`),
      ...extra,
    })),
  );
}
describe("achievement SQL integration on isolated ephemeral PostgreSQL", () => {
  it("materializes all reads in repeatable read / read only and leaves no writes", async () => {
    await games();
    await ranks();
    const transaction = vi.spyOn(database, "transaction");
    const r = await evaluateStoredAchievements(consistentAchievementReader(database), request);
    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
    expect(r.status).toBe("available");
    await database.transaction(
      async (tx) => {
        const settings = await tx.execute(
          sql`select current_setting('transaction_isolation') isolation, current_setting('transaction_read_only') readonly`,
        );
        expect(settings.rows[0]).toEqual({ isolation: "repeatable read", readonly: "on" });
        await expect(
          tx.update(schema.players).set({ enabled: false }).where(eq(schema.players.id, playerId)),
        ).rejects.toThrow();
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    expect((await reader.player(playerId))?.enabled).toBe(true);
  });
  it.each([1, 2, 3])(
    "rolls back safely when SQL read %i fails and releases the transaction",
    async (failedRead) => {
      const baseTransaction = database.transaction.bind(database);
      vi.spyOn(database, "transaction").mockImplementation((work, config) =>
        baseTransaction(async (tx) => {
          const select = tx.select.bind(tx);
          let count = 0;
          vi.spyOn(tx, "select").mockImplementation((...args: Parameters<typeof select>) => {
            if (++count === failedRead)
              throw Object.assign(new Error("private-connection"), { code: "ECONNRESET" });
            return select(...args);
          });
          return work(tx);
        }, config),
      );
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(
        await evaluateStoredAchievements(consistentAchievementReader(database), request),
      ).toEqual({ status: "unavailable" });
      expect(log).toHaveBeenCalledWith("[achievements] read:infrastructure");
      expect(JSON.stringify(log.mock.calls)).not.toContain("private-connection");
      expect((await reader.player(playerId))?.id).toBe(playerId);
      vi.restoreAllMocks();
      expect(
        (await evaluateStoredAchievements(consistentAchievementReader(database), request)).status,
      ).toBe("available");
    },
  );
  it("sets effective read-only repeatable-read isolation before its first SELECT", async () => {
    const statements: string[] = [];
    const logged = drizzle(pg, { schema, logger: { logQuery: (query) => statements.push(query) } });
    await evaluateStoredAchievements(consistentAchievementReader(logged), request);
    const isolation = statements.findIndex((s) => /^set transaction/i.test(s));
    const firstRead = statements.findIndex((s) => /^select/i.test(s));
    expect(isolation).toBeGreaterThanOrEqual(0);
    expect(statements[isolation]).toMatch(/repeatable read read only/i);
    expect(firstRead).toBeGreaterThan(isolation);
    expect(statements.filter((s) => /^select/i.test(s))).toHaveLength(3);
    expect(statements.every((s) => !/^(insert|update|delete|alter|drop)/i.test(s))).toBe(true);
  });
  it("the production service uses the coherent reader, not separate database selects", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    const transaction = vi.spyOn(database, "transaction");
    const rootSelect = vi.spyOn(database, "select");
    expect((await readPlayerAchievements(request)).status).toBe("available");
    expect(transaction).toHaveBeenCalledOnce();
    expect(rootSelect).not.toHaveBeenCalled();
  });
  it("uses precisely three select reads, evaluates all three, sanitizes identity and preserves evidence", async () => {
    await games();
    await ranks();
    const spy = vi.spyOn(database, "select");
    const result = await evaluateStoredAchievements(reader, request);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("fixture failed");
    expect(result.evaluations.map((e) => e.status)).toEqual(["observed", "observed", "observed"]);
    expect(result.coverage).toMatchObject({
      storedMatches: 50,
      storedSnapshots: 3,
      intervalCoverage: "unproven",
    });
    expect(
      result.evaluations.every((e) => !e.grantAuthorized && e.certification === "not_established"),
    ).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(JSON.stringify(result)).not.toContain("fictitious-private-identity");
    const dto = achievementPresentation(result, { "157": { name: "Yasuo", image: "unused" } });
    expect(JSON.stringify(dto)).toContain("35 / 50");
    expect(JSON.stringify(dto)).toContain("Yasuo");
    expect(JSON.stringify(dto)).not.toContain(playerId);
  });
  it.each([41, 501])("reads %i games with no profile limit", async (n) => {
    await games(n);
    const r = await reader.records(
      (await reader.player(playerId))!,
      currentAchievementScope("soloq", "LA2", request.asOf),
    );
    expect(r.matches).toHaveLength(n);
    expect(r.matches[0].matchId).toBe("LA2_000000");
    expect(r.matches.at(-1)?.matchId).toBe(`LA2_${String(n - 1).padStart(6, "0")}`);
  });
  it("reads more than 30 official snapshots, retaining IDs", async () => {
    for (let i = 0; i < 11; i++)
      await ranks({ timestamp: new Date(Date.parse("2026-09-01T00:00:00Z") + i * 3600000) });
    const r = await reader.records(
      (await reader.player(playerId))!,
      currentAchievementScope("soloq", "LA2", request.asOf),
    );
    expect(r.snapshots).toHaveLength(33);
    expect(new Set(r.snapshots.map((s) => s.id)).size).toBe(33);
  });
  it.each(["soloq", "flex"] as const)(
    "isolates %s player/queue/window/platform in actual SQL",
    async (view) => {
      await games(1);
      await ranks();
      await database.insert(schema.players).values({
        id: otherId,
        puuid: "other",
        gameName: "Other",
        tagLine: "TEST",
        platform: "LA2",
        scanStart: seasonStart("LA2"),
      });
      const additions = [
        { id: "LA2_flex", queueId: 440 },
        { id: "KR_wrong-platform" },
        { id: "LA2Xwrong-prefix" },
        { id: "LA2_before", timestamp: new Date(seasonStart("LA2").getTime() - 1) },
        { id: "LA2_end", timestamp: new Date(request.asOf) },
        { id: "LA2_other-player", owner: otherId },
      ];
      for (const a of additions) await games(1, a, "owner" in a ? a.owner : playerId);
      await ranks({ queue: "RANKED_FLEX_SR" });
      await ranks({ playerId: otherId });
      await ranks({ timestamp: new Date(request.asOf) });
      const r = await reader.records(
        (await reader.player(playerId))!,
        currentAchievementScope(view, "LA2", request.asOf),
      );
      expect(r.matches.map((m) => m.matchId)).toEqual([
        view === "soloq" ? "LA2_000000" : "LA2_flex",
      ]);
      expect(r.snapshots).toHaveLength(3);
      expect(
        r.snapshots.every(
          (s) => s.queue === (view === "soloq" ? "RANKED_SOLO_5x5" : "RANKED_FLEX_SR"),
        ),
      ).toBe(true);
    },
  );
  it.each(["LA2", "KR"] as const)(
    "uses real regional start and half-open bounds for %s",
    async (platform) => {
      await database
        .update(schema.players)
        .set({ platform })
        .where(eq(schema.players.id, playerId));
      const start = seasonStart(platform);
      for (const [id, offset] of [
        ["before", -1],
        ["start", 0],
        ["after", 1],
      ] as const)
        await games(1, { id: `${platform}_${id}`, timestamp: new Date(start.getTime() + offset) });
      await games(1, { id: `${platform}_end`, timestamp: new Date(request.asOf) });
      const result = await evaluateStoredAchievements(reader, request);
      if (result.status !== "available") throw new Error("fixture failed");
      expect(result.scope.season.startAt).toBe(start.toISOString());
      expect(result.coverage.storedMatches).toBe(2);
    },
  );
  it.each([true, false, null])(
    "keeps stored remake classification %s without coalescing",
    async (isRemake) => {
      await games(50, { isRemake });
      const r = await evaluateStoredAchievements(reader, request);
      if (r.status !== "available") throw new Error("fixture failed");
      expect(r.evaluations[2].status).toBe(
        isRemake === false ? "observed" : "insufficient_evidence",
      );
      expect(r.evaluations[2].reasons.includes("unknown_remake")).toBe(isRemake === null);
    },
  );
  it("orders identical timestamps by ID but does not use that order to certify streaks", async () => {
    await games(5, { timestamp: new Date("2026-10-01T00:00:00Z") });
    const r = await evaluateStoredAchievements(reader, request);
    if (r.status !== "available") throw new Error("fixture failed");
    expect(r.evaluations[1].reasons).toContain("ambiguous_timestamp");
    expect(r.evaluations[1].status).toBe("insufficient_evidence");
  });
  it("handles duplicate snapshot timestamps conservatively and official counter resets", async () => {
    await ranks();
    await ranks();
    let r = await evaluateStoredAchievements(reader, request);
    if (r.status !== "available") throw new Error("fixture failed");
    expect(r.evaluations[0].reasons).toContain("ambiguous_timestamp");
    await database.delete(schema.rankedSnapshots);
    await ranks();
    await database
      .update(schema.rankedSnapshots)
      .set({ wins: 0 })
      .where(eq(schema.rankedSnapshots.leaguePoints, 25));
    r = await evaluateStoredAchievements(reader, request);
    if (r.status !== "available") throw new Error("fixture failed");
    expect(r.evaluations[0].reasons).toContain("counter_reset");
    expect(r.evaluations[0].status).not.toBe("observed");
  });
  it("does not bridge tiers", async () => {
    await ranks();
    await database
      .update(schema.rankedSnapshots)
      .set({ tier: "EMERALD" })
      .where(eq(schema.rankedSnapshots.leaguePoints, 25));
    const r = await evaluateStoredAchievements(reader, request);
    if (r.status !== "available") throw new Error("fixture failed");
    expect(r.evaluations[0].reasons).toContain("non_comparable_rank");
  });
  it("empty records are insufficient, not an infrastructure failure", async () => {
    const r = await evaluateStoredAchievements(reader, request);
    if (r.status !== "available") throw new Error("fixture failed");
    expect(r.evaluations.every((e) => e.status === "insufficient_evidence")).toBe(true);
  });
  it("snapshots alone can support recovery without inventing MATCH-V5 history", async () => {
    await ranks();
    const r = await evaluateStoredAchievements(reader, request);
    if (r.status !== "available") throw new Error("fixture failed");
    expect(r.evaluations.map((e) => e.status)).toEqual([
      "observed",
      "insufficient_evidence",
      "insufficient_evidence",
    ]);
    expect(r.coverage.storedMatches).toBe(0);
  });
  it("matches alone never generate ranked snapshots", async () => {
    await games();
    const r = await evaluateStoredAchievements(reader, request);
    if (r.status !== "available") throw new Error("fixture failed");
    expect(r.evaluations[0].status).toBe("insufficient_evidence");
    expect(r.evaluations[0].evidence).toBeNull();
    expect(r.coverage.storedSnapshots).toBe(0);
  });
  it("invalid persisted champion values fail evaluation without fabricating champions", async () => {
    await games();
    await database.update(schema.playerMatches).set({ championId: 0 });
    const r = await evaluateStoredAchievements(reader, request);
    if (r.status !== "available") throw new Error("fixture failed");
    expect(r.evaluations[2].status).toBe("invalid_input");
    expect(r.evaluations[2].reasons).toContain("invalid_champion");
  });
  it("SQL uniqueness prevents duplicate player participation from inflating samples", async () => {
    await games(1);
    const row = (await database.select().from(schema.playerMatches))[0];
    await expect(database.insert(schema.playerMatches).values(row)).rejects.toThrow();
    const r = await evaluateStoredAchievements(reader, request);
    if (r.status !== "available") throw new Error("fixture failed");
    expect(r.coverage.storedMatches).toBe(1);
  });
  it.each(["not_started", "running", "failed", "completed"] as const)(
    "reports %s import without coverage certification",
    async (backfillStatus) => {
      await games();
      await database
        .update(schema.players)
        .set({ backfillStatus })
        .where(eq(schema.players.id, playerId));
      const r = await evaluateStoredAchievements(reader, request);
      if (r.status !== "available") throw new Error("fixture failed");
      expect(r.coverage.historyStatus).toBe(backfillStatus);
      expect(r.coverage.importCounters).toEqual({ processed: 60, discovered: 90, unavailable: 2 });
      expect(r.evaluations[2].reasons).toContain("unavailable_matches");
      expect(r.evaluations[2].certification).toBe("not_established");
    },
  );
  it("does not attribute prior-season import counters to current coverage", async () => {
    await database
      .update(schema.players)
      .set({ backfillSeason: "2025" })
      .where(eq(schema.players.id, playerId));
    const r = await evaluateStoredAchievements(reader, request);
    if (r.status !== "available") throw new Error("fixture failed");
    expect(r.coverage.importCounters).toBeNull();
    expect(r.coverage.availability).toBe("unknown");
  });
  it("missing and paused players never read records", async () => {
    const spy = vi.spyOn(reader, "records");
    expect(await evaluateStoredAchievements(reader, { ...request, playerId: otherId })).toEqual({
      status: "not_found",
    });
    await database
      .update(schema.players)
      .set({ enabled: false })
      .where(eq(schema.players.id, playerId));
    expect(await evaluateStoredAchievements(reader, request)).toEqual({ status: "ineligible" });
    expect(spy).not.toHaveBeenCalled();
  });
  it.each(["deleted", "disabled"])(
    "coherent %s context short-circuits after one read",
    async (state) => {
      if (state === "deleted")
        await database.delete(schema.players).where(eq(schema.players.id, playerId));
      else
        await database
          .update(schema.players)
          .set({ enabled: false })
          .where(eq(schema.players.id, playerId));
      const statements: string[] = [];
      const logged = drizzle(pg, {
        schema,
        logger: { logQuery: (query) => statements.push(query) },
      });
      expect(
        await evaluateStoredAchievements(consistentAchievementReader(logged), request),
      ).toEqual({
        status: state === "deleted" ? "not_found" : "ineligible",
      });
      expect(statements.filter((s) => /^select/i.test(s))).toHaveLength(1);
    },
  );
  it.each(["5v5", "unknown"])("rejects or excludes %s before SQL", async (view) => {
    const spy = vi.spyOn(reader, "player");
    expect(await evaluateStoredAchievements(reader, { ...request, view })).toEqual({
      status: view === "5v5" ? "not_applicable" : "invalid_request",
    });
    expect(spy).not.toHaveBeenCalled();
  });
  it.each([
    { season: "2025" },
    { asOf: "2026-02-30T00:00:00Z" },
    { playerId: "bad" },
    { asOf: "2026-01-01T00:00:00Z" },
  ])("controls unsupported/invalid request %o", async (extra) => {
    expect(await evaluateStoredAchievements(reader, { ...request, ...extra })).toEqual({
      status: "invalid_request",
    });
  });
  it("validates internal identity/platform, ignoring platform spoofing in request", async () => {
    expect((await evaluateStoredAchievements(reader, { ...request, platform: "KR" })).status).toBe(
      "available",
    );
    const invalidReader: AchievementReader = {
      ...reader,
      player: async (id) => ({ ...(await reader.player(id))!, platform: "WRONG" as "LA2" }),
    };
    expect(await evaluateStoredAchievements(invalidReader, request)).toEqual({
      status: "invalid_data",
    });
    expect(
      await evaluateStoredAchievements(
        { ...reader, player: async () => ({ ...(await reader.player(playerId))!, id: otherId }) },
        request,
      ),
    ).toEqual({ status: "invalid_data" });
  });
  it("a read error never becomes not_observed or exposes runtime secrets", async () => {
    const badReader: AchievementReader = {
      ...reader,
      records: async () => {
        throw new Error("private password");
      },
    };
    const r = await evaluateStoredAchievements(badReader, request);
    expect(r).toEqual({ status: "unavailable" });
    expect(achievementPresentation(r).status).toBe("unavailable");
  });
  it("evaluation has no data mutation, even when conditions are observed", async () => {
    await games();
    await ranks();
    const before = await pg.query(
      "select (select count(*) from players) p, (select count(*) from matches) m, (select count(*) from player_matches) pm, (select count(*) from ranked_snapshots) s",
    );
    const writes = [
      vi.spyOn(database, "insert"),
      vi.spyOn(database, "update"),
      vi.spyOn(database, "delete"),
    ];
    await evaluateStoredAchievements(reader, request);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(
      await pg.query(
        "select (select count(*) from players) p, (select count(*) from matches) m, (select count(*) from player_matches) pm, (select count(*) from ranked_snapshots) s",
      ),
    ).toEqual(before);
  });
  it("actual SQL failure returns sanitized unavailability, never an achievement result", async () => {
    const emptyPg = new PGlite();
    try {
      const emptyReader = achievementReader(drizzle(emptyPg, { schema }));
      expect(await evaluateStoredAchievements(emptyReader, request)).toEqual({
        status: "unavailable",
      });
    } finally {
      await emptyPg.close();
    }
  });
  it("5v5 and malformed service requests do not initialize PostgreSQL", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    factory.fail = true;
    expect(await readPlayerAchievements({ ...request, view: "5v5" })).toEqual({
      status: "not_applicable",
    });
    expect(await readPlayerAchievements({ ...request, playerId: "bad" })).toEqual({
      status: "invalid_request",
    });
    expect(factory.calls).toBe(0);
  });
  it("Demo never opens PostgreSQL and remains explicitly fictitious", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    factory.fail = true;
    const r = await readPlayerAchievements({ ...request, playerId: ACHIEVEMENT_DEMO_PLAYER_ID });
    expect(factory.calls).toBe(0);
    expect(r.status).toBe("available");
    if (r.status !== "available") throw new Error("fixture failed");
    expect(r.source).toBe("fictitious");
    expect(achievementPresentation(r)).toMatchObject({ demo: true });
    expect(r.evaluations.every((e) => !e.grantAuthorized)).toBe(true);
  });
  it("integrated Demo maps a known public fictional profile without opening PostgreSQL", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("VERCEL_TARGET_ENV", undefined);
    factory.fail = true;
    // The public one-trick fixture is evaluated from its own matches (Thresh), not a shared sample.
    const dto = await profileAchievementPresentation("demo-5", "soloq", new Date().toISOString(), {
      "412": { name: "Thresh", image: "/champ-icons/412.png" },
    });
    expect(dto).toMatchObject({ status: "available", demo: true });
    if (dto?.status !== "available") throw new Error("fixture");
    const otp = dto.items.find((e) => e.code === "otp-specialist")!;
    expect(otp.status).toBe("observed");
    expect(otp.specialization?.champion).toBe("Thresh");
    expect(factory.calls).toBe(0);
    expect(JSON.stringify(dto)).not.toMatch(/puuid|password|fictitious-private-identity/i);
  });
  it("service contains connection errors without logging credentials", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    factory.fail = true;
    expect(await readPlayerAchievements(request)).toEqual({ status: "unavailable" });
  });
});
