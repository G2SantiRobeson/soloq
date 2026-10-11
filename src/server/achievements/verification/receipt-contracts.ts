import "server-only";
import type { AchievementEvaluation } from "@/lib/achievements";
import type { Platform } from "@/lib/routing";
import type { VerificationIdentity } from "./contracts";
import type {
  DeclaredSourceRevision,
  EvidenceMaterializationInput,
  MaterializedContent,
  MaterializedCaptureMetadata,
  MatchSetSummary,
  SourceCapture,
} from "./materialization-contracts";

export const STRUCTURAL_RECEIPT_VERSION = "1.2.B.2.C-structural-receipt-v1";
export const RECEIPT_CANONICALIZATION_VERSION = "1.2.B.2.C-canonical-json-v1";

export type ReceiptInterval = {
  from: string;
  to: string;
  precision: "milliseconds";
  bounds: "half_open";
};
export type ReceiptTarget =
  | { kind: "win_streak"; interval: ReceiptInterval; chosenWinIds: string[] }
  | {
      kind: "otp_history";
      interval: ReceiptInterval;
      calendar:
        | { state: "unknown" }
        | { state: "declared"; platform: Platform; season: string; startAt: string; endAt: string };
    };

/** Effective parameters supplied by the caller, not requests performed here. */
export type DeclaredMatchQuery = {
  startTime: number;
  endTime: number;
  start: number;
  count: number;
  queue: number | null;
  type: "ranked" | "normal" | "tourney" | "tutorial" | null;
  timeSemantics: "unconfirmed";
};
export type DeclaredPage = {
  scanId: string;
  /** Increasing explicit retry number for this offset, not an inferred time. */
  attempt: number;
  identity: VerificationIdentity;
  query: DeclaredMatchQuery;
  capture: SourceCapture;
  response:
    | { state: "success"; ids: string[] }
    | { state: "partial"; ids: string[] }
    | { state: "failed"; reason: "network" | "http_429" | "http_5xx" | "invalid_response" };
};
export type PageSubmission = { page: DeclaredPage; expectedFingerprint: string | null };

/** Minimal declared detail. Nulls never become defaults or facts about Riot. */
export type ReceiptMatchDetail = {
  matchId: string;
  playerId: string | null;
  platform: Platform | null;
  queueId: number | null;
  timestamp: string | null;
  win: boolean | null;
  isRemake: boolean | null;
  championId: number | null;
};
type DetailDisposition = { matchId: string; detail: ReceiptMatchDetail; capture: SourceCapture };
export type IdDisposition =
  | (DetailDisposition & { state: "resolved" })
  | { state: "reused_without_attestation"; matchId: string; detail: ReceiptMatchDetail | null }
  | (DetailDisposition & {
      state: "reused_with_matching_attestation_declared";
      attestation: {
        state: "declared";
        identity: VerificationIdentity;
        sourceRevision: DeclaredSourceRevision;
        contentFingerprint: string;
        metadataFingerprint: string;
      };
    })
  | (DetailDisposition & {
      state: "excluded_with_basis";
      basis: "other_queue" | "outside_target_interval" | "confirmed_remake";
    })
  | { state: "unavailable_404"; matchId: string }
  | { state: "pending"; matchId: string }
  | { state: "invalid"; matchId: string; reason: "schema" | "identity" | "scope" | "conflict" }
  | { state: "unknown"; matchId: string };

export type StructuralReceiptInput = {
  version: typeof STRUCTURAL_RECEIPT_VERSION;
  nature: "synthetic" | "declared";
  identity: VerificationIdentity;
  target: ReceiptTarget;
  scanId: string;
  query: DeclaredMatchQuery;
  pages: PageSubmission[];
  dispositions: IdDisposition[];
  sourceRevision: DeclaredSourceRevision;
  indexChange:
    | { state: "unproven" }
    | { state: "reported"; reason: "late_ids" | "offset_shift"; ids: string[] };
  materialization: {
    input: EvidenceMaterializationInput;
    expectedContentFingerprint: string;
    expectedMetadataFingerprint: string;
  };
};

export type ReceiptReason =
  | "invalid_structure"
  | "invalid_interval"
  | "identity_mismatch"
  | "scope_mismatch"
  | "query_mismatch"
  | "query_margin_insufficient"
  | "scan_mismatch"
  | "page_missing"
  | "terminal_missing"
  | "page_after_terminal"
  | "page_partial"
  | "page_failed"
  | "conflicting_page"
  | "capture_conflict"
  | "page_fingerprint_mismatch"
  | "repeated_page_ids"
  | "index_change_reported"
  | "disposition_missing"
  | "disposition_extra"
  | "conflicting_disposition"
  | "detail_id_mismatch"
  | "detail_identity_mismatch"
  | "unknown_detail_scope"
  | "unknown_match_fields"
  | "detail_outside_query"
  | "exclusion_basis_mismatch"
  | "exclusion_required"
  | "detail_unavailable_404"
  | "detail_pending"
  | "detail_invalid"
  | "detail_unknown"
  | "reuse_unattested"
  | "attestation_mismatch"
  | "legacy_unattested"
  | "materialization_invalid"
  | "materialization_incomplete"
  | "materialization_mismatch"
  | "source_concordance_pending"
  | "fingerprint_mismatch"
  | "revision_mismatch"
  | "ambiguous_timestamp"
  | "chosen_streak_not_supported"
  | "season_open"
  | "calendar_missing"
  | "calendar_mismatch";

export type StructuralReceiptContent = {
  version: typeof STRUCTURAL_RECEIPT_VERSION;
  canonicalizationVersion: typeof RECEIPT_CANONICALIZATION_VERSION;
  nature: "synthetic" | "declared";
  identity: VerificationIdentity;
  target: ReceiptTarget;
  scanId: string;
  query: DeclaredMatchQuery;
  sourceRevision: DeclaredSourceRevision;
  indexChange: StructuralReceiptInput["indexChange"];
  /** Every original declaration, including retries/duplicates; ID array order retained. */
  pages: Array<{ page: DeclaredPage; fingerprint: string; expectedFingerprint: string | null }>;
  dispositions: IdDisposition[];
  discoveredIds: string[];
  effectiveOffsets: number[];
  terminalOffset: number | null;
  counts: {
    discovered: number;
    disposed: number;
    known: number;
    unresolved: number;
    rankedInTarget: number;
  };
  materialization: { content: MaterializedContent; metadata: MaterializedCaptureMetadata };
  observation: AchievementEvaluation;
  matchSummary: MatchSetSummary;
  reasons: ReceiptReason[];
};

export type StructuralReceiptResult = {
  version: typeof STRUCTURAL_RECEIPT_VERSION;
  canonicalizationVersion: typeof RECEIPT_CANONICALIZATION_VERSION;
  identity: VerificationIdentity | null;
  target: ReceiptTarget | null;
  counts: StructuralReceiptContent["counts"] | null;
  mode: "pure_structural_receipt";
  certification: "not_established";
  grantAuthorized: false;
  writes: "none";
  provenanceAuthentication: "not_performed";
  revisionValidation: "not_performed";
  indexStability: "unproven";
  recoverableCoverage: "not_established";
  seasonClosure: "not_established";
  uncheckedRequirements: readonly string[];
} & (
  | {
      status: "invalid_input" | "blocked" | "contradictory";
      reasons: ReceiptReason[];
      content: null;
      fingerprint: null;
    }
  | {
      status: "collecting" | "structurally_complete" | "blocked" | "contradictory";
      reasons: ReceiptReason[];
      content: StructuralReceiptContent;
      /** Integrity of declarations, never a signature; null when contradictory. */
      fingerprint: string | null;
    }
);
