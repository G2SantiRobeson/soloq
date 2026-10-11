import "server-only";
import type {
  AchievementCode,
  AchievementCoverage,
  AchievementEvaluation,
  AchievementMatch,
  AchievementRuleVersion,
  AchievementScope,
  AchievementSnapshot,
} from "@/lib/achievements";
import type { VerificationIdentity } from "./contracts";

export const EVIDENCE_FORMAT_VERSION = "1.2.B.2.B-evidence-v1";
export const CANONICALIZATION_VERSION = "1.2.B.2.B-canonical-json-v1";

/** An internal attribution is a declaration, not proof of receipt from Riot. */
export type SourceAttribution =
  | { state: "known"; origin: "synthetic" | "stored" | "riot" }
  | { state: "unknown" }
  | { state: "unproven"; claim: "stored" | "riot" };

export type SourceCapture =
  | {
      state: "legacy";
      source: "stored" | "unknown";
      endpoint: "unknown";
      captureId: null;
      receivedAt: null;
    }
  | {
      state: "declared";
      source: "synthetic" | "stored" | "riot" | "unknown";
      endpoint: "LEAGUE-V4" | "MATCH-V5" | "unknown";
      captureId: string | null;
      receivedAt: string | null;
    };

export type DeclaredSourceRevision = { state: "unknown" } | { state: "declared"; value: string };
export type SourceManifest = { state: "unknown" } | { state: "declared"; recordIds: string[] };
export type EvidenceSource<T> = {
  identity: VerificationIdentity;
  capture: SourceCapture;
  record: T;
};
export type IdentifiedSnapshot = AchievementSnapshot & { id: string };

type InputBase = {
  version: typeof EVIDENCE_FORMAT_VERSION;
  identity: VerificationIdentity;
  scope: AchievementScope;
  attribution: SourceAttribution;
  sourceRevision: DeclaredSourceRevision;
  manifest: SourceManifest;
  coverage: AchievementCoverage;
};
export type EvidenceMaterializationInput = InputBase &
  (
    | {
        kind: "ranked";
        code: "resurrection";
        records: EvidenceSource<IdentifiedSnapshot>[];
      }
    | {
        kind: "matches";
        code: "unstoppable" | "otp-specialist";
        records: EvidenceSource<AchievementMatch>[];
      }
  );

export type MaterializationReason =
  | "invalid_structure"
  | "invalid_timestamp"
  | "identity_mismatch"
  | "scope_mismatch"
  | "queue_mismatch"
  | "platform_mismatch"
  | "capture_endpoint_mismatch"
  | "outside_window"
  | "conflicting_duplicate"
  | "manifest_unknown"
  | "manifest_mismatch"
  | "unknown_match_fields"
  | "ambiguous_timestamp"
  | "history_not_completed"
  | "unavailable_details"
  | "limited_source_window"
  | "operational_authentication_not_performed"
  | "interval_coverage_unproven"
  | "source_revision_not_verified"
  | "legacy_provenance_unproven"
  | "reconciliation_not_materialized"
  | "season_closure_not_established";

/** Entire supplied set. This is internal personal evidence, never a public DTO. */
export type MaterializedContent = {
  formatVersion: typeof EVIDENCE_FORMAT_VERSION;
  canonicalizationVersion: typeof CANONICALIZATION_VERSION;
  identity: VerificationIdentity;
  scope: AchievementScope;
  code: AchievementCode;
  ruleVersion: AchievementRuleVersion;
  manifest: SourceManifest;
  coverage: AchievementCoverage;
  sources:
    | { kind: "ranked"; records: IdentifiedSnapshot[] }
    | { kind: "matches"; records: AchievementMatch[] };
};

export type MaterializedCaptureMetadata = {
  formatVersion: typeof EVIDENCE_FORMAT_VERSION;
  canonicalizationVersion: typeof CANONICALIZATION_VERSION;
  /** Binds metadata to content, without hashing either hash into itself. */
  contentFingerprint: string;
  attribution: SourceAttribution;
  sourceRevision: DeclaredSourceRevision;
  originalScope: AchievementScope;
  records: Array<{
    recordId: string;
    originalTimestamps: string[];
    captures: SourceCapture[];
  }>;
};

export type MatchSetSummary = {
  /** Same valid denominator as the active OTP evaluator; not the season total. */
  validGames: number;
  championCounts: Array<{ championId: number; games: number }>;
  validMatchIds: string[];
  exclusions: Array<{ matchId: string; reason: "confirmed_remake" }>;
  unresolved: Array<{
    matchId: string;
    fields: Array<"win" | "isRemake" | "championId">;
  }>;
};

type ResultBase = {
  mode: "pure_materialization";
  certification: "not_established";
  grantAuthorized: false;
  writes: "none";
  provenanceAuthentication: "not_performed";
  revisionValidation: "not_performed";
  intervalCoverage: "unproven";
  reconciliation: { state: "unknown" };
  seasonClosure: { state: "unknown" };
};
export type EvidenceMaterializationResult = ResultBase &
  (
    | {
        status: "invalid_input" | "contradictory";
        reasons: MaterializationReason[];
        content: null;
        contentFingerprint: null;
        metadata: null;
        metadataFingerprint: null;
        observation: null;
        matchSummary: null;
      }
    | {
        /** Complete only relative to a supplied manifest, never authenticated coverage. */
        status: "materialized" | "incomplete";
        reasons: MaterializationReason[];
        content: MaterializedContent;
        contentFingerprint: string;
        metadata: MaterializedCaptureMetadata;
        metadataFingerprint: string;
        observation: AchievementEvaluation;
        matchSummary: MatchSetSummary | null;
      }
  );
