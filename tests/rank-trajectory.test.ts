import { describe, expect, it } from "vitest";
import {
  comparableRankInterval,
  MAX_RANK_INTERVAL_MS,
  rankAtTime,
  rankTrajectory,
} from "@/lib/rank-trajectory";
import { chartRankCoordinate } from "@/lib/ranking";
import type { RankSnapshot } from "@/lib/lp-metrics";

const before: RankSnapshot = {
  tier: "DIAMOND",
  division: "I",
  leaguePoints: 49,
  wins: 20,
  losses: 10,
  timestamp: "2026-10-06T12:00:00Z",
};
const after: RankSnapshot = {
  ...before,
  leaguePoints: 28,
  losses: 11,
  timestamp: "2026-10-09T12:00:00Z",
};

describe("rank trajectory display", () => {
  it("preserves official Diamond I endpoints and timestamps, with an approximate midpoint", () => {
    const history = [before, after];
    const original = structuredClone(history);
    const midpoint = (Date.parse(before.timestamp) + Date.parse(after.timestamp)) / 2;
    expect(rankAtTime(history, Date.parse(before.timestamp))).toMatchObject({
      label: "Diamond I · 49 LP",
      official: true,
    });
    expect(rankAtTime(history, Date.parse(after.timestamp))).toMatchObject({
      label: "Diamond I · 28 LP",
      official: true,
    });
    expect(rankAtTime(history, midpoint)).toMatchObject({
      label: "Diamond I · ≈ 38,5 LP",
      official: false,
    });
    expect(rankAtTime(history, midpoint)?.value).toBeCloseTo(
      (chartRankCoordinate(before)! + chartRankCoordinate(after)!) / 2,
    );
    expect(rankTrajectory(history).map((p) => p.time)).toEqual(
      history.map((p) => Date.parse(p.timestamp)),
    );
    expect(history).toEqual(original);
  });
  it.each([
    { ...after, tier: "MASTER" },
    { ...after, division: "II" },
    { ...after, tier: "UNRANKED" },
    { ...after, wins: 1 },
    { ...after, losses: 1 },
    { ...after, leaguePoints: -1 },
    { ...after, leaguePoints: NaN },
    { ...after, division: "V" },
    { ...after, timestamp: before.timestamp },
    { ...after, timestamp: "2026-10-05T12:00:00Z" },
    { ...after, timestamp: "invalid" },
    { ...after, timestamp: "2026-10-20T12:00:00Z" },
  ])("breaks discontinuities without manufacturing LP: %j", (end) => {
    expect(comparableRankInterval(before, end)).toBe(false);
    expect(rankTrajectory([before, end]).some((p) => p.value === null)).toBe(true);
    expect(rankAtTime([before, end], Date.parse("2026-10-07T12:00:00Z"))).toBeNull();
  });
  it("never bridges invalid or Unranked observations, but retains later valid segments", () => {
    const unranked = { ...before, tier: "UNRANKED", timestamp: "2026-10-07T12:00:00Z" };
    const invalid = { ...unranked, timestamp: "invalid" };
    const later = { ...after, leaguePoints: 40, wins: 21, timestamp: "2026-10-10T12:00:00Z" };
    for (const missing of [unranked, invalid]) {
      const history = [before, missing, after, later];
      expect(rankAtTime(history, Date.parse("2026-10-08T12:00:00Z"))).toBeNull();
      expect(rankAtTime(history, Date.parse("2026-10-10T00:00:00Z"))).toMatchObject({
        official: false,
      });
      expect(rankTrajectory(history).every((p) => Number.isFinite(p.time))).toBe(true);
    }
  });
  it("keeps promoted and demoted endpoints official without treating LP reset as a loss", () => {
    const gold = { ...before, tier: "GOLD", leaguePoints: 80 };
    const platinum = { ...after, tier: "PLATINUM", division: "IV", leaguePoints: 5 };
    expect(rankTrajectory([gold, platinum]).map((p) => p.value)).toEqual([
      chartRankCoordinate(gold),
      null,
      chartRankCoordinate(platinum),
    ]);
    expect(rankAtTime([gold, platinum], Date.parse(platinum.timestamp))).toMatchObject({
      label: "Platinum IV · 5 LP",
      official: true,
    });
  });
  it("uses the existing apex band on the continuous path", () => {
    const start = { ...before, tier: "MASTER", leaguePoints: 500 };
    const end = { ...after, tier: "MASTER", leaguePoints: 1000 };
    const mid = rankAtTime(
      [start, end],
      (Date.parse(start.timestamp) + Date.parse(end.timestamp)) / 2,
    )!;
    expect(mid.value).toBeCloseTo((chartRankCoordinate(start)! + chartRankCoordinate(end)!) / 2);
    expect(mid.official).toBe(false);
  });
  it("does not extrapolate or resolve ambiguous duplicate timestamps", () => {
    expect(rankAtTime([], Date.parse(before.timestamp))).toBeNull();
    expect(rankAtTime([before], Date.parse(after.timestamp))).toBeNull();
    expect(rankAtTime([before, after], Date.parse(before.timestamp) - 1)).toBeNull();
    expect(rankAtTime([before, after], Date.parse(after.timestamp) + 1)).toBeNull();
    expect(
      rankAtTime([before, { ...before, leaguePoints: 60 }], Date.parse(before.timestamp)),
    ).toBeNull();
    const ambiguous = [before, { ...before, leaguePoints: 60 }, after];
    expect(rankAtTime(ambiguous, Date.parse("2026-10-07T12:00:00Z"))).toBeNull();
    expect(rankTrajectory(ambiguous).filter((p) => p.value === null)).toHaveLength(2);
  });
  it("defines the conservative seven-day display boundary", () => {
    const end = {
      ...after,
      timestamp: new Date(Date.parse(before.timestamp) + MAX_RANK_INTERVAL_MS).toISOString(),
    };
    expect(comparableRankInterval(before, end)).toBe(true);
    expect(
      comparableRankInterval(before, {
        ...end,
        timestamp: new Date(Date.parse(end.timestamp) + 1).toISOString(),
      }),
    ).toBe(false);
  });
});
