import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { syncPlayer } from "@/server/sync/service";
import { withSyncLease, SyncBusy } from "@/server/sync/lease";
import { RiotClient, RiotError } from "@/server/riot/client";
import {
  allowLogin,
  authenticated,
  createSession,
  destroySession,
  sessionCookie,
} from "@/server/auth";
import { getLeaderboard, getProfile } from "@/server/queries";
import type { RiotMatch } from "@/server/riot/schemas";
const pg = new PGlite();
const database = drizzle(pg, { schema });
const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("@/db", () => ({ db: () => database }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) => (cookieJar.has(key) ? { value: cookieJar.get(key) } : undefined),
    set: (key: string, value: string) => cookieJar.set(key, value),
  }),
}));
beforeAll(async () => {
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
});
beforeEach(async () => {
  await pg.exec(
    "TRUNCATE players, matches, ranked_snapshots, player_matches, sync_locks, admin_sessions, login_attempts CASCADE",
  );
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("ADMIN_SESSION_SECRET", "test-secret".repeat(4));
  cookieJar.clear();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await pg.close();
});
async function addPlayer(puuid = "stable-puuid") {
  return (
    await database
      .insert(schema.players)
      .values({
        gameName: "Example",
        tagLine: "LAS",
        puuid,
        platform: "LA2",
        scanStart: new Date("2026-09-01T00:00:00Z"),
      })
      .returning()
  )[0];
}
function match(id: string): RiotMatch {
  return {
    metadata: { matchId: id },
    info: {
      queueId: 420,
      mapId: 11,
      gameMode: "CLASSIC",
      gameStartTimestamp: Date.parse("2026-09-10T00:00:00Z"),
      gameDuration: 1800,
      participants: [
        {
          puuid: "stable-puuid",
          championName: "Ahri",
          championId: 103,
          teamPosition: "MIDDLE",
          teamId: 100,
          kills: 7,
          deaths: 2,
          assists: 8,
          totalMinionsKilled: 180,
          neutralMinionsKilled: 20,
          totalDamageDealtToChampions: 25000,
          win: true,
        },
        {
          puuid: "teammate",
          championName: "Jinx",
          championId: 222,
          teamPosition: "BOTTOM",
          teamId: 100,
          kills: 10,
          deaths: 4,
          assists: 6,
          totalMinionsKilled: 220,
          neutralMinionsKilled: 5,
          totalDamageDealtToChampions: 29000,
          win: true,
        },
      ],
    },
  };
}
function client() {
  const client = new RiotClient();
  vi.spyOn(client, "identity").mockResolvedValue({
    puuid: "stable-puuid",
    gameName: "Renamed",
    tagLine: "LAS",
  });
  vi.spyOn(client, "summoner").mockResolvedValue({ profileIconId: 23 });
  vi.spyOn(client, "leagues").mockResolvedValue([
    {
      queueType: "RANKED_SOLO_5x5",
      tier: "DIAMOND",
      rank: "II",
      leaguePoints: 73,
      wins: 10,
      losses: 5,
    },
  ]);
  vi.spyOn(client, "matchIds").mockResolvedValue(["LA2_1"]);
  vi.spyOn(client, "match").mockImplementation(async (_platform, id) => match(id));
  return client;
}
describe("PostgreSQL migrations and data integrity", () => {
  it("keeps remakes visible in history while excluding them from public combat aggregates", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockResolvedValue(["LA2_normal", "LA2_remake", "LA2_short"]);
    vi.mocked(riot.match).mockImplementation(async (_platform, id) => {
      const result = match(id);
      if (id !== "LA2_normal") result.info.gameDuration = 86;
      if (id === "LA2_remake") {
        result.info.participants[0].win = false;
        result.info.participants[1].gameEndedInEarlySurrender = true;
      }
      return result;
    });
    await syncPlayer(player.id, riot);
    const [playerView] = await getLeaderboard("soloq");
    expect(playerView.stats).toMatchObject({
      games: 2,
      wins: 2,
      losses: 0,
      kills: 14,
      duration: 1886,
    });
    expect(playerView.rank).toMatchObject({ wins: 10, losses: 5 });
    expect(playerView.recent.find((m) => m.matchId === "LA2_remake")?.isRemake).toBe(true);
    expect(playerView.recent.find((m) => m.matchId === "LA2_short")?.isRemake).toBe(false);
    const profile = await getProfile(player.id, "soloq");
    expect(profile?.recent).toHaveLength(3);
    expect(profile?.recent.find((m) => m.matchId === "LA2_remake")?.isRemake).toBe(true);
    expect(profile?.champions[0].games).toBe(2);
    expect((await getLeaderboard("5v5"))[0].stats.losses).toBe(0);
  });
  it("bounds momentum to 30 queue-specific observations and preserves the newest rank", async () => {
    const player = await addPlayer();
    await database.insert(schema.rankedSnapshots).values([
      ...Array.from({ length: 35 }, (_, i) => ({
        playerId: player.id,
        queue: "RANKED_SOLO_5x5" as const,
        tier: "MASTER",
        division: "I",
        leaguePoints: 20 * i,
        wins: i,
        losses: 0,
        timestamp: new Date(Date.UTC(2026, 9, 1, i)),
      })),
      {
        playerId: player.id,
        queue: "RANKED_FLEX_SR" as const,
        tier: "GOLD",
        division: "II",
        leaguePoints: 42,
        wins: 9,
        losses: 7,
        timestamp: new Date(Date.UTC(2026, 9, 3)),
      },
    ]);
    const [soloq] = await getLeaderboard("soloq");
    expect(soloq.rank?.leaguePoints).toBe(680);
    expect(soloq.momentum).toMatchObject({ net: 580, intervals: 29, perWin: 20, games: 29 });
    const [flex] = await getLeaderboard("flex");
    expect(flex.rank?.leaguePoints).toBe(42);
    expect(flex.momentum?.net).toBeNull();
    expect((await getLeaderboard("5v5"))[0].momentum).toBeNull();
  });
  it("enables RLS and denies ordinary database roles access without policies", async () => {
    const result = await pg.query<{ tablename: string; rowsecurity: boolean }>(
      "select tablename, rowsecurity from pg_tables where schemaname='public'",
    );
    expect(result.rows).toHaveLength(7);
    expect(result.rows.every((row) => row.rowsecurity)).toBe(true);
    await addPlayer();
    await pg.exec(
      "CREATE ROLE test_reader; GRANT USAGE ON SCHEMA public TO test_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO test_reader; SET ROLE test_reader",
    );
    try {
      expect((await pg.query("select * from players")).rows).toEqual([]);
    } finally {
      await pg.exec("RESET ROLE; DROP OWNED BY test_reader; DROP ROLE test_reader");
    }
  });
  it("reads correct public aggregates without exposing PUUID and hides paused players", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockResolvedValue(Array.from({ length: 8 }, (_, i) => `LA2_${i}`));
    await syncPlayer(player.id, riot);
    const [publicPlayer] = await getLeaderboard("soloq");
    expect(publicPlayer.stats.games).toBe(8);
    expect(publicPlayer.stats.cs).toBe(1600);
    expect(publicPlayer.rank?.leaguePoints).toBe(73);
    expect(publicPlayer.recent).toHaveLength(5);
    expect(publicPlayer.recent[0]).toMatchObject({
      champion: "Ahri",
      championId: 103,
      matchId: "LA2_7",
      win: true,
    });
    expect(publicPlayer.momentum?.net).toBeNull();
    expect(publicPlayer).not.toHaveProperty("puuid");
    const profile = await getProfile(player.id, "soloq");
    expect(profile?.champions[0].games).toBe(8);
    expect(profile?.recent).toHaveLength(8);
    expect(profile?.history).toHaveLength(1);
    expect((await getLeaderboard("flex"))[0].stats.games).toBe(0);
    expect((await getLeaderboard("5v5"))[0].rank).toBeNull();
    expect((await getLeaderboard("5v5"))[0].momentum).toBeNull();
    await database
      .update(schema.players)
      .set({ enabled: false })
      .where(eq(schema.players.id, player.id));
    expect(await getLeaderboard("soloq")).toEqual([]);
    expect(await getProfile(player.id, "soloq")).toBeNull();
  });
  it("stores only a session hash and supports logout, expiry and secret rotation", async () => {
    await createSession();
    const token = cookieJar.get(sessionCookie);
    expect(token).toHaveLength(64);
    const [session] = await database.select().from(schema.adminSessions);
    expect(session.tokenHash).not.toBe(token);
    expect(await authenticated()).toBe(true);
    vi.stubEnv("ADMIN_SESSION_SECRET", "rotated-secret".repeat(4));
    expect(await authenticated()).toBe(false);
    vi.stubEnv("ADMIN_SESSION_SECRET", "test-secret".repeat(4));
    await database.update(schema.adminSessions).set({ expiresAt: new Date(0) });
    expect(await authenticated()).toBe(false);
    await createSession();
    expect(await authenticated()).toBe(true);
    await destroySession();
    expect(await authenticated()).toBe(false);
    expect(await database.select().from(schema.adminSessions)).toHaveLength(0);
  });
  it("rejects duplicate PUUIDs", async () => {
    await addPlayer();
    await expect(addPlayer()).rejects.toThrow();
  });
  it("sync is idempotent and persists identity, rank changes, matches and KP", async () => {
    const player = await addPlayer();
    const riot = client();
    await syncPlayer(player.id, riot);
    await syncPlayer(player.id, riot);
    expect(await database.select().from(schema.matches)).toHaveLength(1);
    const participants = await database.select().from(schema.playerMatches);
    expect(participants).toHaveLength(1);
    expect(participants[0].cs).toBe(200);
    expect(participants[0].killParticipation).toBeCloseTo(15 / 17);
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(2);
    expect(riot.match).toHaveBeenCalledTimes(1);
    vi.mocked(riot.leagues).mockResolvedValueOnce([
      {
        queueType: "RANKED_SOLO_5x5",
        tier: "DIAMOND",
        rank: "II",
        leaguePoints: 90,
        wins: 11,
        losses: 5,
      },
    ]);
    await syncPlayer(player.id, riot);
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(3);
    const [updated] = await database.select().from(schema.players);
    expect(updated.gameName).toBe("Renamed");
    expect(updated.lastSyncedAt).not.toBeNull();
    expect(updated.scanEnd).toBeNull();
  });
  it("resumes failed pages without advancing the cursor or losing completed matches", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockResolvedValue(["LA2_1", "LA2_2"]);
    vi.mocked(riot.match)
      .mockResolvedValueOnce(match("LA2_1"))
      .mockRejectedValueOnce(new RiotError(503));
    await expect(syncPlayer(player.id, riot)).rejects.toThrow();
    const [partial] = await database.select().from(schema.players);
    expect(partial.scanStart).toEqual(player.scanStart);
    expect(partial.scanOffset).toBe(0);
    expect(partial.scanEnd).not.toBeNull();
    expect(partial.lastSyncedAt).toBeNull();
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
    await syncPlayer(player.id, riot);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(2);
    expect(vi.mocked(riot.match).mock.calls.filter((c) => c[1] === "LA2_1")).toHaveLength(1);
  });
  it("does not import excluded modes or sync disabled players", async () => {
    const player = await addPlayer();
    const riot = client();
    const aram = match("LA2_1");
    aram.info.queueId = 450;
    vi.mocked(riot.match).mockResolvedValue(aram);
    await syncPlayer(player.id, riot);
    expect(await database.select().from(schema.matches)).toHaveLength(0);
    await database
      .update(schema.players)
      .set({ enabled: false })
      .where(eq(schema.players.id, player.id));
    vi.mocked(riot.identity).mockClear();
    expect((await syncPlayer(player.id, riot)).status).toBe("skipped");
    expect(riot.identity).not.toHaveBeenCalled();
  });
  it("cascade deletes personal rows while retaining shared matches", async () => {
    const player = await addPlayer();
    await syncPlayer(player.id, client());
    const other = await addPlayer("other");
    const [stats] = await database.select().from(schema.playerMatches);
    await database.insert(schema.playerMatches).values({ ...stats, playerId: other.id });
    await database.delete(schema.players).where(eq(schema.players.id, player.id));
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(0);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
    await database.execute(
      sql`delete from matches m where not exists (select 1 from player_matches pm where pm.match_id=m.id)`,
    );
    expect(await database.select().from(schema.matches)).toHaveLength(1);
    await database.delete(schema.players).where(eq(schema.players.id, other.id));
    await database.execute(
      sql`delete from matches m where not exists (select 1 from player_matches pm where pm.match_id=m.id)`,
    );
    expect(await database.select().from(schema.matches)).toHaveLength(0);
  });
  it("uses an atomic shared lease and preserves Retry-After across invocations", async () => {
    await expect(
      withSyncLease(async () => {
        await expect(withSyncLease(async () => true)).rejects.toBeInstanceOf(SyncBusy);
        throw new RiotError(429, 300000);
      }),
    ).rejects.toBeInstanceOf(RiotError);
    const [lock] = await database.select().from(schema.syncLocks);
    expect(lock.expiresAt.getTime()).toBeGreaterThan(Date.now() + 295000);
    await expect(withSyncLease(async () => true)).rejects.toBeInstanceOf(SyncBusy);
  });
  it("shares the login rate limit atomically across concurrent attempts", async () => {
    const attempts = await Promise.all(Array.from({ length: 12 }, () => allowLogin()));
    expect(attempts.filter(Boolean)).toHaveLength(10);
    await database
      .update(schema.loginAttempts)
      .set({ resetsAt: new Date(0) })
      .where(and(eq(schema.loginAttempts.key, "admin")));
    expect(await allowLogin()).toBe(true);
  });
});
