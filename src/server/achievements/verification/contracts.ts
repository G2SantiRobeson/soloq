import "server-only";
import type { AchievementCode, AchievementEvaluation, AchievementMatch } from "@/lib/achievements";
import type { Platform } from "@/lib/routing";
import type { RankedQueue } from "@/lib/queues";

/** Unknown and not applicable never imply a successful check. */
export type Knowledge<T> =
  { state: "known"; value: T } | { state: "unknown" } | { state: "not_applicable" };

export const VERIFICATION_POLICIES = Object.freeze({
  resurrection: "1.2.B.1-resurrection-draft-v1",
  unstoppable: "1.2.B.1-unstoppable-draft-v1",
  "otp-specialist": "1.2.B.1-otp-draft-v1",
} as const);
export type VerificationPolicyVersion = (typeof VERIFICATION_POLICIES)[AchievementCode];

export type VerificationIdentity = {
  playerId: string;
  platform: Platform;
  queue: RankedQueue;
  season: string;
};

/** Future materializer-owned attestation, not authentication performed by this pure module. */
export type VerificationContext = {
  environment: "local" | "staging_preview" | "production" | "unknown";
  identity: VerificationIdentity;
  evaluatedAt: string;
  source: "stored_riot" | "demo" | "client" | "unknown";
  provenance: Knowledge<{
    identity: VerificationIdentity;
    traceId: string;
    readAt: string;
    dataCutoff: string;
    /** Entire scoped source set, not the public DTO or the selected three snapshots. */
    recordIds: string[];
  }>;
  /** Contract only. No writer increments or validates a database revision in B.1. */
  sourceRevision: Knowledge<string>;
  policyAuthorization:
    { state: "not_authorized" } | { state: "simulation_only"; version: VerificationPolicyVersion };
};

export type ReconciliationReceipt = {
  version: "1.2.B.1-receipt-draft-v1";
  origin: "server_reconciliation";
  identity: VerificationIdentity;
  traceId: string;
  checkedAt: string;
  /** Half-open target interval; query may include a margin. */
  interval: { from: string; to: string };
  query: {
    from: string;
    to: string;
    precision: "seconds";
    bounds: "half_open";
    exhausted: Knowledge<true>;
  };
  /** Ordered recoverable ID manifest; never replaced by an aggregate count. */
  ids: string[];
  details: Array<
    | { state: "resolved"; record: AchievementMatch }
    | { state: "unavailable"; matchId: string; code: 404 }
    | { state: "unknown"; matchId: string }
  >;
  limitation: "recoverable_records_not_absolute_riot_history";
};

export type VerificationSubmission = {
  code: AchievementCode;
  evaluatorVersion: string;
  policyVersion: string;
  evidence:
    | { state: "available"; input: unknown; presentedEvidence: unknown }
    | { state: "unavailable"; reason: "infrastructure" | "invalid_data" | "unexpected" };
  reconciliation: Knowledge<ReconciliationReceipt>;
  seasonClosure: Knowledge<{
    season: string;
    platform: Platform;
    endAt: string;
    confirmedAt: string;
    basis: "approved_regional_calendar";
  }>;
};

export type VerificationBlockReason =
  | "invalid_structure"
  | "environment_not_permitted"
  | "source_not_trusted"
  | "provenance_missing"
  | "identity_mismatch"
  | "scope_mismatch"
  | "invalid_timing"
  | "source_set_mismatch"
  | "missing_source_id"
  | "policy_unknown"
  | "policy_not_authorized"
  | "evaluator_version_mismatch"
  | "observation_not_positive"
  | "observation_invalid"
  | "evidence_mismatch"
  | "receipt_missing"
  | "receipt_scope_mismatch"
  | "receipt_incomplete"
  | "receipt_unknown_detail"
  | "receipt_unavailable_detail"
  | "receipt_mismatch"
  | "receipt_order_ambiguous"
  | "season_not_closed";

type ResultBase = {
  mode: "internal_dry_run";
  certification: "not_established";
  grantAuthorized: false;
  writes: "none";
  provenanceAuthentication: "not_performed";
};
export type VerificationDryRun = ResultBase &
  (
    | { status: "invalid_input"; reasons: ["invalid_structure"]; observation: null }
    | { status: "unavailable"; reasons: []; observation: null }
    | {
        /** Conditional on trusted server context; never a certification or grant. */
        status: "requirements_satisfied" | "blocked";
        code: AchievementCode;
        policyVersion: string;
        evaluatedAt: string;
        dataCutoff: string | null;
        sourceRevision: Knowledge<string>;
        reasons: VerificationBlockReason[];
        limitations: string[];
        observation: AchievementEvaluation | null;
      }
  );
