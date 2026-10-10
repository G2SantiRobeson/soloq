import { describe, expect, it } from "vitest";
import {
  evaluateResurrection,
  evaluateUnstoppable,
  evaluateOtpSpecialist,
} from "@/lib/achievements";
import {
  match,
  matchContext,
  rankInput,
  snapshot,
  otpMatches,
  shuffle,
} from "./achievements-fixtures";

describe("1.1.B adversarial engine review", () => {
  it("ignores a confirmed remake tied with a competitive win", () => {
    const wins = Array.from({ length: 5 }, (_, i) => match(i));
    const remake = match(99, { timestamp: wins[2].timestamp, isRemake: true });
    const result = evaluateUnstoppable(matchContext([...wins, remake]));
    expect(result.status).toBe("observed");
    expect(result.evidence?.maxObservedWins).toBe(5);
    expect(result.evidence?.ignoredRemakeIds).toEqual([remake.matchId]);
    expect(result.reasons).not.toContain("ambiguous_timestamp");
  });
  it.each([false, null])("retains ambiguity for competitive/unknown remakes: %s", (isRemake) => {
    const wins = Array.from({ length: 5 }, (_, i) => match(i));
    const result = evaluateUnstoppable(
      matchContext([...wins, match(99, { timestamp: wins[2].timestamp, isRemake })]),
    );
    expect(result.status).toBe("insufficient_evidence");
    expect(result.reasons).toContain("ambiguous_timestamp");
  });
  it("is invariant under arbitrary positions of timestamp-tied confirmed remakes", () => {
    const wins = Array.from({ length: 15 }, (_, i) => match(i, { win: i !== 6 }));
    const expected = evaluateUnstoppable(matchContext(wins));
    for (let seed = 1; seed <= 30; seed++) {
      const remakes = wins.map((m, i) =>
        match(100 + i, { timestamp: m.timestamp, isRemake: true, win: null }),
      );
      const result = evaluateUnstoppable(matchContext(shuffle([...wins, ...remakes], seed)));
      expect(result.status).toBe(expected.status);
      expect(result.evidence?.matchIds).toEqual(expected.evidence?.matchIds);
      expect(result.evidence?.maxObservedWins).toBe(8);
    }
  });
  it("a low intermediate snapshot is not omitted to manufacture recovery", () => {
    const result = evaluateResurrection(
      rankInput([snapshot(80, 0), snapshot(40, 1), snapshot(10, 2), snapshot(80, 3)]),
    );
    expect(result.evidence?.minimum.leaguePoints).toBe(10);
    expect(result.evidence?.observationCount).toBe(4);
  });
  it("a division discontinuity cannot be bridged by selecting only three points", () => {
    const result = evaluateResurrection(
      rankInput([
        snapshot(80, 0),
        snapshot(25, 1),
        snapshot(0, 1.5, { division: "II" }),
        snapshot(80, 2),
      ]),
    );
    expect(result.status).toBe("insufficient_evidence");
    expect(result.evidence).toBeNull();
  });
  it("completed and zero unavailable never certify a sample or prove absent defeats", () => {
    const input = matchContext(otpMatches());
    input.coverage.historyStatus = "completed";
    for (const result of [evaluateUnstoppable(input), evaluateOtpSpecialist(input)]) {
      expect(result.certification).toBe("not_established");
      expect(result.grantAuthorized).toBe(false);
      expect(result.reasons).toContain("unproven_interval");
    }
  });
  it("70% exact arithmetic remains reversible after historical discovery", () => {
    expect(evaluateOtpSpecialist(matchContext(otpMatches())).status).toBe("observed");
    expect(
      evaluateOtpSpecialist(matchContext([...otpMatches(), match(100, { championId: 99 })])).status,
    ).toBe("not_observed");
  });
});
