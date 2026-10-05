import { describe, expect, it } from "vitest";
import { globalMetrics } from "@/lib/global-metrics";
import { championAsset } from "@/lib/champion-assets";
import { emptyTotals } from "@/lib/stats";
import type { PublicPlayer } from "@/lib/types";
function player(name: string, wins: number, losses: number): PublicPlayer {
  return {
    id: name,
    gameName: name,
    tagLine: "TEST",
    platform: "LA2",
    profileIconId: null,
    createdAt: "",
    lastSyncedAt: null,
    observedAt: "",
    recent: [],
    momentum: null,
    rank: { tier: "GOLD", division: "I", leaguePoints: 50, wins, losses },
    stats: {
      ...emptyTotals(),
      games: wins + losses,
      wins,
      losses,
      kills: wins * 2,
      deaths: losses,
      assists: wins,
    },
  };
}
describe("community metrics", () => {
  it("weights collective winrate by results rather than averaging player percentages", () => {
    const r = globalMetrics([player("a", 1, 0), player("b", 9, 90)], "soloq");
    expect(r.winrate).toBe(10);
    expect(r.averageGames).toBe(50);
    expect(r.bestWinrate?.player.id).toBe("b"); // One game does not qualify for a highlight.
    expect(r.kda).toBeCloseTo(30 / 90);
  });
  it("orders the ranked leader by tier, not raw LP", () => {
    const a = player("a", 20, 20),
      b = player("b", 20, 20);
    a.rank!.leaguePoints = 99;
    b.rank!.tier = "DIAMOND";
    b.rank!.leaguePoints = 0;
    expect(globalMetrics([a, b], "soloq").leader?.player.id).toBe("b");
  });
  it("excludes unranked from ranked aggregates while retaining imported combat stats", () => {
    const a = player("a", 10, 0);
    a.rank = null;
    expect(globalMetrics([a], "soloq")).toMatchObject({
      winrate: null,
      averageGames: null,
      rankedParticipants: 0,
      kda: 30,
    });
    expect(globalMetrics([a], "5v5")).toMatchObject({
      leader: null,
      winrate: 100,
      averageGames: 10,
    });
  });
  it("returns null for empty data", () => {
    expect(globalMetrics([], "soloq")).toMatchObject({
      winrate: null,
      kda: null,
      averageGames: null,
      bestKda: null,
    });
  });
});
describe("champion icon resolution", () => {
  it("prefers the ID-based local icon and retains remote fallback", () => {
    expect(
      championAsset(103, "Ahri", { 103: { name: "Ahri", image: "https://example.test/Ahri.png" } }),
    ).toMatchObject({ src: "/champ-icons/103.png", fallbackSrc: "https://example.test/Ahri.png" });
  });
  it("uses the catalog for a missing icon and safely handles an unknown champion", () => {
    expect(
      championAsset(999999, "NewChampion", {
        999999: { name: "Nuevo", image: "https://example.test/new.png" },
      }).src,
    ).toBe("https://example.test/new.png");
    expect(championAsset(999999, "NewChampion", {})).toEqual({
      name: "NewChampion",
      src: undefined,
      fallbackSrc: undefined,
    });
  });
});
