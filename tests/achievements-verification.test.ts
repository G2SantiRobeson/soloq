import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  evaluateResurrection,
  evaluateUnstoppable,
  evaluateOtpSpecialist,
  ACHIEVEMENT_RULE_VERSION,
  OTP_RULE_VERSION,
  type AchievementMatch,
} from "@/lib/achievements";
import {
  VERIFICATION_POLICIES,
  type VerificationContext,
  type VerificationSubmission,
  type ReconciliationReceipt,
  type VerificationDryRun,
} from "@/server/achievements/verification/contracts";
import { simulateBadgeVerification } from "@/server/achievements/verification/verify";
import {
  fixedScope,
  rankInput,
  snapshot,
  match,
  matchContext,
  otpMatches,
  deepFreeze,
} from "./achievements-fixtures";

const identity = {
  playerId: "00000000-0000-4000-8000-000000000001",
  platform: "LA2",
  queue: "RANKED_SOLO_5x5",
  season: "2026",
} as const;
const evaluatedAt = "2026-11-02T00:00:00Z";
function matches(rows = Array.from({ length: 5 }, (_, i) => match(i))) {
  return rows.map((m, i) => ({ ...m, matchId: `LA2_${i + 1}` }));
}
function setup(code: VerificationSubmission["code"] = "resurrection", rows?: AchievementMatch[]) {
  const input =
    code === "resurrection"
      ? { ...rankInput(), scope: structuredClone(fixedScope) }
      : { ...matchContext(rows ?? matches()), scope: structuredClone(fixedScope) };
  const observation =
    code === "resurrection"
      ? evaluateResurrection(input)
      : code === "unstoppable"
        ? evaluateUnstoppable(input)
        : evaluateOtpSpecialist(input);
  const submission: VerificationSubmission = {
    code,
    evaluatorVersion: code === "otp-specialist" ? OTP_RULE_VERSION : ACHIEVEMENT_RULE_VERSION,
    policyVersion: VERIFICATION_POLICIES[code],
    evidence: { state: "available", input, presentedEvidence: observation.evidence },
    reconciliation: { state: "unknown" },
    seasonClosure: { state: "not_applicable" },
  };
  const context: VerificationContext = {
    environment: "local",
    identity,
    evaluatedAt,
    source: "stored_riot",
    provenance: {
      state: "known",
      value: {
        identity,
        traceId: "synthetic-materialization",
        readAt: evaluatedAt,
        dataCutoff: fixedScope.asOf,
        recordIds:
          "snapshots" in input
            ? input.snapshots.map((s) => s.id!)
            : input.matches.map((m) => m.matchId),
      },
    },
    sourceRevision: { state: "unknown" },
    policyAuthorization: { state: "simulation_only", version: VERIFICATION_POLICIES[code] },
  };
  return { input, observation, submission, context };
}
function receipt(rows: AchievementMatch[]): ReconciliationReceipt {
  return {
    version: "1.2.B.1-receipt-draft-v1",
    origin: "server_reconciliation",
    identity,
    traceId: "synthetic-reconciliation",
    checkedAt: evaluatedAt,
    interval: {
      from: rows[0].timestamp,
      to: new Date(Date.parse(rows.at(-1)!.timestamp) + 1).toISOString(),
    },
    query: {
      from: rows[0].timestamp,
      to: new Date(Date.parse(rows.at(-1)!.timestamp) + 1000).toISOString(),
      precision: "seconds",
      bounds: "half_open",
      exhausted: { state: "known", value: true },
    },
    ids: rows.map((m) => m.matchId),
    details: rows.map((record) => ({ state: "resolved", record })),
    limitation: "recoverable_records_not_absolute_riot_history",
  };
}
function result(f: ReturnType<typeof setup>): VerificationDryRun {
  return simulateBadgeVerification(f.submission, f.context);
}
function hasReason(f: ReturnType<typeof setup>, reason: string) {
  const r = result(f);
  expect(r.status).toBe("blocked");
  expect(r.reasons).toContain(reason);
  expect(r.grantAuthorized).toBe(false);
  expect(r.certification).toBe("not_established");
}

describe("server-internal badge verification dry-run", () => {
  it("checks R1 without certification, IO, revision claims or mutation", () => {
    const f = deepFreeze(setup());
    const r = result(f);
    expect(r.status).toBe("requirements_satisfied");
    expect(r).toMatchObject({
      grantAuthorized: false,
      certification: "not_established",
      writes: "none",
      provenanceAuthentication: "not_performed",
    });
    if ("limitations" in r) expect(r.limitations).toContain("no_transactional_revision_check");
    expect(r.observation).toEqual(f.observation);
    expect(JSON.stringify(r)).not.toMatch(/puuid|password|token/);
  });
  it.each([49, 50])("keeps the %i LP boundary and exact engine result", (drop) => {
    const f = setup();
    const input = rankInput([snapshot(80, 0), snapshot(80 - drop, 1), snapshot(80, 2)]);
    f.submission.evidence = {
      state: "available",
      input,
      presentedEvidence: evaluateResurrection(input).evidence,
    };
    expect(result(f).observation).toEqual(evaluateResurrection(input));
    expect(result(f).status).toBe(drop === 50 ? "requirements_satisfied" : "blocked");
  });
  it.each([30, 30 + 1 / 86400000])("keeps the R1 recovery window from A: %s days", (end) => {
    const rows = [
      snapshot(80, 0),
      snapshot(30, 1),
      ...[7, 14, 21, 28].map((d) => snapshot(30, d)),
      snapshot(80, end),
    ];
    const f = setup();
    const input = rankInput(rows);
    f.submission.evidence = {
      state: "available",
      input,
      presentedEvidence: evaluateResurrection(input).evidence,
    };
    if (f.context.provenance.state === "known")
      f.context.provenance.value.recordIds = rows.map((s) => s.id!);
    expect(result(f).observation).toEqual(evaluateResurrection(input));
    expect(result(f).status).toBe(end === 30 ? "requirements_satisfied" : "blocked");
  });
  it.each([7, 7 + 1 / 86400000])("keeps the R1 snapshot gap boundary: %s days", (gap) => {
    const f = setup(),
      input = rankInput([snapshot(80, 0), snapshot(30, gap), snapshot(80, gap + 1)]);
    f.submission.evidence = {
      state: "available",
      input,
      presentedEvidence: evaluateResurrection(input).evidence,
    };
    if (f.context.provenance.state === "known")
      f.context.provenance.value.recordIds = input.snapshots.map((s) => s.id!);
    expect(result(f).status).toBe(gap === 7 ? "requirements_satisfied" : "blocked");
    expect(result(f).observation).toEqual(evaluateResurrection(input));
  });
  it("rejects missing snapshots even when a presented recovery claims them", () => {
    const f = setup();
    if (f.submission.evidence.state === "available")
      f.submission.evidence.input = rankInput([snapshot(80, 0), snapshot(80, 2)]);
    hasReason(f, "source_set_mismatch");
    expect(result(f).reasons).toContain("evidence_mismatch");
  });
  it("does not verify five recorded wins or completed backfill without an interval receipt", () => {
    const f = setup("unstoppable");
    if ("matches" in f.input) f.input.coverage.historyStatus = "completed";
    hasReason(f, "receipt_missing");
    expect(result(f).observation?.status).toBe("observed");
  });
  it("simulates an internally supplied receipt without claiming Riot authentication", () => {
    const rows = matches(),
      f = setup("unstoppable", rows);
    f.submission.reconciliation = { state: "known", value: receipt(rows) };
    expect(result(f).status).toBe("requirements_satisfied");
    expect(result(f).grantAuthorized).toBe(false);
  });
  it.each(["unknown", "not_applicable"] as const)(
    "missing %s receipt cannot imply coverage",
    (state) => {
      const f = setup("unstoppable");
      f.submission.reconciliation = { state };
      hasReason(f, "receipt_missing");
    },
  );
  it.each(["unknown", "not_applicable"] as const)("query exhaustion %s is incomplete", (state) => {
    const rows = matches(),
      f = setup("unstoppable", rows),
      proof = receipt(rows);
    proof.query.exhausted = { state };
    f.submission.reconciliation = { state: "known", value: proof };
    hasReason(f, "receipt_incomplete");
  });
  it.each(["unknown", "unavailable"] as const)(
    "%s detail blocks interval verification",
    (state) => {
      const rows = matches(),
        f = setup("unstoppable", rows),
        proof = receipt(rows);
      proof.details[2] =
        state === "unknown"
          ? { state, matchId: rows[2].matchId }
          : { state, matchId: rows[2].matchId, code: 404 };
      f.submission.reconciliation = { state: "known", value: proof };
      hasReason(f, state === "unknown" ? "receipt_unknown_detail" : "receipt_unavailable_detail");
    },
  );
  it.each(["omit", "duplicate", "reorder", "contradict", "last_endpoint", "future"])(
    "blocks receipt defect: %s",
    (defect) => {
      const rows = matches(),
        f = setup("unstoppable", rows),
        proof = structuredClone(receipt(rows));
      if (defect === "omit") {
        proof.ids.pop();
        proof.details.pop();
      }
      if (defect === "duplicate") {
        proof.ids.push(proof.ids[0]);
        proof.details.push(proof.details[0]);
      }
      if (defect === "reorder") proof.ids.reverse();
      if (defect === "contradict" && proof.details[2].state === "resolved")
        proof.details[2].record.win = false;
      if (defect === "last_endpoint") proof.interval.to = rows.at(-1)!.timestamp;
      if (defect === "future") proof.checkedAt = "2026-12-01T00:00:00Z";
      f.submission.reconciliation = { state: "known", value: proof };
      expect(result(f).status).toBe("blocked");
    },
  );
  it("confirmed remakes remain excluded but unknown remakes block", () => {
    const rows = matches([
      ...Array.from({ length: 3 }, (_, i) => match(i)),
      match(3, { isRemake: true, win: false }),
      match(4),
      match(5),
    ]);
    const f = setup("unstoppable", rows);
    f.submission.reconciliation = { state: "known", value: receipt(rows) };
    expect(result(f).status).toBe("requirements_satisfied");
    rows[3].isRemake = null;
    expect(result(f).status).toBe("blocked");
    expect(result(f).observation).toEqual(evaluateUnstoppable(matchContext(rows)));
  });
  it.each([
    [32, 50, "not_observed"],
    [33, 50, "observed"],
    [65, 100, "observed"],
    [64, 100, "not_observed"],
    [13, 20, "insufficient_evidence"],
  ] as const)("preserves OTP %i/%i = %s while blocking an open season", (count, total, state) => {
    const f = setup("otp-specialist", matches(otpMatches(total, count)));
    hasReason(f, "season_not_closed");
    expect(result(f).observation?.status).toBe(state);
    expect(result(f).observation).toEqual(evaluateOtpSpecialist(f.input));
  });
  function closedOtp() {
    const rows = matches(otpMatches(50, 33)),
      f = setup("otp-specialist", rows);
    const endAt = "2026-10-31T00:00:00Z"; // Explicitly synthetic closure, not the real season.
    f.input.scope.season = { ...f.input.scope.season, endAt };
    f.submission.seasonClosure = {
      state: "known",
      value: {
        season: "2026",
        platform: "LA2",
        endAt,
        confirmedAt: evaluatedAt,
        basis: "approved_regional_calendar",
      },
    };
    const proof = receipt(rows);
    proof.interval = { from: f.input.scope.season.startAt, to: endAt };
    proof.query.from = proof.interval.from;
    proof.query.to = endAt;
    f.submission.reconciliation = { state: "known", value: proof };
    if (f.submission.evidence.state === "available")
      f.submission.evidence.presentedEvidence = evaluateOtpSpecialist(f.input).evidence;
    return f;
  }
  it("accepts only a synthetic closed denominator and complete seasonal receipt in simulation", () => {
    const f = closedOtp();
    expect(result(f).status).toBe("requirements_satisfied");
    expect(result(f).grantAuthorized).toBe(false);
  });
  it("a partial denominator receipt cannot verify historical OTP", () => {
    const f = closedOtp();
    if (f.submission.reconciliation.state === "known")
      f.submission.reconciliation.value.interval.from = "2026-10-01T00:00:00Z";
    hasReason(f, "receipt_incomplete");
  });
  it("an unconfirmed or contradictory closure is blocked", () => {
    const f = closedOtp();
    f.submission.seasonClosure = { state: "unknown" };
    hasReason(f, "season_not_closed");
    const g = closedOtp();
    if (g.submission.seasonClosure.state === "known")
      g.submission.seasonClosure.value.endAt = evaluatedAt;
    hasReason(g, "season_not_closed");
  });
  it.each(["unknown", "not_applicable"] as const)(
    "sufficient sample with %s provenance is blocked",
    (state) => {
      const f = setup();
      f.context.provenance = { state };
      hasReason(f, "provenance_missing");
    },
  );
  it.each(["client", "demo", "unknown"] as const)("%s cannot become trusted evidence", (source) => {
    const f = setup();
    f.context.source = source;
    hasReason(f, "source_not_trusted");
  });
  it.each(["production", "unknown"] as const)(
    "%s does not gain verification or grant capability",
    (environment) => {
      const f = setup();
      f.context.environment = environment;
      hasReason(f, "environment_not_permitted");
    },
  );
  it("does not activate policies; missing authorization and unknown versions block", () => {
    const f = setup();
    f.context.policyAuthorization = { state: "not_authorized" };
    hasReason(f, "policy_not_authorized");
    const g = setup();
    g.submission.policyVersion = "unregistered";
    hasReason(g, "policy_unknown");
    const h = setup();
    h.submission.evaluatorVersion = OTP_RULE_VERSION;
    hasReason(h, "evaluator_version_mismatch");
  });
  it.each(["identity", "queue", "season", "platform", "cutoff"])(
    "inconsistent %s blocks",
    (field) => {
      const f = setup();
      if (field === "queue") f.context.identity = { ...identity, queue: "RANKED_FLEX_SR" };
      if (field === "season") f.context.identity = { ...identity, season: "2025" };
      if (field === "platform") f.context.identity = { ...identity, platform: "BR1" };
      if (field === "identity")
        f.context.identity = { ...identity, playerId: "00000000-0000-4000-8000-000000000002" };
      if (field === "cutoff" && f.context.provenance.state === "known")
        f.context.provenance.value.dataCutoff = "2026-10-01T00:00:00Z";
      expect(result(f).status).toBe("blocked");
    },
  );
  it("unknown outcome and an ambiguous interval never certify a streak", () => {
    const rows = matches();
    rows[2].win = null;
    const f = setup("unstoppable", rows);
    f.submission.reconciliation = { state: "known", value: receipt(rows) };
    expect(result(f).status).toBe("blocked");
    expect(result(f).observation?.status).toBe("insufficient_evidence");
  });
  it("malformed client objects and truncated evidence are never authoritative", () => {
    expect(simulateBadgeVerification({ grantAuthorized: true }, {}).status).toBe("invalid_input");
    const f = setup();
    if (f.submission.evidence.state === "available")
      f.submission.evidence.presentedEvidence = { status: "observed" };
    hasReason(f, "evidence_mismatch");
  });
  it("does not silently project interpolation markers into official-looking snapshots", () => {
    const f = setup();
    const input = rankInput();
    if (f.submission.evidence.state === "available")
      f.submission.evidence.input = {
        ...input,
        snapshots: input.snapshots.map((s) => ({ ...s, interpolated: true })),
      };
    hasReason(f, "invalid_structure");
  });
  it("rejects corrupt observations without exposing submitted secrets", () => {
    const f = setup();
    if (f.submission.evidence.state === "available")
      f.submission.evidence.input = { password: "synthetic-secret" };
    hasReason(f, "observation_invalid");
    expect(JSON.stringify(result(f))).not.toContain("synthetic-secret");
  });
  it("does not pretend an opaque future revision was checked transactionally", () => {
    const f = setup();
    f.context.sourceRevision = { state: "known", value: "42" };
    const r = result(f);
    expect(r.status).toBe("requirements_satisfied");
    if ("limitations" in r) expect(r.limitations).toContain("no_transactional_revision_check");
    expect(r.grantAuthorized).toBe(false);
  });
  it("rejects receipt identity substitution and records from another platform", () => {
    const rows = matches(),
      f = setup("unstoppable", rows),
      proof = receipt(rows);
    proof.identity = { ...identity, playerId: "00000000-0000-4000-8000-000000000002" };
    f.submission.reconciliation = { state: "known", value: proof };
    hasReason(f, "receipt_scope_mismatch");
    const g = setup(
      "unstoppable",
      rows.map((r) => ({ ...r, matchId: r.matchId.replace("LA2_", "BR1_") })),
    );
    hasReason(g, "scope_mismatch");
  });
  it("service failure is neutral, not a negative observation", () => {
    const f = setup();
    f.submission.evidence = { state: "unavailable", reason: "infrastructure" };
    expect(result(f)).toMatchObject({
      status: "unavailable",
      observation: null,
      grantAuthorized: false,
    });
  });
  it("preserves reproducibility and accepts equivalent evidence key order", () => {
    const f = setup();
    if (f.submission.evidence.state === "available")
      f.submission.evidence.presentedEvidence = Object.fromEntries(
        Object.entries(f.observation.evidence!).reverse(),
      );
    expect(result(f).status).toBe("requirements_satisfied");
    expect(result(f)).toEqual(result(f));
  });
  it("stays unwired, server-only, pure, with no IO or grant permission in its API", () => {
    for (const file of ["contracts", "schema", "verify"]) {
      const source = readFileSync(`src/server/achievements/verification/${file}.ts`, "utf8");
      expect(source).toContain('import "server-only"');
      expect(source).not.toMatch(
        /fetch\(|process\.env|Date\.now\(|from ["']@\/db|\.insert\(|\.update\(|\.delete\(/,
      );
    }
  });
});
