import type { RankedQueue, View } from "../queues";
import type { Platform } from "../routing";
import type { HistoryStatus } from "../season";

export type AchievementCode = "resurrection" | "unstoppable" | "otp-specialist";
export type AchievementRuleVersion = "1.1.A-observed-v1";
export type RankedAchievementView = Exclude<View, "5v5">;
/** Half-open season and observation bounds. asOf is supplied by the caller, never a clock read. */
export type AchievementScope = {
  view: RankedAchievementView;
  platform: Platform;
  season: { id: string; startAt: string; endAt: string | null };
  asOf: string;
};
export type AchievementCoverage = {
  source: "imported_history" | "profile_recent_window";
  historyStatus: HistoryStatus["status"] | "unknown";
  unavailable: number | null;
  /** Existing history metadata cannot establish an exhaustive interval. */
  intervalCoverage: "unproven";
};
export type AchievementSnapshot = {
  id?: string;
  queue: RankedQueue;
  timestamp: string;
  tier: string;
  division: string;
  leaguePoints: number;
  wins: number;
  losses: number;
};
export type AchievementMatch = {
  matchId: string;
  queueId: number;
  timestamp: string;
  win: boolean | null;
  isRemake: boolean | null;
  championId: number | null;
};
export type RankEvaluationInput = {
  scope: AchievementScope;
  snapshots: readonly AchievementSnapshot[];
};
export type MatchEvaluationInput = {
  scope: AchievementScope;
  matches: readonly AchievementMatch[];
  coverage: AchievementCoverage;
};
export type ResurrectionRule = {
  version: AchievementRuleVersion;
  minDropLp: number;
  maxRecoveryMs: number;
  maxGapMs: number;
};
export type UnstoppableRule = { version: AchievementRuleVersion; minWins: number };
export type OtpRule = {
  version: AchievementRuleVersion;
  minGames: number;
  minShare: { numerator: number; denominator: number };
};
export type AchievementReason =
  | "invalid_input"
  | "invalid_rule"
  | "invalid_scope"
  | "invalid_timestamp"
  | "invalid_rank"
  | "invalid_champion"
  | "unknown_queue"
  | "unsupported_view"
  | "conflicting_duplicate"
  | "duplicate_record"
  | "ambiguous_timestamp"
  | "queue_mismatch"
  | "outside_window"
  | "insufficient_sample"
  | "no_matching_event"
  | "unknown_remake"
  | "unknown_result"
  | "counter_reset"
  | "non_comparable_rank"
  | "unranked"
  | "snapshot_gap"
  | "incomplete_history"
  | "unavailable_matches"
  | "unproven_interval"
  | "limited_profile_window"
  | "provisional_rule"
  | "unobserved_rank_path";

type EvidenceBase = {
  ruleVersion: AchievementRuleVersion;
  queue: RankedQueue;
  season: string;
  from: string;
  to: string;
};
export type ResurrectionEvidence = EvidenceBase & {
  kind: "rank_recovery";
  rule: ResurrectionRule;
  before: AchievementSnapshot;
  minimum: AchievementSnapshot;
  recovered: AchievementSnapshot;
  dropLp: number;
  observationCount: number;
  /** Includes every intervening observation; no interpolated points or generated IDs. */
  observations: AchievementSnapshot[];
  limitation: "observed_endpoints_not_continuous_path";
};
export type UnstoppableEvidence = EvidenceBase & {
  kind: "recorded_win_streak";
  rule: UnstoppableRule;
  maxObservedWins: number;
  matchIds: string[];
  ignoredRemakeIds: string[];
  coverage: AchievementCoverage;
  limitation: "recorded_sequence_not_exhaustive_riot_history";
};
export type OtpEvidence = EvidenceBase & {
  kind: "recorded_champion_share";
  rule: OtpRule;
  championId: number;
  championGames: number;
  validGames: number;
  share: { numerator: number; denominator: number };
  coverage: AchievementCoverage;
  limitation: "imported_sample_not_season_certification";
};
export type AchievementEvidence = ResurrectionEvidence | UnstoppableEvidence | OtpEvidence;
type EvaluationBase = {
  code: AchievementCode;
  ruleVersion: AchievementRuleVersion;
  scope: AchievementScope | null;
  reasons: AchievementReason[];
  certification: "not_established";
  grantAuthorized: false;
};
export type AchievementEvaluationStatus =
  "observed" | "not_observed" | "insufficient_evidence" | "invalid_input";
/** Nonpositive evidence, when present, is a measurement of the examined records, not a grant. */
export type AchievementEvaluation<E extends AchievementEvidence = AchievementEvidence> =
  EvaluationBase &
    (
      | { status: "observed"; evidence: E }
      | { status: "not_observed" | "insufficient_evidence"; evidence: E | null }
      | { status: "invalid_input"; evidence: null }
    );
export type AchievementDefinition = {
  code: AchievementCode;
  ruleVersion: AchievementRuleVersion;
  name: string;
  description: string;
  category: "progression" | "performance" | "champion";
  views: readonly RankedAchievementView[];
  evidence: AchievementEvidence["kind"];
  availability: "observation_only";
  provisionalConditions: string;
};
