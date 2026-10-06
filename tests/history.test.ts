import { describe, expect, it } from "vitest";
import { CURRENT_SEASON, parsePeriod, periodStart, seasonStart } from "@/lib/season";
import { chartRankCoordinate, chartRankLabel } from "@/lib/ranking";
import {
  continuousActivity,
  lpObservations,
  rollingWinrate,
  type MatchObservation,
} from "@/lib/history";
import type { RankSnapshot } from "@/lib/lp-metrics";
const snap = (
  lp: number,
  wins = 10,
  losses = 5,
  tier = "GOLD",
  division = "I",
  hour = 10,
): RankSnapshot => ({
  tier,
  division,
  leaguePoints: lp,
  wins,
  losses,
  timestamp: `2026-10-05T${hour}:00:00Z`,
});
const match = (id: string, hour = 10, win = true): MatchObservation => ({
  matchId: id,
  timestamp: `2026-10-05T${hour}:05:00Z`,
  duration: 1200,
  win,
  isRemake: false,
});
describe("season boundaries and presentation filters", () => {
  it("uses local server noon with daylight saving rather than host time", () => {
    expect(seasonStart("LA2").toISOString()).toBe("2026-01-08T15:00:00.000Z");
    expect(seasonStart("OC1").toISOString()).toBe("2026-01-08T01:00:00.000Z");
    expect(seasonStart("EUW1").toISOString()).toBe("2026-01-08T12:00:00.000Z");
  });
  it("clamps 7d/30d to season and defaults invalid filters to season", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(periodStart("LA2", "season", now)).toEqual(seasonStart("LA2"));
    expect(periodStart("LA2", "7d", now).toISOString()).toBe("2026-09-28T12:00:00.000Z");
    expect(periodStart("LA2", "30d", now).toISOString()).toBe("2026-09-05T12:00:00.000Z");
    expect(periodStart("LA2", "30d", Date.parse("2026-01-09T00:00:00Z"))).toEqual(
      seasonStart("LA2"),
    );
    expect(parsePeriod("bad")).toBe("season");
    expect(CURRENT_SEASON.id).toBe("2026");
  });
});
describe("honest observed LP intervals", () => {
  it("links one matching result with high confidence", () => {
    expect(
      lpObservations([snap(50), snap(73, 11, 5, "GOLD", "I", 11)], [match("one")])[0],
    ).toMatchObject({ confidence: "high", delta: 23, matchId: "one" });
  });
  it("keeps multiple games aggregated without splitting their delta", () => {
    expect(
      lpObservations(
        [snap(10), snap(55, 12, 6, "GOLD", "I", 13)],
        [match("a"), match("b", 11), match("c", 12, false)],
      )[0],
    ).toMatchObject({ confidence: "aggregated", delta: 45, games: 3, matchId: null });
  });
  it("does not attribute missing, mismatched, remake or zero-game observations", () => {
    const history = [snap(50), snap(73, 11, 5, "GOLD", "I", 11)];
    for (const games of [
      [],
      [match("loss", 10, false)],
      [{ ...match("remake"), isRemake: true }],
      [{ ...match("legacy"), isRemake: null }],
      [match("a"), match("b")],
    ])
      expect(lpObservations(history, games)[0].confidence).toBe("unknown");
    expect(lpObservations([snap(50)], [])).toEqual([]);
    expect(lpObservations([snap(50), snap(25, 10, 5, "GOLD", "I", 11)], [])[0].delta).toBeNull();
  });
  it("labels promotions, demotions and apex changes without false LP", () => {
    for (const [before, after, label] of [
      [snap(80), snap(5, 11, 5, "PLATINUM", "IV", 11), "Ascenso a Platinum IV"],
      [snap(5, 10, 5, "PLATINUM", "IV"), snap(80, 10, 6, "GOLD", "I", 11), "Descenso a Gold I"],
      [
        snap(950, 10, 5, "MASTER"),
        snap(975, 11, 5, "GRANDMASTER", "I", 11),
        "Ascenso a Grandmaster",
      ],
    ] as const)
      expect(lpObservations([before, after], [match("x")])[0]).toMatchObject({
        confidence: "unknown",
        delta: null,
        label,
      });
  });
  it("requires the game to END between snapshots and rejects counter resets", () => {
    expect(
      lpObservations(
        [snap(50), snap(73, 11, 5, "GOLD", "I", 11)],
        [{ ...match("late"), duration: 4000 }],
      )[0].confidence,
    ).toBe("unknown");
    expect(
      lpObservations([snap(50), snap(73, 1, 0, "GOLD", "I", 11)], [match("a")])[0].confidence,
    ).toBe("unknown");
  });
});
describe("rank coordinates and real performance", () => {
  it("keeps weekly gaps visible without inventing activity for an empty history", () => {
    const points = ["2026-09-07", "2026-09-21"].map((d) => ({
      timestamp: `${d}T00:00:00.000Z`,
      games: 4,
      wins: 3,
      losses: 1,
    }));
    expect(continuousActivity(points)).toHaveLength(3);
    expect(continuousActivity(points)[1]).toEqual({
      timestamp: "2026-09-14T00:00:00.000Z",
      games: 0,
      wins: 0,
      losses: 0,
    });
    expect(continuousActivity([])).toEqual([]);
  });
  it("orders divisions, tier boundaries, and each apex tier without showing coordinates", () => {
    const ranks = [
      snap(99, 0, 0, "GOLD", "I"),
      snap(0, 0, 0, "PLATINUM", "IV"),
      snap(99, 0, 0, "DIAMOND", "I"),
      snap(9999, 0, 0, "MASTER"),
      snap(0, 0, 0, "GRANDMASTER"),
      snap(0, 0, 0, "CHALLENGER"),
    ];
    const values = ranks.map((r) => chartRankCoordinate(r)!);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(chartRankLabel(values[0])).toBe("Gold I");
    expect(chartRankLabel(values.at(-1)!)).toBe("Challenger");
    expect(chartRankCoordinate(snap(0, 0, 0, "UNRANKED"))).toBeNull();
  });
  it("uses an adaptive rolling twenty-game sample and excludes remakes", () => {
    const games = Array.from({ length: 25 }, (_, i) => ({
      ...match(`m${i}`),
      timestamp: new Date(Date.UTC(2026, 0, 9 + i)).toISOString(),
      win: i < 20,
    }));
    const points = rollingWinrate([...games, { ...games[0], matchId: "remake", isRemake: true }]);
    expect(points[0]).toMatchObject({ sample: 1, winrate: 100 });
    expect(points.at(-1)).toMatchObject({ sample: 20, winrate: 75 });
    expect(points).toHaveLength(25);
  });
});
