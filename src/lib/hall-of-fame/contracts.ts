/** Design-only contracts. No writer, evaluator, API or persistence implementation. */
export type FutureAchievementScope = {
  platform: string;
  view: "soloq" | "flex";
  season: string;
  communityId: string;
};
export type FutureEvidenceReference = {
  receiptId: string;
  sha256: string;
  ruleVersion: string;
  coverage: "proven" | "unproven";
  observedFrom: string;
  observedTo: string;
};
export type FutureAccreditation = {
  grantId: string;
  idempotencyKey: string;
  playerPuuid: string;
  achievementId: string;
  ruleVersion: string;
  scope: FutureAchievementScope;
  observedObtainedAt: string | null;
  observedObtainedInterval: { from: string; to: string } | null;
  accreditedAt: string;
  activationId: string;
  evidence: readonly FutureEvidenceReference[];
  state: "valid" | "under_review" | "invalidated";
  supersedesGrantId: string | null;
};
export type FutureAccreditationReview = {
  reviewId: string;
  grantId: string;
  decision: "confirm" | "invalidate" | "correct";
  reason: string;
  decidedAt: string;
  reviewerId: string;
  replacementGrantId: string | null;
};
export type FutureRecordTenure = {
  recordId: string;
  metricVersion: string;
  scope: FutureAchievementScope;
  holderPuuid: string;
  value: number;
  unit: string;
  from: string;
  to: string | null;
  supportingGrantId: string | null;
  evidence: readonly FutureEvidenceReference[];
};
export type FuturePioneer = {
  scope: FutureAchievementScope;
  achievementId: string;
  activationId: string;
  firstValidGrantIds: readonly string[];
  tiePolicyVersion: string;
};
export type FutureRarity =
  | {
      status: "calculated";
      accreditedUniquePlayers: number;
      eligibleUniquePlayers: number;
      populationDefinition: string;
      cutoff: string;
      ruleVersion: string;
      scope: FutureAchievementScope;
    }
  | { status: "insufficient_evidence" | "unavailable" }
  | {
      status: "demo";
      label: "Ficticio · Demo";
      accreditedUniquePlayers: number;
      eligibleUniquePlayers: number;
      populationDefinition: string;
    };
