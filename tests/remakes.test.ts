import { describe, expect, it } from "vitest";
import { isRemake, matchOutcome } from "@/lib/match-outcome";
import { aggregate } from "@/lib/stats";
describe("remakes", () => {
  it("uses any participant's explicit Riot marker, including the opposing team", () => {
    expect(isRemake({ info: { participants: [{}, { gameEndedInEarlySurrender: true }] } })).toBe(
      true,
    );
    expect(isRemake({ info: { participants: [{ gameEndedInEarlySurrender: false }] } })).toBe(
      false,
    );
    expect(isRemake({ info: { participants: [{}] } })).toBe(false);
  });
  it("labels a remake independently of the raw win flag", () => {
    expect(matchOutcome({ win: false, isRemake: true })).toBe("Remake");
    expect(matchOutcome({ win: true, isRemake: true })).toBe("Remake");
    expect(matchOutcome({ win: false, isRemake: false })).toBe("Derrota");
    expect(matchOutcome({ win: true })).toBe("Victoria");
  });
  it("excludes remakes from every aggregate, not just the loss count", () => {
    const normal = {
      win: true,
      kills: 5,
      deaths: 2,
      assists: 4,
      cs: 150,
      duration: 1200,
      damage: 15000,
    };
    expect(aggregate([normal, { ...normal, win: false, isRemake: true, kills: 99 }])).toEqual(
      aggregate([normal]),
    );
    expect(aggregate([{ ...normal, isRemake: true }]).games).toBe(0);
  });
});
