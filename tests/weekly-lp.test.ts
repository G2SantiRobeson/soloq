import { describe, expect, it } from "vitest";
import { weeklyRankDelta } from "@/lib/weekly-lp";
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
  ])("%s begins %s", (instant, monday) =>
    expect(weekStart(new Date(instant)).toISOString()).toBe(monday),
  );
});
