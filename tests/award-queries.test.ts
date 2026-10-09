import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { getAwardMatchStats, getAwardLpIntervals } from "@/server/award-queries";
import { computeAwards } from "@/lib/awards";
import { emptyTotals } from "@/lib/stats";
import type { PublicPlayer } from "@/lib/types";

const pg = new PGlite();
const database = drizzle(pg, { schema });
vi.mock("@/db", () => ({ db: () => database }));
const now = Date.parse("2026-10-09T18:00:00Z");
let a: string, b: string;
const match = async (
  playerId: string,
  id: string,
  timestamp: string,
  queueId = 420,
  overrides: {
    isRemake?: boolean;
    win?: boolean;
    championId?: number;
    kills?: number;
    duration?: number;
    cs?: number;
    damage?: number;
  } = {},
) => {
  await database.insert(schema.matches).values({
    id,
    timestamp: new Date(timestamp),
    queueId,
    mapId: 11,
    duration: overrides.duration ?? 1200,
    isRemake: overrides.isRemake ?? false,
  });
  await database.insert(schema.playerMatches).values({
    playerId,
    matchId: id,
    champion: "Fixture",
    championId: overrides.championId ?? 1,
    position: "MIDDLE",
    kills: overrides.kills ?? 2,
    deaths: 3,
    assists: 10,
    cs: overrides.cs ?? 100,
    damage: overrides.damage ?? 10000,
    win: overrides.win ?? true,
  });
};
const snapshot = async (
  playerId: string,
  timestamp: string,
  lp: number,
  options: {
    tier?: string;
    division?: string;
    wins?: number;
    losses?: number;
    queue?: "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";
  } = {},
) => {
  await database.insert(schema.rankedSnapshots).values({
    playerId,
    timestamp: new Date(timestamp),
    queue: options.queue ?? "RANKED_SOLO_5x5",
    tier: options.tier ?? "GOLD",
    division: options.division ?? "II",
    leaguePoints: lp,
    wins: options.wins ?? 10,
    losses: options.losses ?? 10,
  });
};
beforeAll(async () => {
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
  const roster = await database
    .insert(schema.players)
    .values([
      {
        gameName: "Ana",
        tagLine: "TEST",
        puuid: "award-a",
        platform: "LA2",
        scanStart: new Date("2026-01-08T15:00:00Z"),
      },
      {
        gameName: "Beto",
        tagLine: "TEST",
        puuid: "award-b",
        platform: "LA2",
        scanStart: new Date("2026-01-08T15:00:00Z"),
      },
    ])
    .returning();
  [a, b] = roster.map((p) => p.id);
  // Long streak outside the last-20 window, plus two rolling-window periods.
  for (let i = 0; i < 25; i++)
    await match(a, `old-${i}`, `2026-09-01T${String(i % 24).padStart(2, "0")}:00:00Z`);
  for (let i = 0; i < 10; i++)
    await match(a, `mid-${i}`, `2026-09-20T${String(i).padStart(2, "0")}:00:00Z`, 420, {
      win: false,
    });
  for (let i = 0; i < 10; i++) {
    await match(a, `recent-a-${i}`, `2026-10-06T${String(i).padStart(2, "0")}:00:00Z`, 420, {
      win: i < 5,
      championId: (i % 3) + 1,
      kills: i < 3 ? 0 : 2,
      duration: i === 0 ? 600 : 1200,
      cs: i === 0 ? 100 : 300,
      damage: i === 0 ? 10000 : 30000,
    });
    await match(b, `recent-b-${i}`, `2026-10-06T${String(i).padStart(2, "0")}:00:00Z`, 420, {
      win: false,
    });
  }
  await match(a, "remake-in-run", "2026-10-06T02:30:00Z", 420, {
    isRemake: true,
    win: false,
    championId: 999,
    kills: 0,
  });
  await match(a, "zero-duration", "2026-10-06T03:30:00Z", 420, { duration: 0, championId: 998 });
  await match(a, "future", "2026-10-10T00:00:00Z", 420, { championId: 997 });
  await match(a, "previous-season", "2026-01-01T00:00:00Z", 420, { championId: 996 });
  for (let i = 0; i < 10; i++)
    await match(a, `flex-${i}`, `2026-10-07T${String(i).padStart(2, "0")}:00:00Z`, 440, {
      championId: 50,
      kills: 0,
    });
  await match(a, "normal", "2026-10-08T00:00:00Z", 400, { championId: 51 });
  await snapshot(a, "2026-09-01T00:00:00Z", 10);
  await snapshot(a, "2026-09-02T00:00:00Z", 40);
  await snapshot(a, "2026-09-20T00:00:00Z", 50);
  await snapshot(a, "2026-09-21T00:00:00Z", 130);
  await snapshot(a, "2026-10-06T00:00:00Z", 100);
  await snapshot(a, "2026-10-07T00:00:00Z", 120);
  await snapshot(a, "2026-10-08T00:00:00Z", 90);
  await snapshot(a, "2026-10-09T00:00:00Z", 5, { tier: "PLATINUM", division: "IV" });
  await snapshot(a, "2026-10-10T00:00:00Z", 999, { tier: "PLATINUM", division: "IV" });
  // A large movement crossing the 7d boundary must not be attributed to 7d.
  await snapshot(b, "2026-10-01T00:00:00Z", 10);
  await snapshot(b, "2026-10-03T00:00:00Z", 900);
  await snapshot(b, "2026-10-04T00:00:00Z", 880);
  await snapshot(a, "2026-10-07T00:00:00Z", 20, { queue: "RANKED_FLEX_SR" });
  await snapshot(a, "2026-10-08T00:00:00Z", 25, { queue: "RANKED_FLEX_SR" });
});
afterAll(async () => {
  await pg.close();
});

describe("PostgreSQL award aggregates", () => {
  it("aggregates the full selected history and caps form data at twenty results", async () => {
    const data = await getAwardMatchStats("soloq", "season", now);
    const row = data.stats.find((s) => s.playerId === a)!;
    expect(row).toMatchObject({
      games: 45,
      champions: 3,
      zeroKills: 3,
      winStreak: 25,
      lossStreak: 10,
    });
    expect(data.sequences.find((s) => s.playerId === a)?.results).toHaveLength(20);
  });
  it("respects 30d and 7d, ignoring remakes without cutting streaks", async () => {
    const month = (await getAwardMatchStats("soloq", "30d", now)).stats.find(
      (s) => s.playerId === a,
    )!;
    const week = (await getAwardMatchStats("soloq", "7d", now)).stats.find(
      (s) => s.playerId === a,
    )!;
    expect(month.games).toBe(20);
    expect(week).toMatchObject({
      games: 10,
      champions: 3,
      zeroKills: 3,
      winStreak: 5,
      lossStreak: 5,
      cs: 2800,
      duration: 11400,
      damage: 280000,
    });
    expect((week.cs * 60) / week.duration).toBeCloseTo(14.736842);
    expect((week.damage * 60) / week.duration).toBeCloseTo(1473.68421);
  });
  it("isolates SoloQ and Flex while 5v5 combines supported queues", async () => {
    const flex = await getAwardMatchStats("flex", "7d", now);
    expect(flex.stats).toHaveLength(1);
    expect(flex.stats[0]).toMatchObject({ games: 10, champions: 1, zeroKills: 10 });
    const all = (await getAwardMatchStats("5v5", "7d", now)).stats.find((s) => s.playerId === a)!;
    expect(all).toMatchObject({ games: 21, champions: 5, zeroKills: 13 });
  });
  it("uses only comparable intervals wholly inside each period and does not invent promotion LP", async () => {
    const month = await getAwardLpIntervals("soloq", "30d", now);
    const week = await getAwardLpIntervals("soloq", "7d", now);
    expect(month.find((s) => s.playerId === a && s.delta > 0)?.delta).toBe(80);
    expect(week.find((s) => s.playerId === a && s.delta > 0)?.delta).toBe(20);
    expect(week.find((s) => s.playerId === a && s.delta < 0)?.delta).toBe(-30);
    expect(week.find((s) => s.playerId === b && s.delta > 0)).toBeUndefined();
    expect(month.find((s) => s.playerId === b && s.delta > 0)?.delta).toBe(890);
    expect(week.some((s) => s.delta === -85)).toBe(false);
    expect((await getAwardLpIntervals("flex", "season", now))[0].delta).toBe(5);
    expect(await getAwardLpIntervals("5v5", "season", now)).toEqual([]);
  });
  it("chooses different period winners from the real filtered aggregates and intervals", async () => {
    const players = [a, b].map((id): PublicPlayer => ({
      id,
      gameName: id === a ? "Ana" : "Beto",
      tagLine: "TEST",
      platform: "LA2",
      profileIconId: null,
      createdAt: "",
      lastSyncedAt: null,
      observedAt: "",
      recent: [],
      momentum: null,
      rank: null,
      stats: emptyTotals(),
    }));
    const month = computeAwards(
      players,
      "soloq",
      (await getAwardMatchStats("soloq", "30d", now)).stats,
      await getAwardLpIntervals("soloq", "30d", now),
    );
    const week = computeAwards(
      players,
      "soloq",
      (await getAwardMatchStats("soloq", "7d", now)).stats,
      await getAwardLpIntervals("soloq", "7d", now),
    );
    expect(month.honor.find((s) => s.key === "best-climb")?.player?.id).toBe(b);
    expect(week.honor.find((s) => s.key === "best-climb")?.player?.id).toBe(a);
  });
  it("rejects Unranked gaps, resets, duplicate timestamps, invalid ranks and long unknown gaps", async () => {
    const [p] = await database
      .insert(schema.players)
      .values({
        gameName: "Discontinuous",
        tagLine: "TEST",
        puuid: "discontinuous",
        platform: "LA2",
        scanStart: new Date("2026-01-08T15:00:00Z"),
      })
      .returning();
    await snapshot(p.id, "2026-06-01T00:00:00Z", 20);
    await snapshot(p.id, "2026-06-02T00:00:00Z", 900, { tier: "UNRANKED" });
    await snapshot(p.id, "2026-06-03T00:00:00Z", 40);
    await snapshot(p.id, "2026-06-04T00:00:00Z", 900, { wins: 1 });
    await snapshot(p.id, "2026-06-05T00:00:00Z", 30, { division: "V" });
    await snapshot(p.id, "2026-06-06T00:00:00Z", 30);
    await snapshot(p.id, "2026-06-06T00:00:00Z", 900);
    await snapshot(p.id, "2026-06-07T00:00:00Z", 50);
    await snapshot(p.id, "2026-06-20T00:00:00Z", 999);
    await snapshot(p.id, "2026-06-21T00:00:00Z", -1);
    await snapshot(p.id, "2026-06-22T00:00:00Z", 80, { tier: "PLATINUM", division: "IV" });
    await snapshot(p.id, "2026-06-23T00:00:00Z", 50, { division: "I" });
    await snapshot(p.id, "2026-06-24T00:00:00Z", 10, { division: "II" });
    expect(
      (await getAwardLpIntervals("soloq", "season", now)).filter((s) => s.playerId === p.id),
    ).toEqual([]);
  });
});
