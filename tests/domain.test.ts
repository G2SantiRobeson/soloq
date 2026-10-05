import { describe, expect, it } from "vitest";
import { isStandardMatch, parseView, queueIds, rankedQueue } from "@/lib/queues";
import { rankLabel, rankProgress, rankSortValue, TIERS } from "@/lib/ranking";
import { aggregate, kda, killParticipation, winrate } from "@/lib/stats";
import { platformRouting, regionalRouting, PLATFORMS } from "@/lib/routing";
describe("official queue classification", () => {
  it("separates Solo/Duo, Flex and the configurable classic 5v5 scope", () => {
    expect(queueIds("soloq")).toEqual([420]);
    expect(queueIds("flex")).toEqual([440]);
    expect(queueIds("5v5")).toEqual([400, 420, 430, 440, 490, 700]);
    expect(rankedQueue("flex")).toBe("RANKED_FLEX_SR");
    expect(rankedQueue("5v5")).toBeNull();
  });
  it.each([0, 450, 480, 900, 1700, 830, 720])(
    "excludes customs, ARAM, Swiftplay, rotating modes and bots: %i",
    (id) => expect(isStandardMatch(id, 11, "CLASSIC")).toBe(false),
  );
  it("requires Summoner's Rift and CLASSIC even for an allowed queue", () => {
    expect(isStandardMatch(420, 11, "CLASSIC")).toBe(true);
    expect(isStandardMatch(420, 12, "CLASSIC")).toBe(false);
    expect(isStandardMatch(420, 11, "ARAM")).toBe(false);
    expect(parseView("unknown")).toBe("soloq");
  });
});
describe("official rank ordering", () => {
  const rank = (tier: string, division = "IV", leaguePoints = 0) => ({
    tier,
    division,
    leaguePoints,
    wins: 1,
    losses: 1,
  });
  it("orders every tier by the official hierarchy, including apex tiers", () => {
    const scores = TIERS.map((t) => rankSortValue(rank(t)));
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    expect(rankSortValue(rank("GRANDMASTER", "I", 0))).toBeGreaterThan(
      rankSortValue(rank("MASTER", "I", 4000)),
    );
  });
  it("compares divisions then LP and keeps unranked last", () => {
    expect(rankSortValue(rank("DIAMOND", "II", 0))).toBeGreaterThan(
      rankSortValue(rank("DIAMOND", "III", 99)),
    );
    expect(rankSortValue(rank("GOLD", "I", 70))).toBeGreaterThan(
      rankSortValue(rank("GOLD", "I", 69)),
    );
    expect(rankSortValue(null)).toBeLessThan(rankSortValue(rank("IRON")));
    expect(rankSortValue(rank("UNRANKED"))).toBe(-1);
  });
  it("charts official LP without inventing MMR or dividing apex ranks", () => {
    expect(rankProgress(rank("GOLD", "I", 20))).toBe(1520);
    expect(rankProgress(rank("MASTER", "I", 20))).toBe(2820);
    expect(rankLabel(rank("MASTER", "I", 20))).toBe("Master");
    expect(rankProgress(rank("UNRANKED"))).toBeNull();
  });
});
describe("statistics", () => {
  it("handles empty records, perfect games and zero team kills", () => {
    expect(winrate(0, 0)).toBe(0);
    expect(winrate(2, 1)).toBeCloseTo(66.6667);
    expect(kda(10, 0, 5)).toBe(15);
    expect(killParticipation(0, 0, 0)).toBeNull();
    expect(killParticipation(5, 10, 20)).toBe(0.75);
  });
  it("aggregates raw totals before computing KDA, not average KDA", () => {
    const stats = aggregate([
      { win: true, kills: 10, deaths: 1, assists: 5, cs: 200, duration: 1800, damage: 25000 },
      { win: false, kills: 2, deaths: 9, assists: 3, cs: 180, duration: 1600, damage: 15000 },
    ]);
    expect(stats).toEqual({
      games: 2,
      wins: 1,
      losses: 1,
      kills: 12,
      deaths: 10,
      assists: 8,
      cs: 380,
      duration: 3400,
      damage: 40000,
    });
    expect(kda(stats.kills, stats.deaths, stats.assists)).toBe(2);
    expect(aggregate([]).games).toBe(0);
  });
});
describe("routing", () => {
  it("maps LAS to LA2/AMERICAS and supports all configured platforms", () => {
    expect(platformRouting("LA2")).toBe("la2");
    expect(regionalRouting("LA2")).toBe("americas");
    expect(regionalRouting("EUW1")).toBe("europe");
    expect(regionalRouting("KR")).toBe("asia");
    expect(regionalRouting("OC1")).toBe("sea");
    PLATFORMS.forEach((p) => expect(regionalRouting(p)).toBeTruthy());
  });
});
