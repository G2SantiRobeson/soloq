import { describe, expect, it } from "vitest";
import { summarizeLp, LP_WINDOW, type RankSnapshot } from "@/lib/lp-metrics";
function snap(
  i: number,
  lp: number,
  wins: number,
  losses: number,
  tier = "MASTER",
  division = "I",
): RankSnapshot {
  return {
    tier,
    division,
    leaguePoints: lp,
    wins,
    losses,
    timestamp: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
  };
}
describe("observed LP estimates", () => {
  it("does not invent estimates with missing, unranked or lone observations", () => {
    expect(summarizeLp([]).net).toBeNull();
    expect(summarizeLp([snap(0, 0, 0, 0)]).perGame).toBeNull();
    expect(summarizeLp([snap(0, 100, 2, 1), snap(1, 0, 0, 0, "UNRANKED")]).net).toBeNull();
  });
  it("separates single-game win/loss samples from multi-game intervals", () => {
    const r = summarizeLp([
      snap(0, 100, 10, 10),
      snap(1, 125, 11, 10),
      snap(2, 105, 11, 11),
      snap(3, 120, 13, 12),
    ]);
    expect(r).toMatchObject({
      net: 20,
      perWin: 25,
      perLoss: -20,
      perGame: 4,
      games: 5,
      winsSample: 1,
      lossesSample: 1,
    });
  });
  it("does not split mixed intervals into invented per-win rewards", () => {
    expect(summarizeLp([snap(0, 100, 10, 10), snap(1, 130, 12, 11)])).toMatchObject({
      perWin: null,
      perLoss: null,
      perGame: 10,
    });
  });
  it("counts decay in net but excludes it from per-game estimates", () => {
    expect(
      summarizeLp([snap(0, 100, 10, 10), snap(1, 75, 10, 10), snap(2, 100, 11, 10)]),
    ).toMatchObject({ net: 0, adjustments: -25, perGame: 25, perWin: 25 });
  });
  it("returns no per-game average when only decay was observed", () => {
    expect(summarizeLp([snap(0, 100, 10, 10), snap(1, 75, 10, 10)])).toMatchObject({
      net: -25,
      perGame: null,
      perWin: null,
      perLoss: null,
    });
  });
  it("preserves observed zero-LP games", () => {
    expect(summarizeLp([snap(0, 0, 1, 1), snap(1, 0, 1, 2)])).toMatchObject({
      perLoss: 0,
      perGame: 0,
      net: 0,
      lossesSample: 1,
    });
  });
  it("breaks at reset counters and uses only the current segment", () => {
    expect(
      summarizeLp([snap(0, 500, 100, 100), snap(1, 10, 1, 1), snap(2, 34, 2, 1)]),
    ).toMatchObject({ net: 24, perWin: 24, intervals: 1 });
  });
  it("does not bridge an unranked placement interval", () => {
    expect(
      summarizeLp([snap(0, 10, 1, 1), snap(1, 0, 0, 0, "UNRANKED"), snap(2, 34, 2, 1)]),
    ).toMatchObject({ net: null, intervals: 0 });
  });
  it("marks division and tier transitions indeterminate instead of manufacturing LP", () => {
    expect(
      summarizeLp([snap(0, 90, 1, 1, "GOLD", "I"), snap(1, 15, 2, 1, "PLATINUM", "IV")]).perWin,
    ).toBeNull();
    expect(
      summarizeLp([snap(0, 90, 1, 1, "DIAMOND", "I"), snap(1, 15, 2, 1, "MASTER")]).perWin,
    ).toBeNull();
    expect(
      summarizeLp([snap(0, 15, 1, 1, "PLATINUM", "IV"), snap(1, 90, 1, 2, "GOLD", "I")]).perLoss,
    ).toBeNull();
  });
  it("does not add fictional tier offsets between Master and Challenger", () => {
    expect(summarizeLp([snap(0, 900, 1, 1), snap(1, 925, 2, 1, "CHALLENGER")]).perWin).toBeNull();
  });
  it("excludes incompatible result signs from per-outcome samples", () => {
    expect(summarizeLp([snap(0, 100, 1, 1), snap(1, 90, 2, 1)])).toMatchObject({
      perWin: null,
      perGame: -10,
      net: -10,
    });
  });
  it("rejects malformed and ambiguous timestamps", () => {
    expect(summarizeLp([snap(0, 100, 1, 1), snap(0, 120, 2, 1)]).net).toBeNull();
    expect(
      summarizeLp([snap(0, 100, 1, 1), { ...snap(1, 120, 2, 1), timestamp: "invalid" }]).net,
    ).toBeNull();
  });
  it("bounds calculations to the last 30 observations", () => {
    const r = summarizeLp(Array.from({ length: 40 }, (_, i) => snap(i, i * 20, i, 0)));
    expect(r).toMatchObject({ intervals: LP_WINDOW - 1, net: 580, perWin: 20, games: 29 });
  });
});
