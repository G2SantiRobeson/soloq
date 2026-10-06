import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { syncPlayer, syncAllPlayers } from "@/server/sync/service";
import { withSyncLease, SyncBusy } from "@/server/sync/lease";
import { RiotClient, RiotError } from "@/server/riot/client";
import {
  allowLogin,
  authenticated,
  createSession,
  destroySession,
  sessionCookie,
} from "@/server/auth";
import { seasonStart, CURRENT_SEASON } from "@/lib/season";
import { getSeasonOverview } from "@/server/season-queries";
import { SyncDeadline } from "@/server/riot/client";
import { getLeaderboard, getProfile } from "@/server/queries";
import type { RiotMatch } from "@/server/riot/schemas";
import { POST as createPlayer } from "@/app/api/admin/players/route";
import { getWeeklyLp } from "@/server/weekly-lp";
import { getSyncStatus } from "@/server/sync/status";
import { GET as syncStatusRoute } from "@/app/api/ladder/sync-status/route";
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
    expect(partial.scanStart).toEqual(seasonStart(player.platform));
    expect(partial.scanOffset).toBe(2);
    expect(partial.scanPending).toEqual(["LA2_2"]);
    expect(partial.backfillStatus).toBe("failed");
    expect(partial.backfillProcessed).toBe(1);
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

describe("resumable season history", () => {
  it("starts a bounded history batch when the administrator adds an account", async () => {
    vi.stubEnv("APP_URL", "http://localhost");
    await createSession();
    const riot = client();
    const ids = Array.from({ length: 7 }, (_, i) => `LA2_new_${i}`);
    const account = { puuid: "stable-puuid", gameName: "Example", tagLine: "LAS" };
    const mocks = [
      vi.spyOn(RiotClient.prototype, "account").mockResolvedValue(account),
      vi.spyOn(RiotClient.prototype, "identity").mockResolvedValue(account),
      vi.spyOn(RiotClient.prototype, "summoner").mockResolvedValue({ profileIconId: 23 }),
      vi
        .spyOn(RiotClient.prototype, "leagues")
        .mockResolvedValue(await riot.leagues("LA2", account.puuid)),
      vi.spyOn(RiotClient.prototype, "matchIds").mockResolvedValue(ids),
      vi.spyOn(RiotClient.prototype, "match").mockImplementation(async (_p, id) => match(id)),
    ];
    try {
      const response = await createPlayer(
        new Request("http://localhost/api/admin/players", {
          method: "POST",
          headers: { origin: "http://localhost", "content-type": "application/json" },
          body: JSON.stringify({ gameName: "Example", tagLine: "LAS", platform: "LA2" }),
        }),
      );
      expect(response.status).toBe(201);
      expect((await database.select().from(schema.players))[0]).toMatchObject({
        backfillStatus: "running",
        backfillProcessed: 5,
        backfillDiscovered: 7,
        scanPending: ids.slice(5),
      });
      expect(await database.select().from(schema.playerMatches)).toHaveLength(5);
      expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(2);
    } finally {
      mocks.forEach((mock) => mock.mockRestore());
    }
  });
  it.each([0, 1, 99, 100, 101, 205])(
    "paginates %i IDs across bounded batches, then switches to incremental",
    async (count) => {
      const player = await addPlayer();
      const riot = client();
      const ids = Array.from({ length: count }, (_, i) => `LA2_page_${i}`);
      vi.mocked(riot.matchIds).mockImplementation(async (_platform, _puuid, _start, _end, offset) =>
        ids.slice(offset, offset + 100),
      );
      let result = await syncPlayer(player.id, riot, { budget: 17 });
      let batches = 1;
      while (result.status === "partial" && batches < 30) {
        result = await syncPlayer(player.id, riot, { budget: 17 });
        batches++;
      }
      expect(result.status).toBe("complete");
      expect(vi.mocked(riot.matchIds).mock.calls.map((c) => c[4])).toEqual(
        Array.from({ length: Math.floor(count / 100) + 1 }, (_, i) => i * 100),
      );
      expect(new Set(vi.mocked(riot.matchIds).mock.calls.map((c) => c[3])).size).toBe(1);
      expect(vi.mocked(riot.matchIds).mock.calls[0][2]).toBe(
        seasonStart(player.platform).getTime() / 1000,
      );
      const [state] = await database.select().from(schema.players);
      expect(state).toMatchObject({
        backfillStatus: "completed",
        backfillSeason: CURRENT_SEASON.id,
        backfillProcessed: count,
        backfillDiscovered: count,
        scanPending: [],
        scanOffset: 0,
      });
      expect(state.lastBackfillAt).not.toBeNull();
      expect(state.scanStart.getTime()).toBeGreaterThan(Date.now() - 2 * 86400_000);
      expect(await database.select().from(schema.playerMatches)).toHaveLength(count);
      expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(2);
      vi.mocked(riot.matchIds).mockResolvedValue([]);
      await syncPlayer(player.id, riot);
      expect(vi.mocked(riot.matchIds).mock.lastCall?.[2]).toBe(
        Math.floor(state.scanStart.getTime() / 1000),
      );
      expect(await database.select().from(schema.playerMatches)).toHaveLength(count);
    },
  );
  it("saves cursor through expired keys, duplicate IDs and unavailable details", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockResolvedValue(["LA2_a", "LA2_a", "LA2_b", "LA2_gone"]);
    vi.mocked(riot.match).mockImplementation(async (_platform, id) => {
      if (id === "LA2_b") throw new RiotError(403);
      if (id === "LA2_gone") throw new RiotError(404);
      return match(id);
    });
    await expect(syncPlayer(player.id, riot)).rejects.toMatchObject({ status: 403 });
    expect((await database.select().from(schema.players))[0]).toMatchObject({
      backfillStatus: "failed",
      backfillProcessed: 1,
      scanPending: ["LA2_b", "LA2_gone"],
    });
    vi.mocked(riot.match).mockImplementation(async (_platform, id) => {
      if (id === "LA2_gone") throw new RiotError(404);
      return match(id);
    });
    await syncPlayer(player.id, riot);
    expect((await database.select().from(schema.players))[0]).toMatchObject({
      backfillStatus: "completed",
      backfillProcessed: 3,
      backfillDiscovered: 3,
      backfillUnavailable: 1,
    });
    expect(await database.select().from(schema.playerMatches)).toHaveLength(2);
    expect(riot.matchIds).toHaveBeenCalledTimes(1);
  });
  it("safely yields on a deadline and rank-only creation never requests match history", async () => {
    const player = await addPlayer();
    const riot = client();
    await syncPlayer(player.id, riot, { rankOnly: true });
    expect(riot.matchIds).not.toHaveBeenCalled();
    expect(await database.select().from(schema.rankedSnapshots)).toHaveLength(2);
    vi.mocked(riot.matchIds).mockResolvedValue(["LA2_a", "LA2_b"]);
    vi.mocked(riot.match)
      .mockResolvedValueOnce(match("LA2_a"))
      .mockRejectedValueOnce(new SyncDeadline());
    await expect(syncPlayer(player.id, riot)).rejects.toBeInstanceOf(SyncDeadline);
    expect((await database.select().from(schema.players))[0]).toMatchObject({
      backfillStatus: "running",
      backfillProcessed: 1,
      scanPending: ["LA2_b"],
    });
    await syncPlayer(player.id, riot);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(2);
  });
  it("restarts the season cursor after a configuration change without destroying existing data", async () => {
    const player = await addPlayer();
    const riot = client();
    await syncPlayer(player.id, riot);
    await database
      .update(schema.players)
      .set({ backfillSeason: "2025", scanOffset: 987, scanPending: ["OLD"] })
      .where(eq(schema.players.id, player.id));
    vi.mocked(riot.matchIds).mockResolvedValue([]);
    await syncPlayer(player.id, riot);
    expect(vi.mocked(riot.matchIds).mock.lastCall?.[4]).toBe(0);
    expect(vi.mocked(riot.matchIds).mock.lastCall?.[2]).toBe(seasonStart("LA2").getTime() / 1000);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(1);
  });
  it("aggregates the complete season, filters 30d/7d without deleting, and keeps LP history short", async () => {
    const player = await addPlayer();
    const riot = client();
    const now = Date.now();
    const rows = [
      { id: "LA2_old", age: 90 },
      { id: "LA2_month", age: 10 },
      { id: "LA2_week", age: 2 },
      { id: "LA2_remake", age: 1 },
    ];
    vi.mocked(riot.matchIds).mockResolvedValue(rows.map((r) => r.id));
    vi.mocked(riot.match).mockImplementation(async (_p, id) => {
      const m = match(id);
      m.info.gameStartTimestamp = now - rows.find((r) => r.id === id)!.age * 86400_000;
      m.info.participants[0].win = id !== "LA2_month";
      if (id === "LA2_remake") m.info.participants[0].gameEndedInEarlySurrender = true;
      return m;
    });
    await syncPlayer(player.id, riot);
    expect((await getLeaderboard("soloq", "season"))[0].stats).toMatchObject({
      games: 3,
      wins: 2,
      losses: 1,
    });
    expect((await getLeaderboard("soloq", "30d"))[0].stats.games).toBe(2);
    expect((await getLeaderboard("soloq", "7d"))[0].stats.games).toBe(1);
    const profile = await getProfile(player.id, "soloq");
    expect(profile?.performance).toHaveLength(3);
    expect(profile?.performance.at(-1)).toMatchObject({ sample: 3, winrate: 200 / 3 });
    expect(Date.parse(profile!.performance[0].timestamp)).toBeLessThan(now - 30 * 86400_000);
    expect(Date.parse(profile!.trackingSince!)).toBeGreaterThan(now - 60_000);
    const season = await getSeasonOverview("soloq", "season");
    expect(season.uniqueGames).toBe(3);
    expect(season.champions[0]).toMatchObject({ games: 3, wins: 2 });
    expect(season.recentForm).toEqual([{ playerId: player.id, games: 3, wins: 2 }]);
    expect(season.activity.reduce((n, p) => n + p.games, 0)).toBe(3);
    expect((await getSeasonOverview("soloq", "7d")).uniqueGames).toBe(1);
    expect(await database.select().from(schema.playerMatches)).toHaveLength(4);
  });
  it("bounds recent form at twenty non-remakes and excludes disabled players and other queues", async () => {
    const player = await addPlayer();
    const riot = client();
    vi.mocked(riot.matchIds).mockResolvedValue(
      Array.from({ length: 24 }, (_, i) => `LA2_form_${i}`),
    );
    vi.mocked(riot.match).mockImplementation(async (_p, id) => {
      const m = match(id),
        index = Number(id.split("_").at(-1));
      m.info.gameStartTimestamp = Date.now() - (24 - index) * 3600_000;
      m.info.participants[0].win = index < 10;
      if (index === 22) m.info.participants[0].gameEndedInEarlySurrender = true;
      if (index === 23) m.info.queueId = 440;
      return m;
    });
    await syncPlayer(player.id, riot);
    expect((await getSeasonOverview("soloq", "season")).recentForm).toEqual([
      { playerId: player.id, games: 20, wins: 8 },
    ]);
    expect((await getSeasonOverview("flex", "season")).recentForm[0].games).toBe(1);
    await database
      .update(schema.players)
      .set({ enabled: false })
      .where(eq(schema.players.id, player.id));
    const hidden = await getSeasonOverview("soloq", "season");
    expect(hidden.recentForm).toEqual([]);
    expect(hidden.champions).toEqual([]);
    expect(hidden.uniqueGames).toBe(0);
  });
});

describe("weekly ladder baselines and global sync metadata", () => {
  it("the global service records complete runs but not a partially imported history", async () => {
    await addPlayer();
    const spies = [
      vi
        .spyOn(RiotClient.prototype, "identity")
        .mockResolvedValue({ puuid: "stable-puuid", gameName: "Example", tagLine: "LAS" }),
      vi.spyOn(RiotClient.prototype, "summoner").mockResolvedValue({ profileIconId: 23 }),
      vi.spyOn(RiotClient.prototype, "leagues").mockResolvedValue([]),
      vi
        .spyOn(RiotClient.prototype, "match")
        .mockImplementation(async (_platform, id) => match(id)),
    ];
    const ids = vi.spyOn(RiotClient.prototype, "matchIds").mockResolvedValue([]);
    try {
      expect((await syncAllPlayers())[0].status).toBe("complete");
      const last = (await getSyncStatus()).lastSuccessfulSyncAt;
      expect(last).not.toBeNull();
      await database.update(schema.syncLocks).set({ expiresAt: new Date(0) });
      ids.mockResolvedValue(Array.from({ length: 30 }, (_, i) => `LA2_weekly_${i}`));
      expect((await syncAllPlayers())[0].status).toBe("partial");
      expect((await getSyncStatus()).lastSuccessfulSyncAt).toBe(last);
      expect((await getSyncStatus()).status).toBe("partial");
    } finally {
      ids.mockRestore();
      for (const spy of spies) spy.mockRestore();
    }
  });
  it("reads the Monday baseline beyond 30 observations and isolates both queues", async () => {
    const player = await addPlayer();
    const fresh = await addPlayer("new-midweek");
    const now = new Date("2026-10-06T18:00:00Z");
    const base = {
      playerId: player.id,
      queue: "RANKED_SOLO_5x5" as const,
      tier: "PLATINUM",
      division: "I",
      leaguePoints: 80,
      wins: 20,
      losses: 10,
    };
    await database.insert(schema.rankedSnapshots).values([
      { ...base, timestamp: new Date("2026-10-04T23:00:00Z") },
      ...Array.from({ length: 40 }, (_, n) => ({
        ...base,
        timestamp: new Date(Date.parse("2026-10-05T04:00:00Z") + n * 60000),
        leaguePoints: 81,
      })),
      { ...base, tier: "EMERALD", division: "IV", leaguePoints: 5, timestamp: now },
      { ...base, tier: "INVALID", timestamp: new Date(now.getTime() - 1) },
      { ...base, playerId: fresh.id, timestamp: new Date("2026-10-05T05:00:00Z") },
      {
        ...base,
        queue: "RANKED_FLEX_SR",
        tier: "MASTER",
        leaguePoints: 350,
        timestamp: new Date("2026-10-05T03:00:00Z"),
      },
      {
        ...base,
        queue: "RANKED_FLEX_SR",
        tier: "GRANDMASTER",
        leaguePoints: 370,
        timestamp: now,
      },
    ]);
    const solo = await getWeeklyLp([player.id, fresh.id], "soloq", now);
    expect(solo.get(player.id)).toBe(25);
    expect(solo.get(fresh.id)).toBeNull();
    expect((await getWeeklyLp([player.id], "flex", now)).get(player.id)).toBe(20);
    expect(await getWeeklyLp([player.id], "5v5", now)).toEqual(new Map());
  });
  it("returns zero for an unchanged baseline but never bridges seasons", async () => {
    const player = await addPlayer();
    const values = {
      playerId: player.id,
      queue: "RANKED_SOLO_5x5" as const,
      tier: "GOLD",
      division: "II",
      leaguePoints: 50,
      wins: 20,
      losses: 10,
    };
    await database
      .insert(schema.rankedSnapshots)
      .values({ ...values, timestamp: new Date("2026-10-04T23:00:00Z") });
    expect(
      (await getWeeklyLp([player.id], "soloq", new Date("2026-10-06T18:00:00Z"))).get(player.id),
    ).toBe(0);
    await database.delete(schema.rankedSnapshots);
    await database.insert(schema.rankedSnapshots).values([
      { ...values, timestamp: new Date("2025-12-01T00:00:00Z") },
      { ...values, timestamp: new Date("2026-10-06T00:00:00Z") },
    ]);
    expect(
      (await getWeeklyLp([player.id], "soloq", new Date("2026-10-06T18:00:00Z"))).get(player.id),
    ).toBeNull();
  });
  it("records only successful complete global runs; partial, errors and individual jobs preserve success", async () => {
    const release = () => database.update(schema.syncLocks).set({ expiresAt: new Date(0) });
    const policy = { successful: (complete: boolean) => complete };
    expect((await getSyncStatus()).status).toBe("never");
    await withSyncLease(
      async () => {
        expect((await getSyncStatus()).status).toBe("running");
        return true;
      },
      230000,
      policy,
    );
    const success = await getSyncStatus();
    expect(success.lastSuccessfulSyncAt).not.toBeNull();
    expect(success.status).toBe("success");
    expect(
      Date.parse(success.nextExpectedSyncAt!) - Date.parse(success.lastSuccessfulSyncAt!),
    ).toBe(600000);
    await release();
    await withSyncLease(async () => false, 230000, policy);
    expect((await getSyncStatus()).status).toBe("partial");
    expect((await getSyncStatus()).lastSuccessfulSyncAt).toBe(success.lastSuccessfulSyncAt);
    await release();
    await expect(
      withSyncLease(
        async () => {
          throw new Error("failed run");
        },
        230000,
        policy,
      ),
    ).rejects.toThrow("failed run");
    expect((await getSyncStatus()).status).toBe("failed");
    expect((await getSyncStatus()).lastSuccessfulSyncAt).toBe(success.lastSuccessfulSyncAt);
    await release();
    await withSyncLease(async () => true);
    expect((await getSyncStatus()).lastSuccessfulSyncAt).toBe(success.lastSuccessfulSyncAt);
    expect((await getSyncStatus()).status).toBe("failed");
  });
  it("the public read-only endpoint reveals no lease owner or credentials and never calls Riot", async () => {
    const riot = vi.spyOn(RiotClient.prototype, "leagues");
    const response = await syncStatusRoute(new Request("http://localhost/api/ladder/sync-status"));
    expect(response.status).toBe(200);
    expect(Object.keys(await response.json()).sort()).toEqual(
      [
        "lastSuccessfulSyncAt",
        "nextExpectedSyncAt",
        "updatedAt",
        "status",
        "schedulerConfigured",
        "serverNow",
      ].sort(),
    );
    expect(riot).not.toHaveBeenCalled();
    riot.mockRestore();
    expect(await database.select().from(schema.syncLocks)).toEqual([]);
  });
  it("treats an abandoned running lease as failure without fabricating a success", async () => {
    const now = new Date("2026-10-06T18:00:00Z");
    await database.insert(schema.syncLocks).values({
      name: "riot",
      owner: "00000000-0000-4000-8000-000000000001",
      expiresAt: new Date(0),
      lastStartedAt: new Date(now.getTime() - 300000),
      lastOutcome: "running",
    });
    expect((await getSyncStatus(now)).status).toBe("failed");
    expect((await getSyncStatus(now)).lastSuccessfulSyncAt).toBeNull();
  });
});
