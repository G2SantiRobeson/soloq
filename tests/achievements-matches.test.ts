import { describe, expect, it } from "vitest";
import {
  evaluateOtpSpecialist,
  evaluateUnstoppable,
  OTP_RULE,
  UNSTOPPABLE_RULE,
} from "@/lib/achievements";
import {
  coverage,
  deepFreeze,
  match,
  matchContext,
  otpMatches,
  shuffle,
} from "./achievements-fixtures";

describe("Imparable: recorded sequence, never an automatic certificate", () => {
  it.each([4, 5, 6])("measures %i wins without granting anything", (n) => {
    const result = evaluateUnstoppable(matchContext(Array.from({ length: n }, (_, i) => match(i))));
    expect(result).toMatchObject({
      status: n < 5 ? "insufficient_evidence" : "observed",
      grantAuthorized: false,
      certification: "not_established",
      evidence: { maxObservedWins: n },
    });
    expect(result.reasons).toContain("unproven_interval");
  });
  it("scenario B ignores a confirmed interleaved remake, retaining its ID in evidence", () => {
    const matches = [
      match(0),
      match(1),
      match(2, { isRemake: true, win: false }),
      match(3),
      match(4),
      match(5),
    ];
    expect(evaluateUnstoppable(matchContext(matches))).toMatchObject({
      status: "observed",
      evidence: {
        maxObservedWins: 5,
        matchIds: ["fictitious-0", "fictitious-1", "fictitious-3", "fictitious-4", "fictitious-5"],
        ignoredRemakeIds: ["fictitious-2"],
      },
    });
  });
  it("losses cut a run and remakes before/after a loss do not hide it", () => {
    const rows = [
      match(0),
      match(1, { isRemake: true }),
      match(2, { win: false }),
      match(3, { isRemake: true }),
      ...Array.from({ length: 4 }, (_, i) => match(i + 4)),
    ];
    expect(evaluateUnstoppable(matchContext(rows))).toMatchObject({
      status: "not_observed",
      evidence: { maxObservedWins: 4 },
    });
  });
  it.each([{ isRemake: null }, { win: null }])(
    "unknown values cut rather than join a run: %j",
    (change) => {
      const rows = Array.from({ length: 7 }, (_, i) => match(i, i === 3 ? change : {}));
      const result = evaluateUnstoppable(matchContext(rows));
      expect(result).toMatchObject({
        status: "insufficient_evidence",
        evidence: { maxObservedWins: 3 },
      });
    },
  );
  it("does not discard a later clean observed streak because an earlier row is uncertain", () => {
    expect(
      evaluateUnstoppable(
        matchContext([
          match(0, { isRemake: null }),
          ...Array.from({ length: 5 }, (_, i) => match(i + 1)),
        ]),
      ).status,
    ).toBe("observed");
  });
  it("reports uncertainty rather than a small sample when enough known games exist", () => {
    const rows = Array.from({ length: 9 }, (_, i) => match(i, i === 4 ? { isRemake: null } : {}));
    const result = evaluateUnstoppable(matchContext(rows));
    expect(result.status).toBe("insufficient_evidence");
    expect(result.reasons).toContain("unknown_remake");
    expect(result.reasons).not.toContain("insufficient_sample");
  });
  it("distinct simultaneous records make ordering ambiguous and cut the sequence", () => {
    const rows = Array.from({ length: 6 }, (_, i) => match(i));
    rows[3] = { ...rows[3], timestamp: rows[2].timestamp };
    const result = evaluateUnstoppable(matchContext(rows));
    expect(result.status).toBe("insufficient_evidence");
    expect(result.reasons).toContain("ambiguous_timestamp");
  });
  it("same maximum chooses the earliest run, including runs at either boundary", () => {
    const rows = Array.from({ length: 11 }, (_, i) => match(i, { win: i !== 5 }));
    expect(evaluateUnstoppable(matchContext(rows))).toMatchObject({
      evidence: { maxObservedWins: 5, matchIds: rows.slice(0, 5).map((m) => m.matchId) },
    });
  });
  it("ignores trailing remakes outside the winning interval", () => {
    const rows = [...Array.from({ length: 5 }, (_, i) => match(i)), match(6, { isRemake: true })];
    expect(evaluateUnstoppable(matchContext(rows)).evidence?.ignoredRemakeIds).toEqual([]);
  });
  it("accepts explicit provisional thresholds without persistence", () => {
    expect(
      evaluateUnstoppable(matchContext([match(1), match(2)]), { ...UNSTOPPABLE_RULE, minWins: 2 })
        .status,
    ).toBe("observed");
  });
  it("adding a previously missing loss can invalidate the recorded run", () => {
    const rows = Array.from({ length: 5 }, (_, i) => match(i * 2));
    expect(evaluateUnstoppable(matchContext(rows)).status).toBe("observed");
    expect(evaluateUnstoppable(matchContext([...rows, match(3, { win: false })])).status).toBe(
      "not_observed",
    );
  });
});

describe("OTP: exact champion proportion of the imported sample", () => {
  it.each([
    [49, 49, "insufficient_evidence"],
    [50, 35, "observed"],
    [50, 34, "not_observed"],
    [100, 69, "not_observed"],
    [100, 70, "observed"],
    [100, 71, "observed"],
  ])("%i games, %i on the main champion => %s", (n, c, status) => {
    const result = evaluateOtpSpecialist(matchContext(otpMatches(Number(n), Number(c))));
    expect(result).toMatchObject({
      status,
      grantAuthorized: false,
      certification: "not_established",
      evidence: { championGames: c, validGames: n, share: { numerator: c, denominator: n } },
    });
  });
  it("scenario C is exactly 35/50, not an annual certificate", () => {
    const result = evaluateOtpSpecialist(matchContext(otpMatches()));
    expect(result).toMatchObject({
      status: "observed",
      evidence: {
        championId: 157,
        share: { numerator: 35, denominator: 50 },
        limitation: "imported_sample_not_season_certification",
      },
    });
  });
  it("confirmed remakes do not increase sample or champion totals", () => {
    const rows = [...otpMatches(), match(100, { isRemake: true, championId: 99, win: false })];
    expect(evaluateOtpSpecialist(matchContext(rows))).toMatchObject({
      status: "observed",
      evidence: { validGames: 50, championGames: 35 },
    });
  });
  it.each([{ isRemake: null }, { championId: null }, { win: null }])(
    "unknown in-scope data prevents a positive ratio claim: %j",
    (changes) => {
      const result = evaluateOtpSpecialist(matchContext([...otpMatches(), match(100, changes)]));
      expect(result.status).toBe("insufficient_evidence");
    },
  );
  it("champion identity uses ID, and the smaller ID resolves ties", () => {
    const rows = otpMatches(50, 25);
    const result = evaluateOtpSpecialist(matchContext(rows), {
      ...OTP_RULE,
      minShare: { numerator: 1, denominator: 2 },
    });
    expect(result).toMatchObject({
      status: "observed",
      evidence: { championId: 99, championGames: 25 },
    });
  });
  it("does not use rounded percentages or unsafe floating multiplications", () => {
    const largeRule = {
      ...OTP_RULE,
      minShare: { numerator: Number.MAX_SAFE_INTEGER - 1, denominator: Number.MAX_SAFE_INTEGER },
    };
    expect(evaluateOtpSpecialist(matchContext(otpMatches(50, 49)), largeRule).status).toBe(
      "not_observed",
    );
  });
  it("backfilled older games can contradict the prior observed specialization", () => {
    const rows = otpMatches();
    expect(evaluateOtpSpecialist(matchContext(rows)).status).toBe("observed");
    expect(
      evaluateOtpSpecialist(matchContext([...rows, match(-1, { championId: 99 })])).status,
    ).toBe("not_observed");
  });
});

describe.each([
  ["unstoppable", evaluateUnstoppable, () => Array.from({ length: 5 }, (_, i) => match(i))],
  ["otp-specialist", evaluateOtpSpecialist, () => otpMatches()],
] as const)("match contract: %s", (_code, evaluate, makeMatches) => {
  it.each(["running", "completed", "not_started", "failed", "unknown"] as const)(
    "history=%s never implies a certificate",
    (historyStatus) => {
      const result = evaluate({
        ...matchContext(makeMatches()),
        coverage: { ...coverage, historyStatus },
      });
      expect(result.status).toBe("observed");
      expect(result.certification).toBe("not_established");
      expect(result.grantAuthorized).toBe(false);
    },
  );
  it("unavailable details are retained as a limitation", () => {
    const result = evaluate({
      ...matchContext(makeMatches()),
      coverage: { ...coverage, historyStatus: "completed", unavailable: 1 },
    });
    expect(result.status).toBe("observed");
    expect(result.reasons).toContain("unavailable_matches");
  });
  it("deduplicates identical matches but rejects contradictory IDs", () => {
    const rows = makeMatches();
    expect(evaluate(matchContext([...rows, { ...rows[0] }])).evidence).toEqual(
      evaluate(matchContext(rows)).evidence,
    );
    expect(evaluate(matchContext([...rows, { ...rows[0], win: false }])).status).toBe(
      "invalid_input",
    );
  });
  it("validates unknown queues, missing results, invalid timestamps and champions", () => {
    for (const change of [
      { queueId: 12345 },
      { timestamp: "invalid" },
      { championId: 0 },
      { win: "win" },
    ]) {
      expect(
        evaluate({ ...matchContext([]), matches: [{ ...makeMatches()[0], ...change }] }).status,
      ).toBe("invalid_input");
    }
    const missing = { ...makeMatches()[0] };
    delete (missing as Partial<typeof missing>).win;
    expect(evaluate(matchContext([missing])).status).toBe("invalid_input");
  });
  it.each(["soloq", "flex"] as const)(
    "isolates %s from mixed queues and outside-season rows",
    (view) => {
      const queueId = view === "soloq" ? 420 : 440;
      const rows = makeMatches().map((m) => ({ ...m, queueId }));
      const input = { ...matchContext(rows), scope: { ...matchContext(rows).scope, view } };
      const clean = evaluate(input);
      const extra = [
        match(100, { queueId: queueId === 420 ? 440 : 420 }),
        match(101, { timestamp: "2025-10-01T00:00:00Z" }),
        match(102, { timestamp: input.scope.asOf }),
      ];
      expect(evaluate({ ...input, matches: [...rows, ...extra] }).evidence).toEqual(clean.evidence);
      expect(clean.status).toBe("observed");
    },
  );
  it("empty sample has no fabricated measurement or division by zero", () => {
    const result = evaluate(matchContext([]));
    expect(result).toMatchObject({ status: "insufficient_evidence", evidence: null });
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });
  it("is immutable, serializable, deterministic and permutation invariant", () => {
    const input = deepFreeze(matchContext(makeMatches()));
    const baseline = evaluate(input);
    expect(JSON.parse(JSON.stringify(baseline))).toEqual(baseline);
    for (let seed = 0; seed < 20; seed++)
      expect(evaluate({ ...input, matches: shuffle(input.matches, seed) })).toEqual(baseline);
  });
});
