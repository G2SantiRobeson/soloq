import "server-only";
import {
  ACHIEVEMENT_RULE_VERSION,
  OTP_RULE_VERSION,
  evaluateResurrection,
  evaluateUnstoppable,
  evaluateOtpSpecialist,
  type AchievementMatch,
  type AchievementScope,
} from "@/lib/achievements";
import {
  parseRankInput,
  parseMatchInput,
  scopeQueue,
  scopeQueueId,
  scopeBounds,
} from "@/lib/achievements/validation";
import {
  VERIFICATION_POLICIES,
  type VerificationContext,
  type VerificationIdentity,
  type ReconciliationReceipt,
  type VerificationBlockReason,
  type VerificationDryRun,
} from "./contracts";
import { contextSchema, submissionSchema } from "./schema";

const base = {
  mode: "internal_dry_run",
  certification: "not_established",
  grantAuthorized: false,
  writes: "none",
  provenanceAuthentication: "not_performed",
} as const;
const time = (s: string) => Date.parse(s);
const sameIdentity = (a: VerificationIdentity, b: VerificationIdentity) =>
  a.playerId === b.playerId &&
  a.platform === b.platform &&
  a.queue === b.queue &&
  a.season === b.season;
function sameSet(a: string[], b: string[]) {
  const supplied = new Set(a),
    expected = new Set(b);
  return (
    supplied.size === a.length &&
    expected.size === b.length &&
    a.length === b.length &&
    a.every((id) => expected.has(id))
  );
}
/** Traverses only the finite evaluator-owned shape; rejects extra fields and truncated DTOs. */
function sameEvidence(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (!expected || typeof expected !== "object" || !actual || typeof actual !== "object")
    return false;
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, i) => sameEvidence(actual[i], value))
    );
  if (Array.isArray(actual)) return false;
  const supplied = actual as Record<string, unknown>;
  const entries = Object.entries(expected);
  return (
    entries.length === Object.keys(supplied).length &&
    entries.every(
      ([key, value]) => Object.hasOwn(supplied, key) && sameEvidence(supplied[key], value),
    )
  );
}

function receiptReasons(
  receipt: ReconciliationReceipt,
  context: VerificationContext,
  scope: AchievementScope,
  matches: readonly AchievementMatch[],
  required: { from: string; to: string },
): VerificationBlockReason[] {
  const reasons: VerificationBlockReason[] = [];
  const start = time(receipt.interval.from),
    end = time(receipt.interval.to);
  const qStart = time(receipt.query.from),
    qEnd = time(receipt.query.to);
  const bounds = scopeBounds(scope);
  if (!sameIdentity(receipt.identity, context.identity)) reasons.push("receipt_scope_mismatch");
  if (
    start >= end ||
    qStart >= qEnd ||
    qStart > start ||
    qEnd < end ||
    start < bounds.start ||
    end > bounds.end ||
    start > time(required.from) ||
    end <= time(required.to) ||
    qStart % 1000 !== 0 ||
    qEnd % 1000 !== 0 ||
    time(receipt.checkedAt) < qEnd ||
    time(receipt.checkedAt) > time(context.evaluatedAt) ||
    (context.provenance.state === "known" &&
      time(receipt.checkedAt) > time(context.provenance.value.readAt))
  )
    reasons.push("receipt_incomplete");
  if (receipt.query.exhausted.state !== "known") reasons.push("receipt_incomplete");
  const detailsIds = receipt.details.map((d) =>
    d.state === "resolved" ? d.record.matchId : d.matchId,
  );
  if (!sameSet(receipt.ids, detailsIds)) reasons.push("receipt_mismatch");
  const stored = new Map(matches.map((m) => [m.matchId, m]));
  const resolved: AchievementMatch[] = [];
  for (const detail of receipt.details) {
    if (detail.state === "unknown") {
      reasons.push("receipt_unknown_detail");
      continue;
    }
    if (detail.state === "unavailable") {
      reasons.push("receipt_unavailable_detail");
      continue;
    }
    const m = detail.record;
    resolved.push(m);
    if (
      m.queueId !== scopeQueueId(scope) ||
      time(m.timestamp) < qStart ||
      time(m.timestamp) >= qEnd
    )
      reasons.push("receipt_scope_mismatch");
    if (!sameEvidence(m, stored.get(m.matchId))) reasons.push("receipt_mismatch");
    if (m.isRemake === null || (m.isRemake !== true && (m.win === null || m.championId === null)))
      reasons.push("receipt_unknown_detail");
  }
  const within = (m: AchievementMatch) => time(m.timestamp) >= start && time(m.timestamp) < end;
  if (
    !sameSet(
      matches.filter(within).map((m) => m.matchId),
      resolved.filter(within).map((m) => m.matchId),
    )
  )
    reasons.push("receipt_mismatch");
  const ordered = [...resolved].sort(
    (a, b) =>
      time(a.timestamp) - time(b.timestamp) ||
      (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0),
  );
  if (receipt.ids.some((id, i) => id !== ordered[i]?.matchId))
    reasons.push("receipt_order_ambiguous");
  const competitive = ordered.filter((m) => m.isRemake !== true);
  if (competitive.some((m, i) => i > 0 && time(m.timestamp) === time(competitive[i - 1].timestamp)))
    reasons.push("receipt_order_ambiguous");
  return reasons;
}

/**
 * Pure server-internal simulation. Context must eventually come from a trusted materializer,
 * not request data. No context factory, service wiring, policy activation or write capability.
 */
export function simulateBadgeVerification(
  submitted: unknown,
  suppliedContext: unknown,
): VerificationDryRun {
  const request = submissionSchema.safeParse(submitted);
  const contextResult = contextSchema.safeParse(suppliedContext);
  if (!request.success || !contextResult.success)
    return { ...base, status: "invalid_input", reasons: ["invalid_structure"], observation: null };
  const submission = request.data;
  const context = contextResult.data;
  if (submission.evidence.state === "unavailable")
    return { ...base, status: "unavailable", reasons: [], observation: null };
  const reasons: VerificationBlockReason[] = [];
  const add = (reason: VerificationBlockReason) => reasons.push(reason);
  if (context.environment !== "local" && context.environment !== "staging_preview")
    add("environment_not_permitted");
  if (context.source !== "stored_riot") add("source_not_trusted");
  if (submission.policyVersion !== VERIFICATION_POLICIES[submission.code]) add("policy_unknown");
  if (
    context.policyAuthorization.state !== "simulation_only" ||
    context.policyAuthorization.version !== submission.policyVersion
  )
    add("policy_not_authorized");
  const expectedVersion =
    submission.code === "otp-specialist" ? OTP_RULE_VERSION : ACHIEVEMENT_RULE_VERSION;
  if (submission.evaluatorVersion !== expectedVersion) add("evaluator_version_mismatch");
  const parsed =
    submission.code === "resurrection"
      ? parseRankInput(submission.evidence.input)
      : parseMatchInput(submission.evidence.input);
  if (!parsed.ok) {
    add("observation_invalid");
    return {
      ...base,
      status: "blocked",
      code: submission.code,
      policyVersion: submission.policyVersion,
      evaluatedAt: context.evaluatedAt,
      dataCutoff: null,
      sourceRevision: context.sourceRevision,
      reasons: [...new Set(reasons)].sort(),
      limitations: ["invalid_observation_input"],
      observation: null,
    };
  }
  const input = parsed.value;
  // The observation engine deliberately projects known fields. Verification must not
  // silently accept extra provenance/interpolation flags or a different source shape.
  if (!sameEvidence(submission.evidence.input, input)) add("invalid_structure");
  const scope = input.scope;
  const bounds = scopeBounds(scope);
  if (
    context.identity.platform !== scope.platform ||
    context.identity.queue !== scopeQueue(scope) ||
    context.identity.season !== scope.season.id
  )
    add("scope_mismatch");
  if (time(scope.asOf) > time(context.evaluatedAt)) add("invalid_timing");
  const records = "snapshots" in input ? input.snapshots : input.matches;
  const recordIds: string[] = [];
  for (const record of records) {
    const id = "matchId" in record ? record.matchId : record.id;
    if (!id) add("missing_source_id");
    else recordIds.push(id);
    const queue =
      "queueId" in record
        ? record.queueId === scopeQueueId(scope)
        : record.queue === scopeQueue(scope);
    if (!queue || time(record.timestamp) < bounds.start || time(record.timestamp) >= bounds.end)
      add("scope_mismatch");
    if ("matchId" in record && !record.matchId.startsWith(`${scope.platform}_`))
      add("scope_mismatch");
  }
  if (context.provenance.state !== "known") add("provenance_missing");
  else {
    const p = context.provenance.value;
    if (!sameIdentity(p.identity, context.identity)) add("identity_mismatch");
    if (
      time(p.dataCutoff) !== time(scope.asOf) ||
      time(p.readAt) < time(scope.asOf) ||
      time(p.readAt) > time(context.evaluatedAt)
    )
      add("invalid_timing");
    if (!sameSet(p.recordIds, recordIds)) add("source_set_mismatch");
  }
  const observation =
    submission.code === "resurrection"
      ? evaluateResurrection(input)
      : submission.code === "unstoppable"
        ? evaluateUnstoppable(input)
        : evaluateOtpSpecialist(input);
  if (observation.status === "invalid_input") add("observation_invalid");
  else if (observation.status !== "observed") add("observation_not_positive");
  if (!sameEvidence(submission.evidence.presentedEvidence, observation.evidence))
    add("evidence_mismatch");
  const limitations = [
    "structural_checks_not_source_authentication",
    "no_transactional_revision_check",
  ];
  if (submission.code === "resurrection") {
    limitations.push("observed_snapshots_not_continuous_rank_path");
  } else {
    limitations.push("recoverable_records_not_absolute_riot_history");
    if (submission.reconciliation.state !== "known") add("receipt_missing");
    else if ("matches" in input && observation.evidence) {
      let required = { from: observation.evidence.from, to: observation.evidence.to };
      if (submission.code === "otp-specialist") {
        required = { from: scope.season.startAt, to: new Date(bounds.end - 1).toISOString() };
      }
      reasons.push(
        ...receiptReasons(submission.reconciliation.value, context, scope, input.matches, required),
      );
    }
    if (submission.code === "otp-specialist") {
      const closure = submission.seasonClosure;
      if (closure.state !== "known" || scope.season.endAt === null) add("season_not_closed");
      else if (
        closure.value.season !== scope.season.id ||
        closure.value.platform !== scope.platform ||
        time(closure.value.endAt) !== time(scope.season.endAt) ||
        time(scope.asOf) < time(closure.value.endAt) ||
        time(closure.value.confirmedAt) < time(closure.value.endAt) ||
        time(closure.value.confirmedAt) > time(context.evaluatedAt)
      )
        add("season_not_closed");
    }
  }
  return {
    ...base,
    status: reasons.length ? "blocked" : "requirements_satisfied",
    code: submission.code,
    policyVersion: submission.policyVersion,
    evaluatedAt: context.evaluatedAt,
    dataCutoff: scope.asOf,
    sourceRevision: context.sourceRevision,
    reasons: [...new Set(reasons)].sort(),
    limitations,
    observation,
  };
}
