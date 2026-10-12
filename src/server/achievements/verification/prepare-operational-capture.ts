import "server-only";
import {
  CapturePreparationError,
  operationalCaptureInputSchema,
  evidenceScanSchema,
  PREPARATION_LIMITATIONS,
  type CapturePreparationInput,
} from "./operational-capture-contracts";

export type CaptureIssue =
  | "declared_only"
  | "synthetic_only"
  | "receipt_time_unknown"
  | "validation_time_unknown"
  | "capture_id_unknown"
  | "reception_id_unknown"
  | "legacy_source"
  | "existing_source_unproven"
  | "conflicting_source"
  | "request_unresolved"
  | "partial_response"
  | "identity_mismatch"
  | "identity_unknown"
  | "ambiguous_participant"
  | "participant_missing"
  | "match_id_mismatch"
  | "scope_unknown"
  | "platform_mismatch"
  | "other_queue"
  | "other_mode_map"
  | "outside_target_interval"
  | "confirmed_remake_marker"
  | "remake_basis_unknown"
  | "competitive_fields_unknown"
  | "league_entry_absent"
  | "duplicate_queue_type"
  | "ids_repeated"
  | "index_changed"
  | "query_scope_mismatch"
  | "query_does_not_cover_target";

/** Pure preparation, not a trusted operational producer. All times/IDs come from the caller. */
export function prepareOperationalCapture(input: unknown) {
  const parsed = operationalCaptureInputSchema.safeParse(input);
  if (!parsed.success) throw new CapturePreparationError("invalid_capture");
  const data = parsed.data;
  const issues = new Set<CaptureIssue>([
    data.capture.trust === "synthetic" ? "synthetic_only" : "declared_only",
  ]);
  if (!data.capture.receivedAt) issues.add("receipt_time_unknown");
  if (!data.capture.validatedAt) issues.add("validation_time_unknown");
  if (!data.capture.captureId) issues.add("capture_id_unknown");
  if (!data.capture.receptionId) issues.add("reception_id_unknown");
  if (data.source.state === "legacy") issues.add("legacy_source");
  if (data.source.state === "existing_declared") {
    issues.add("existing_source_unproven");
    if (data.source.concordance === "conflicting") issues.add("conflicting_source");
    if (data.source.owner.playerId !== data.owner.playerId) issues.add("identity_mismatch");
    if (
      data.source.owner.platform !== data.owner.platform ||
      data.source.owner.queue !== data.owner.queue ||
      data.source.owner.season !== data.owner.season
    )
      issues.add("query_scope_mismatch");
  }
  if (data.response.state !== "http_success") issues.add("request_unresolved");
  else if (data.response.completeness === "partial") issues.add("partial_response");
  let pageShape: "full" | "short" | "empty" | "partial" | "unknown" = "unknown";
  let entryPresent: boolean | null = null;
  if (data.endpoint === "ACCOUNT-V1" && data.binding) checkBinding(data.binding, data, issues);
  if (data.endpoint === "LEAGUE-V4" && data.entries) {
    const entries = data.entries.filter((e) => e.queue === data.owner.queue);
    entryPresent = entries.length > 0;
    if (!entries.length) issues.add("league_entry_absent");
    if (new Set(data.entries.map((e) => e.queue)).size !== data.entries.length)
      issues.add("duplicate_queue_type");
  }
  if (data.endpoint === "MATCH-V5-IDS") {
    const queue = queueId(data.owner.queue);
    if (
      (data.query.queue !== null && data.query.queue !== queue) ||
      (data.query.type !== null && data.query.type !== "ranked")
    )
      issues.add("query_scope_mismatch");
    if (
      data.query.startTime * 1000 > Date.parse(data.interval.from) ||
      data.query.endTime * 1000 < Date.parse(data.interval.to)
    )
      issues.add("query_does_not_cover_target");
    if (data.indexChange === "observed_change") issues.add("index_changed");
    if (data.ids) {
      if (data.ids.some((id) => !id.startsWith(`${data.owner.platform}_`)))
        issues.add("platform_mismatch");
      if (new Set(data.ids).size !== data.ids.length) issues.add("ids_repeated");
      pageShape =
        data.response.state === "http_success" && data.response.completeness === "complete"
          ? data.ids.length === 0
            ? "empty"
            : data.ids.length === data.query.count
              ? "full"
              : "short"
          : "partial";
    }
  }
  if (data.endpoint === "MATCH-V5-DETAIL") {
    if (!data.requestedMatchId.startsWith(`${data.owner.platform}_`))
      issues.add("platform_mismatch");
    if (data.detail) {
      const d = data.detail;
      if (d.matchId !== data.requestedMatchId) issues.add("match_id_mismatch");
      checkBinding(d.participant.binding, data, issues);
      if (d.participant.matchingCount === 0) issues.add("participant_missing");
      if (d.participant.matchingCount > 1) issues.add("ambiguous_participant");
      if (d.queueId === null || d.mapId === null || d.gameMode === null || d.timestampMs === null)
        issues.add("scope_unknown");
      if (d.queueId !== null && d.queueId !== queueId(data.owner.queue)) issues.add("other_queue");
      if ((d.mapId !== null && d.mapId !== 11) || (d.gameMode !== null && d.gameMode !== "CLASSIC"))
        issues.add("other_mode_map");
      if (
        d.timestampMs !== null &&
        (d.timestampMs < Date.parse(data.interval.from) ||
          d.timestampMs >= Date.parse(data.interval.to))
      )
        issues.add("outside_target_interval");
      if (d.remake.truePresent > 0) issues.add("confirmed_remake_marker");
      // Absent markers and a stored false must not be elevated to proof of non-remake.
      issues.add("remake_basis_unknown");
      if (d.win === null || d.championId === null) issues.add("competitive_fields_unknown");
    }
  }
  return {
    mode: "capture_preparation" as const,
    ...PREPARATION_LIMITATIONS,
    data,
    issues: [...issues].sort(),
    pageShape,
    entryPresent,
    // A short page is an observation of this supplied response, not closure of a scan.
    scanComplete: false as const,
  };
}
function queueId(queue: CapturePreparationInput["owner"]["queue"]) {
  return queue === "RANKED_SOLO_5x5" ? 420 : 440;
}
function checkBinding(
  binding: {
    state: "matching_declared" | "mismatching_declared" | "unknown";
    playerId: string | null;
    platform: string | null;
  },
  data: CapturePreparationInput,
  issues: Set<CaptureIssue>,
) {
  if (binding.state === "unknown" || !binding.playerId || !binding.platform)
    issues.add("identity_unknown");
  if (
    binding.state === "mismatching_declared" ||
    (binding.playerId !== null && binding.playerId !== data.owner.playerId) ||
    (binding.platform !== null && binding.platform !== data.owner.platform)
  )
    issues.add("identity_mismatch");
}

/** Validates a supplied lifecycle without creating a cursor, receipt, seal or operational run. */
export function prepareEvidenceScan(input: unknown) {
  const parsed = evidenceScanSchema.safeParse(input);
  if (!parsed.success) throw new CapturePreparationError("invalid_capture");
  return {
    mode: "scan_preparation" as const,
    ...PREPARATION_LIMITATIONS,
    data: parsed.data,
    coverage: "unproven" as const,
  };
}
