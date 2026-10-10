import { ACHIEVEMENT_RULE_VERSION } from "./catalog";
import type {
  AchievementCode,
  AchievementEvaluation,
  AchievementEvaluationStatus,
  AchievementEvidence,
  AchievementReason,
  AchievementScope,
} from "./types";

export function normalizeReasons(reasons: readonly AchievementReason[]): AchievementReason[] {
  return [...new Set(reasons)].sort();
}
export function evaluation<E extends AchievementEvidence>(
  code: AchievementCode,
  scope: AchievementScope | null,
  status: AchievementEvaluationStatus,
  reasons: readonly AchievementReason[],
  evidence: E | null = null,
): AchievementEvaluation<E> {
  const base = {
    code,
    ruleVersion: ACHIEVEMENT_RULE_VERSION,
    scope,
    reasons: normalizeReasons(["provisional_rule", ...reasons]),
    certification: "not_established" as const,
    grantAuthorized: false as const,
  };
  if (status === "observed" && evidence) return { ...base, status, evidence };
  if (status === "invalid_input" || status === "observed")
    return { ...base, status: "invalid_input", evidence: null };
  return { ...base, status, evidence };
}
