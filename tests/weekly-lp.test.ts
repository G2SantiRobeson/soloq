import { describe, expect, it } from "vitest";
import { weeklyRankDelta, weeklyRankSummary } from "@/lib/weekly-lp";
import { weekStart } from "@/lib/time";
import type { RankSnapshot } from "@/lib/lp-metrics";
const now = new Date("2026-10-06T18:00:00Z");
function snapshot(
  tier = "GOLD",
  division = "II",
  leaguePoints = 50,
  timestamp = "2026-10-04T23:00:00Z",
): RankSnapshot {
  return { tier, division, leaguePoints, wins: 20, losses: 10, timestamp };
}
describe("weekly net rank displacement", () => {
  it.each([
    ["GOLD", "II", 50, "GOLD", "II", 70, 20],
    ["GOLD", "II", 50, "GOLD", "II", 20, -30],
    ["GOLD", "II", 50, "GOLD", "II", 50, 0],
    ["GOLD", "II", 50, "GOLD", "IV", 0, -250],
    ["GOLD", "IV", 0, "GOLD", "II", 30, 230],
    ["PLATINUM", "I", 80, "EMERALD", "IV", 5, 25],
    ["EMERALD", "IV", 20, "PLATINUM", "I", 70, -50],
    ["GOLD", "II", 50, "GOLD", "I", 4, 54],
    ["GOLD", "II", 50, "GOLD", "I", 104, 154],
    ["GOLD", "II", 50, "GOLD", "III", 20, -130],
    ["DIAMOND", "I", 80, "MASTER", "I", 5, 25],
    ["MASTER", "I", 350, "GRANDMASTER", "I", 370, 20],
    ["GRANDMASTER", "I", 420, "CHALLENGER", "I", 445, 25],
    ["CHALLENGER", "I", 445, "MASTER", "I", 300, -145],
  ])("%s %s %i → %s %s %i = %i", (tier, division, lp, nextTier, nextDivision, nextLp, delta) => {
    expect(
      weeklyRankDelta(
        snapshot(tier, division, lp),
        snapshot(nextTier, nextDivision, nextLp, now.toISOString()),
        now,
      ),
    ).toBe(delta);
  });
  it("does not invent a baseline for a player first tracked midweek", () => {
    expect(weeklyRankDelta(null, snapshot(), now)).toBeNull();
    expect(
      weeklyRankDelta(snapshot("GOLD", "II", 50, "2026-10-05T04:00:00Z"), snapshot(), now),
    ).toBeNull();
  });
  it("accepts Monday itself and an unchanged last valid observation", () => {
    const atMonday = snapshot("GOLD", "II", 50, weekStart(now).toISOString());
    expect(weeklyRankDelta(atMonday, atMonday, now)).toBe(0);
  });
  it("rejects unranked, invalid LP/division, future dates and counter resets", () => {
    for (const invalid of [
      snapshot("UNRANKED"),
      snapshot("GOLD", "V"),
      snapshot("GOLD", "II", -1),
      snapshot("GOLD", "II", 1.5),
      snapshot("GOLD", "II", 50, "bad"),
      snapshot("GOLD", "II", 50, "2027-01-01T00:00:00Z"),
      { ...snapshot(), wins: 1 },
      { ...snapshot(), losses: -1 },
    ]) {
      expect(weeklyRankDelta(snapshot(), invalid, now)).toBeNull();
    }
  });
});
describe("Monday in Santiago, independently of the server timezone", () => {
  it.each([
    ["2026-10-06T18:00:00Z", "2026-10-05T03:00:00.000Z"],
    ["2026-07-08T12:00:00Z", "2026-07-06T04:00:00.000Z"],
    ["2026-10-05T02:59:59Z", "2026-09-28T03:00:00.000Z"],
    ["2026-10-05T03:00:00Z", "2026-10-05T03:00:00.000Z"],
    ["2026-09-06T12:00:00Z", "2026-08-31T04:00:00.000Z"],
    ["2026-09-07T03:00:00Z", "2026-09-07T03:00:00.000Z"],
    ["2026-04-05T12:00:00Z", "2026-03-30T03:00:00.000Z"],
    ["2026-04-06T04:00:00Z", "2026-04-06T04:00:00.000Z"],
    ["2026-10-12T02:59:59Z", "2026-10-05T03:00:00.000Z"],
    ["2026-10-12T03:00:00Z", "2026-10-12T03:00:00.000Z"],
  ])("%s begins %s", (instant, monday) =>
    expect(weekStart(new Date(instant)).toISOString()).toBe(monday),
  );
});

describe("new weekly observation interval", () => {
  const sunday = new Date("2026-10-12T02:59:59Z");
  const monday = new Date("2026-10-12T03:00:00Z");
  const baseline = snapshot("GOLD", "II", 50, "2026-10-04T23:00:00Z");
  const latest = {
    ...baseline,
    timestamp: "2026-10-11T20:00:00Z",
    leaguePoints: 75,
    wins: 23,
    losses: 12,
  };
  it("ends the previous interval at Monday midnight without inventing a zero", () => {
    expect(weeklyRankSummary([baseline, latest], sunday)).toMatchObject({
      net: 25,
      wins: 3,
      losses: 2,
    });
    expect(weeklyRankSummary([baseline, latest], monday)).toBeNull();
    expect(weeklyRankSummary([], monday)).toBeNull();
    expect(weeklyRankSummary([latest], monday)).toBeNull();
  });
  it("uses only the nearest pre-Monday reference for the new LP and V/D interval", () => {
    const next = { ...latest, timestamp: "2026-10-12T04:00:00Z", leaguePoints: 90, wins: 24 };
    expect(weeklyRankSummary([baseline, latest, next], new Date(next.timestamp))).toMatchObject({
      net: 15,
      wins: 1,
      losses: 0,
      from: latest.timestamp,
      to: next.timestamp,
      partial: false,
    });
  });
  it("starts a partial interval within the new week only after two observations", () => {
    const a = { ...latest, timestamp: "2026-10-12T04:00:00Z" };
    const b = { ...a, timestamp: "2026-10-12T05:00:00Z", leaguePoints: 60, losses: 13 };
    expect(weeklyRankSummary([a], new Date(b.timestamp))).toBeNull();
    expect(weeklyRankSummary([a, b], new Date(b.timestamp))).toMatchObject({
      net: -15,
      wins: 0,
      losses: 1,
      from: a.timestamp,
      to: b.timestamp,
      partial: true,
    });
  });
});
