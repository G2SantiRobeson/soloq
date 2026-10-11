/** Opt-in independent sessions on an explicitly disposable LOCAL PostgreSQL.
 * Never reads .env files or DATABASE_URL. No remote hosts or credentials accepted.
 */
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { achievementReader, consistentAchievementReader } from "@/server/achievements/queries";
import { evaluateStoredAchievements } from "@/server/achievements/evaluate";
import { demoAchievementReader, ACHIEVEMENT_DEMO_PLAYER_ID } from "@/server/achievements/demo";
import { currentAchievementScope } from "@/lib/achievements";
import type { AchievementReader } from "@/server/achievements/contracts";

const localUrl = process.env.ACHIEVEMENT_LOCAL_PG_URL;
const playerId = ACHIEVEMENT_DEMO_PLAYER_ID;
const request = { playerId, view: "soloq", season: "2026", asOf: "2026-11-01T00:00:00Z" };
const scope = currentAchievementScope("soloq", "LA2", request.asOf);
const databaseName = `achievements_test_${randomUUID().replaceAll("-", "")}`;
function localClient(testDatabase = false) {
  const url = new URL(localUrl!);
  if (
    url.protocol !== "postgres:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username !== "postgres" ||
    url.password ||
    url.pathname !== "/postgres" ||
    url.search
  )
    throw new Error(
      "Only explicit disposable loopback PostgreSQL without credentials is supported",
    );
  if (testDatabase) url.pathname = `/${databaseName}`;
  return postgres(url.toString(), { max: 1, prepare: false, connect_timeout: 3 });
}
describe.skipIf(!localUrl)("independent PostgreSQL sessions (opt-in local disposable DB)", () => {
  let readConnection: ReturnType<typeof localClient>,
    writeConnection: ReturnType<typeof localClient>;
  let control: ReturnType<typeof localClient>,
    created = false;
  let database: ReturnType<typeof drizzle<typeof schema>>,
    writer: ReturnType<typeof drizzle<typeof schema>>;
  let reader: AchievementReader;
  beforeAll(async () => {
    control = localClient();
    // New database per suite, never truncate or reuse existing application tables.
    if (!/^achievements_test_[a-f0-9]{32}$/.test(databaseName))
      throw new Error("Invalid test database name");
    await control.unsafe(`create database ${databaseName}`);
    created = true;
    readConnection = localClient(true);
    writeConnection = localClient(true);
    database = drizzle(readConnection, { schema });
    writer = drizzle(writeConnection, { schema });
    reader = consistentAchievementReader(database);
    for (const file of readdirSync("drizzle")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await writeConnection.unsafe(readFileSync(`drizzle/${file}`, "utf8"));
  });
  beforeEach(async () => {
    await writer.delete(schema.players);
    await writer.delete(schema.matches);
    const context = (await demoAchievementReader.player(playerId))!;
    const records = await demoAchievementReader.records(context, scope);
    await writer
      .insert(schema.players)
      .values({
        ...context,
        gameName: "Synthetic",
        tagLine: "QA",
        puuid: "synthetic-private-identity",
        scanStart: new Date(scope.season.startAt),
      });
    await writer.insert(schema.rankedSnapshots).values(
      records.snapshots.map((s) => ({
        playerId,
        queue: s.queue,
        tier: s.tier,
        division: s.division,
        leaguePoints: s.leaguePoints,
        wins: s.wins,
        losses: s.losses,
        timestamp: new Date(s.timestamp),
      })),
    );
    await writer.insert(schema.matches).values(
      records.matches.map((m, i) => ({
        id: `LA2_${i}`,
        queueId: m.queueId,
        timestamp: new Date(m.timestamp),
        mapId: 11,
        duration: 1800,
        isRemake: m.isRemake,
      })),
    );
    await writer.insert(schema.playerMatches).values(
      records.matches.map((m, i) => ({
        playerId,
        matchId: `LA2_${i}`,
        champion: "Synthetic",
        championId: m.championId!,
        position: "MIDDLE",
        kills: 1,
        deaths: 1,
        assists: 1,
        cs: 1,
        damage: 1,
        win: m.win!,
      })),
    );
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await readConnection?.end({ timeout: 3 });
    await writeConnection?.end({ timeout: 3 });
    try {
      if (created && /^achievements_test_[a-f0-9]{32}$/.test(databaseName))
        await control.unsafe(`drop database ${databaseName}`);
    } finally {
      await control?.end({ timeout: 3 });
    }
  });
  it.each(["matches", "snapshots", "coverage", "all"])(
    "holds one MVCC snapshot when another connection commits %s between SELECTs",
    async (change) => {
      const before = await evaluateStoredAchievements(reader, request);
      const interleaved: AchievementReader = {
        ...reader,
        snapshot: (read) =>
          reader.snapshot!(async (r) =>
            read({
              ...r,
              player: async (id) => {
                const captured = await r.player(id); // First SELECT pins the read transaction's MVCC view.
                await writer.transaction(async (tx) => {
                  if (change === "matches" || change === "all") {
                    await tx
                      .insert(schema.matches)
                      .values({
                        id: "LA2_added",
                        queueId: 420,
                        mapId: 11,
                        timestamp: new Date("2026-10-10T00:00:00Z"),
                        duration: 1800,
                        isRemake: false,
                      });
                    await tx
                      .insert(schema.playerMatches)
                      .values({
                        playerId,
                        matchId: "LA2_added",
                        champion: "Synthetic",
                        championId: 99,
                        position: "MIDDLE",
                        kills: 1,
                        deaths: 1,
                        assists: 1,
                        cs: 1,
                        damage: 1,
                        win: false,
                      });
                  }
                  if (change === "snapshots" || change === "all")
                    await tx.insert(schema.rankedSnapshots).values({
                      playerId,
                      queue: "RANKED_SOLO_5x5",
                      tier: "DIAMOND",
                      division: "I",
                      leaguePoints: 50,
                      wins: 30,
                      losses: 20,
                      timestamp: new Date("2026-09-04T12:00:00Z"),
                    });
                  if (change === "coverage" || change === "all")
                    await tx
                      .update(schema.players)
                      .set({
                        backfillStatus: "completed",
                        backfillProcessed: 70,
                        backfillDiscovered: 70,
                        backfillUnavailable: 0,
                        rankCheckedAt: new Date("2026-10-10T12:00:00Z"),
                      })
                      .where(eq(schema.players.id, playerId));
                });
                return captured;
              },
            }),
          ),
      };
      expect(await evaluateStoredAchievements(interleaved, request)).toEqual(before);
      const next = await evaluateStoredAchievements(reader, request);
      if (next.status !== "available") throw new Error("fixture");
      expect(next.coverage.storedMatches).toBe(change === "matches" || change === "all" ? 51 : 50);
      expect(next.coverage.storedSnapshots).toBe(
        change === "snapshots" || change === "all" ? 4 : 3,
      );
      expect(next.coverage.historyStatus).toBe(
        change === "coverage" || change === "all" ? "completed" : "running",
      );
      expect(
        next.evaluations.every((e) => !e.grantAuthorized && e.certification === "not_established"),
      ).toBe(true);
    },
  );
  it("rolls back a real SQL failure, releases its single connection and supports a new render", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const broken: AchievementReader = {
        ...reader,
        snapshot: (read) =>
          database.transaction(
            async (tx) =>
              read({
                ...achievementReader(tx),
                records: async () => {
                  await tx.execute(sql`select * from nonexistent_achievement_relation`);
                  return { matches: [], snapshots: [] };
                },
              }),
            { isolationLevel: "repeatable read", accessMode: "read only" },
          ),
      };
      expect(await evaluateStoredAchievements(broken, request)).toEqual({ status: "unavailable" });
      expect(log).toHaveBeenCalledWith("[achievements] read:unexpected");
      expect((await evaluateStoredAchievements(reader, request)).status).toBe("available");
      expect(await readConnection`select 1 as ready`).toMatchObject([{ ready: 1 }]);
      expect(JSON.stringify(log.mock.calls)).not.toContain("nonexistent_achievement_relation");
    } finally {
      log.mockRestore();
    }
  });
  it("effective PostgreSQL settings reject writes without changing the player", async () => {
    await expect(
      database.transaction(
        async (tx) => {
          const settings = await tx.execute(
            sql`select current_setting('transaction_isolation') isolation, current_setting('transaction_read_only') readonly`,
          );
          expect(settings[0]).toMatchObject({ isolation: "repeatable read", readonly: "on" });
          await tx
            .update(schema.players)
            .set({ enabled: false })
            .where(eq(schema.players.id, playerId));
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      ),
    ).rejects.toMatchObject({ cause: { code: "25006" } });
    expect((await reader.player(playerId))?.enabled).toBe(true);
  });
});
