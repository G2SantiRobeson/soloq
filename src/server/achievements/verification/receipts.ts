import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PLATFORMS } from "@/lib/routing";
import { RANKED_QUEUES } from "@/lib/queues";
import { scopeQueueId, scopeBounds, compareId } from "@/lib/achievements/validation";
import type { AchievementMatch } from "@/lib/achievements";
import { materializeAchievementEvidence } from "./materialize";
import {
  EVIDENCE_FORMAT_VERSION,
  type EvidenceMaterializationInput,
  type MaterializedContent,
  type SourceCapture,
} from "./materialization-contracts";
import {
  STRUCTURAL_RECEIPT_VERSION,
  RECEIPT_CANONICALIZATION_VERSION,
  type DeclaredPage,
  type IdDisposition,
  type StructuralReceiptResult,
  type StructuralReceiptContent,
  type ReceiptReason,
  type ReceiptTarget,
  type ReceiptMatchDetail,
} from "./receipt-contracts";
import type { VerificationIdentity } from "./contracts";

const id = z
  .string()
  .min(1)
  .max(256)
  .refine((v) => v.trim() === v);
const instant = z.iso
  .datetime({ offset: true })
  .refine((v) => Number.isFinite(Date.parse(v)) && (/\.(\d+)/.exec(v)?.[1].length ?? 0) <= 3);
const integer = z.number().int().refine(Number.isSafeInteger);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.strictObject({
  playerId: z.uuid(),
  platform: z.enum(PLATFORMS),
  queue: z.enum(RANKED_QUEUES),
  season: id,
});
const revision = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unknown") }),
  z.strictObject({ state: z.literal("declared"), value: id }),
]);
const capture = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("legacy"),
    source: z.enum(["stored", "unknown"]),
    endpoint: z.literal("unknown"),
    captureId: z.null(),
    receivedAt: z.null(),
  }),
  z.strictObject({
    state: z.literal("declared"),
    source: z.enum(["synthetic", "stored", "riot", "unknown"]),
    endpoint: z.enum(["MATCH-V5", "unknown"]),
    captureId: id.nullable(),
    receivedAt: instant.nullable(),
  }),
]);
const query = z.strictObject({
  startTime: integer.nonnegative().refine((s) => Number.isSafeInteger(s * 1000)),
  endTime: integer.nonnegative().refine((s) => Number.isSafeInteger(s * 1000)),
  start: integer.nonnegative(),
  count: integer.min(1).max(100),
  queue: integer.positive().nullable(),
  type: z.enum(["ranked", "normal", "tourney", "tutorial"]).nullable(),
  timeSemantics: z.literal("unconfirmed"),
});
const pageSchema = z.strictObject({
  scanId: id,
  attempt: integer.positive(),
  identity,
  query,
  capture,
  response: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("success"), ids: z.array(id) }),
    z.strictObject({ state: z.literal("partial"), ids: z.array(id) }),
    z.strictObject({
      state: z.literal("failed"),
      reason: z.enum(["network", "http_429", "http_5xx", "invalid_response"]),
    }),
  ]),
});
const detail = z.strictObject({
  matchId: id,
  playerId: z.uuid().nullable(),
  platform: z.enum(PLATFORMS).nullable(),
  queueId: integer.positive().nullable(),
  timestamp: instant.nullable(),
  win: z.boolean().nullable(),
  isRemake: z.boolean().nullable(),
  championId: integer.positive().nullable(),
});
const detailFields = { matchId: id, detail, capture };
const disposition = z.discriminatedUnion("state", [
  z.strictObject({ ...detailFields, state: z.literal("resolved") }),
  z.strictObject({
    state: z.literal("reused_without_attestation"),
    matchId: id,
    detail: detail.nullable(),
  }),
  z.strictObject({
    ...detailFields,
    state: z.literal("reused_with_matching_attestation_declared"),
    attestation: z.strictObject({
      state: z.literal("declared"),
      identity,
      sourceRevision: revision,
      contentFingerprint: fingerprint,
      metadataFingerprint: fingerprint,
    }),
  }),
  z.strictObject({
    ...detailFields,
    state: z.literal("excluded_with_basis"),
    basis: z.enum(["other_queue", "outside_target_interval", "confirmed_remake"]),
  }),
  z.strictObject({ state: z.literal("unavailable_404"), matchId: id }),
  z.strictObject({ state: z.literal("pending"), matchId: id }),
  z.strictObject({
    state: z.literal("invalid"),
    matchId: id,
    reason: z.enum(["schema", "identity", "scope", "conflict"]),
  }),
  z.strictObject({ state: z.literal("unknown"), matchId: id }),
]);
const interval = z.strictObject({
  from: instant,
  to: instant,
  precision: z.literal("milliseconds"),
  bounds: z.literal("half_open"),
});
const inputSchema = z.strictObject({
  version: z.literal(STRUCTURAL_RECEIPT_VERSION),
  nature: z.enum(["synthetic", "declared"]),
  identity,
  target: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("win_streak"),
      interval,
      chosenWinIds: z.array(id).length(5),
    }),
    z.strictObject({
      kind: z.literal("otp_history"),
      interval,
      calendar: z.discriminatedUnion("state", [
        z.strictObject({ state: z.literal("unknown") }),
        z.strictObject({
          state: z.literal("declared"),
          platform: z.enum(PLATFORMS),
          season: id,
          startAt: instant,
          endAt: instant,
        }),
      ]),
    }),
  ]),
  scanId: id,
  query,
  pages: z.array(z.strictObject({ page: pageSchema, expectedFingerprint: fingerprint.nullable() })),
  dispositions: z.array(disposition),
  sourceRevision: revision,
  indexChange: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unproven") }),
    z.strictObject({
      state: z.literal("reported"),
      reason: z.enum(["late_ids", "offset_shift"]),
      ids: z.array(id),
    }),
  ]),
  materialization: z.strictObject({
    input: z.unknown(),
    expectedContentFingerprint: fingerprint,
    expectedMetadataFingerprint: fingerprint,
  }),
});

const base = {
  version: STRUCTURAL_RECEIPT_VERSION,
  canonicalizationVersion: RECEIPT_CANONICALIZATION_VERSION,
  identity: null,
  target: null,
  counts: null,
  mode: "pure_structural_receipt",
  certification: "not_established",
  grantAuthorized: false,
  writes: "none",
  provenanceAuthentication: "not_performed",
  revisionValidation: "not_performed",
  indexStability: "unproven",
  recoverableCoverage: "not_established",
  seasonClosure: "not_established",
  uncheckedRequirements: Object.freeze([
    "operational_origin",
    "stable_provider_index",
    "authorized_recoverable_coverage",
    "transactional_source_revision",
    "authenticated_regional_calendar",
    "grant_authorization",
  ] as const),
} as const;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
// Own receipt version. B.2.B's byte format and private serializer are not changed.
function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort(compareId)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const utc = (v: string) => new Date(v).toISOString();
function normalizeCapture(value: SourceCapture): SourceCapture {
  return value.receivedAt === null ? value : { ...value, receivedAt: utc(value.receivedAt) };
}
function normalizePage(page: DeclaredPage): DeclaredPage {
  return { ...page, capture: normalizeCapture(page.capture) };
}
function hash(value: Json) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}
function pageHash(page: DeclaredPage) {
  return hash({
    version: STRUCTURAL_RECEIPT_VERSION,
    canonicalizationVersion: RECEIPT_CANONICALIZATION_VERSION,
    page,
  });
}
/** Integrity helper for controlled page declarations; never issues an attestation. */
export function fingerprintDeclaredPage(input: unknown): string | null {
  const parsed = pageSchema.safeParse(input);
  return parsed.success ? pageHash(normalizePage(parsed.data)) : null;
}
const same = (a: Json, b: Json) => canonical(a) === canonical(b);
const reasonsOrdered = (reasons: ReceiptReason[]) => [...new Set(reasons)].sort(compareId);
function noContent(
  status: "invalid_input" | "blocked" | "contradictory",
  reasons: ReceiptReason[],
  identity: VerificationIdentity | null = null,
  target: ReceiptTarget | null = null,
): StructuralReceiptResult {
  return {
    ...base,
    identity,
    target: target === null ? null : normalizedTarget(target),
    status,
    reasons: reasonsOrdered(reasons),
    content: null,
    fingerprint: null,
  };
}
function normalizedTarget(target: ReceiptTarget): ReceiptTarget {
  const interval = {
    ...target.interval,
    from: utc(target.interval.from),
    to: utc(target.interval.to),
  };
  return target.kind === "win_streak"
    ? { ...target, interval }
    : {
        ...target,
        interval,
        calendar:
          target.calendar.state === "unknown"
            ? target.calendar
            : {
                ...target.calendar,
                startAt: utc(target.calendar.startAt),
                endAt: utc(target.calendar.endAt),
              },
      };
}
function normalizedDisposition(d: IdDisposition): IdDisposition {
  if (!("detail" in d) || d.detail === null) return d;
  const normalized = {
    ...d.detail,
    timestamp: d.detail.timestamp === null ? null : utc(d.detail.timestamp),
  };
  return {
    ...d,
    detail: normalized,
    ...("capture" in d ? { capture: normalizeCapture(d.capture) } : {}),
  };
}
/** Capture identity binds the declared detail, not a later reuse/exclusion decision. */
function detailCaptureBinding(detail: ReceiptMatchDetail, capture: SourceCapture): Json {
  return {
    kind: "match_detail",
    playerId: detail.playerId,
    platform: detail.platform,
    record: {
      matchId: detail.matchId,
      queueId: detail.queueId,
      timestamp: detail.timestamp,
      win: detail.win,
      isRemake: detail.isRemake,
      championId: detail.championId,
    },
    capture,
  };
}

type ParsedReceipt = z.infer<typeof inputSchema>;
type Report = (reason: ReceiptReason, conflict?: boolean) => void;
type CaptureInspector = (capture: SourceCapture, declaration: Json) => void;
function inspectPages(value: ParsedReceipt, block: Report) {
  const pages = value.pages
    .map((entry) => {
      const page = normalizePage(entry.page);
      const computed = pageHash(page);
      if (entry.expectedFingerprint !== null && entry.expectedFingerprint !== computed)
        block("page_fingerprint_mismatch", true);
      return { page, fingerprint: computed, expectedFingerprint: entry.expectedFingerprint };
    })
    .sort(
      (a, b) =>
        a.page.query.start - b.page.query.start ||
        a.page.attempt - b.page.attempt ||
        compareId(canonical(a), canonical(b)),
    );
  const captures = new Map<string, string>();
  const inspectCapture = (capture: SourceCapture, declaration: Json) => {
    if (capture.state === "legacy") block("legacy_unattested");
    if (capture.captureId === null) return;
    const content = canonical(declaration),
      previous = captures.get(capture.captureId);
    if (previous !== undefined && previous !== content) block("capture_conflict", true);
    captures.set(capture.captureId, content);
  };
  const offsets = new Map<number, DeclaredPage[]>();
  const allIds = new Set<string>();
  for (const { page } of pages) {
    inspectCapture(page.capture, page);
    if (page.scanId !== value.scanId) block("scan_mismatch", true);
    if (!same(page.identity, value.identity)) block("identity_mismatch", true);
    if (!same({ ...page.query, start: value.query.start }, value.query))
      block("query_mismatch", true);
    if (page.response.state !== "failed") {
      if (page.response.ids.length > page.query.count) block("query_mismatch", true);
      page.response.ids.forEach((matchId) => {
        allIds.add(matchId);
        if (
          !matchId.startsWith(`${value.identity.platform}_`) ||
          !/^\d+$/.test(matchId.slice(value.identity.platform.length + 1))
        )
          block("scope_mismatch", true);
      });
    }
    const group = offsets.get(page.query.start) ?? [];
    group.push(page);
    offsets.set(page.query.start, group);
  }
  const effective = [...offsets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, group]) => {
      const successes = group.filter((page) => page.response.state === "success");
      if (successes.some((page) => !same(page.response, successes[0].response)))
        block("conflicting_page", true);
      for (let i = 1; i < group.length; i++)
        if (group[i].attempt === group[i - 1].attempt && !same(group[i], group[i - 1]))
          block("conflicting_page", true);
      return group.at(-1)!;
    });
  let expectedOffset = 0,
    terminalOffset: number | null = null;
  const seenPageIds = new Set<string>();
  if (!effective.length) block("page_missing");
  for (const page of effective) {
    if (terminalOffset !== null) block("page_after_terminal");
    if (page.query.start !== expectedOffset) block("page_missing");
    if (page.response.state === "failed") {
      block("page_failed");
      continue;
    }
    if (page.response.state === "partial") block("page_partial");
    for (const matchId of page.response.ids) {
      if (seenPageIds.has(matchId)) block("repeated_page_ids");
      seenPageIds.add(matchId);
    }
    if (page.response.state === "success" && page.response.ids.length < page.query.count)
      terminalOffset = page.query.start;
    expectedOffset = page.query.start + page.query.count;
    if (!Number.isSafeInteger(expectedOffset)) block("query_mismatch", true);
  }
  if (terminalOffset === null) block("terminal_missing");

  return { pages, allIds, effective, terminalOffset, inspectCapture };
}
function inspectDispositions(
  value: ParsedReceipt,
  material: {
    content: MaterializedContent;
    contentFingerprint: string | null;
    metadataFingerprint: string | null;
  },
  from: number,
  to: number,
  allIds: Set<string>,
  block: Report,
  inspectCapture: CaptureInspector,
) {
  const dispositions = value.dispositions
    .map(normalizedDisposition)
    .sort((a, b) => compareId(a.matchId, b.matchId) || compareId(canonical(a), canonical(b)));
  const unique = new Map<string, IdDisposition>();
  const conflictingIds = new Set<string>();
  for (const d of dispositions) {
    const previous = unique.get(d.matchId);
    if (previous && !same(previous, d)) {
      block("conflicting_disposition", true);
      conflictingIds.add(d.matchId);
    }
    if (!previous) unique.set(d.matchId, d);
    if (!allIds.has(d.matchId)) block("disposition_extra");
  }
  for (const matchId of allIds) if (!unique.has(matchId)) block("disposition_missing");
  const ranked: Array<{ record: AchievementMatch; capture: SourceCapture }> = [];
  const unresolvedIds = new Set([...allIds].filter((matchId) => !unique.has(matchId)));
  for (const d of unique.values()) {
    if (!allIds.has(d.matchId)) continue;
    if (conflictingIds.has(d.matchId)) {
      unresolvedIds.add(d.matchId);
      continue;
    }
    if (
      d.state === "pending" ||
      d.state === "unknown" ||
      d.state === "unavailable_404" ||
      d.state === "invalid"
    ) {
      const reason = {
        pending: "detail_pending",
        unknown: "detail_unknown",
        unavailable_404: "detail_unavailable_404",
        invalid: "detail_invalid",
      } as const;
      block(reason[d.state]);
      unresolvedIds.add(d.matchId);
      continue;
    }
    if (d.state === "reused_without_attestation") {
      block("reuse_unattested");
      unresolvedIds.add(d.matchId);
    }
    if (d.detail === null) continue;
    const detail = d.detail;
    if (detail.matchId !== d.matchId) {
      block("detail_id_mismatch", true);
      unresolvedIds.add(d.matchId);
      continue;
    }
    if (
      (detail.playerId !== null && detail.playerId !== value.identity.playerId) ||
      (detail.platform !== null && detail.platform !== value.identity.platform)
    ) {
      block("detail_identity_mismatch", true);
      unresolvedIds.add(d.matchId);
      continue;
    }
    if (
      detail.playerId === null ||
      detail.platform === null ||
      detail.queueId === null ||
      detail.timestamp === null
    ) {
      block("unknown_detail_scope");
      unresolvedIds.add(d.matchId);
      continue;
    }
    const timestamp = Date.parse(detail.timestamp);
    if (timestamp < value.query.startTime * 1000 || timestamp >= value.query.endTime * 1000)
      block("detail_outside_query");
    if (value.query.queue !== null && detail.queueId !== value.query.queue)
      block("query_mismatch", true);
    if ("capture" in d) inspectCapture(d.capture, detailCaptureBinding(detail, d.capture));
    if (d.state === "reused_with_matching_attestation_declared") {
      const a = d.attestation;
      if (
        !same(a.identity, value.identity) ||
        !same(a.sourceRevision, value.sourceRevision) ||
        a.sourceRevision.state !== "declared" ||
        a.contentFingerprint !== material.contentFingerprint ||
        a.metadataFingerprint !== material.metadataFingerprint
      )
        block("attestation_mismatch");
    }
    const queueMatches = detail.queueId === scopeQueueId(material.content.scope);
    const inTarget = timestamp >= from && timestamp < to;
    const basis = !queueMatches
      ? "other_queue"
      : !inTarget
        ? "outside_target_interval"
        : detail.isRemake === true
          ? "confirmed_remake"
          : null;
    if (d.state === "excluded_with_basis") {
      if (d.basis !== basis) block("exclusion_basis_mismatch", true);
    } else if (!queueMatches || !inTarget) block("exclusion_required");
    if (!queueMatches || !inTarget) continue;
    if (
      detail.isRemake === null ||
      (detail.isRemake !== true && (detail.win === null || detail.championId === null))
    ) {
      block("unknown_match_fields");
      unresolvedIds.add(d.matchId);
    }
    const record: AchievementMatch = {
      matchId: detail.matchId,
      queueId: detail.queueId,
      timestamp: detail.timestamp,
      win: detail.win,
      isRemake: detail.isRemake,
      championId: detail.championId,
    };
    ranked.push({
      record,
      capture:
        "capture" in d
          ? d.capture
          : {
              state: "legacy",
              source: "unknown",
              endpoint: "unknown",
              captureId: null,
              receivedAt: null,
            },
    });
  }
  return { dispositions, unique, ranked, unresolvedIds };
}
/** A-D only: concordance of supplied pages/details/materialization, no operational reconciliation. */
export function reconcileDeclaredEvidence(input: unknown): StructuralReceiptResult {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return noContent("invalid_input", ["invalid_structure"]);
  const value = parsed.data;
  const reasons: ReceiptReason[] = [];
  let contradictory = false;
  const block = (reason: ReceiptReason, conflict = false) => {
    reasons.push(reason);
    contradictory ||= conflict;
  };
  const material = materializeAchievementEvidence(value.materialization.input);
  if (material.content === null || material.metadata === null || material.observation === null)
    return noContent(
      material.status === "contradictory" ? "contradictory" : "blocked",
      ["materialization_invalid"],
      value.identity,
      value.target,
    );
  if (
    material.content.sources.kind !== "matches" ||
    material.content.code !==
      (value.target.kind === "win_streak" ? "unstoppable" : "otp-specialist")
  )
    return noContent("blocked", ["scope_mismatch"], value.identity, value.target);
  if (!same(value.identity, material.content.identity)) block("identity_mismatch", true);
  if (
    material.contentFingerprint !== value.materialization.expectedContentFingerprint ||
    material.metadataFingerprint !== value.materialization.expectedMetadataFingerprint
  )
    block("fingerprint_mismatch", true);
  if (!same(value.sourceRevision, material.metadata.sourceRevision))
    block("revision_mismatch", true);
  if (
    material.status === "incomplete" &&
    (value.target.kind === "otp_history" ||
      material.reasons.some(
        (reason) => reason === "manifest_unknown" || reason === "manifest_mismatch",
      ))
  )
    block("materialization_incomplete");
  const from = Date.parse(value.target.interval.from),
    to = Date.parse(value.target.interval.to);
  const bounds = scopeBounds(material.content.scope);
  if (from >= to || from < bounds.start || to > bounds.end) block("invalid_interval");
  if (
    value.query.startTime >= value.query.endTime ||
    value.query.startTime * 1000 > from ||
    value.query.endTime * 1000 < to
  )
    block("query_margin_insufficient");
  if (value.query.start !== 0) block("page_missing");
  if (
    (value.query.queue !== null && value.query.queue !== scopeQueueId(material.content.scope)) ||
    (value.query.type !== null && value.query.type !== "ranked")
  )
    block("query_mismatch");
  if (value.indexChange.state === "reported") block("index_change_reported");

  const { pages, allIds, effective, terminalOffset, inspectCapture } = inspectPages(value, block);
  const { dispositions, unique, ranked, unresolvedIds } = inspectDispositions(
    value,
    material,
    from,
    to,
    allIds,
    block,
    inspectCapture,
  );
  const sources = material.content.sources.records.filter(
    (record) => Date.parse(record.timestamp) >= from && Date.parse(record.timestamp) < to,
  );
  const sourceMap = new Map(sources.map((record) => [record.matchId, record]));
  const recoveredMap = new Map(ranked.map(({ record }) => [record.matchId, record]));
  if (ranked.some(({ record }) => !same(record, sourceMap.get(record.matchId) ?? null)))
    block("materialization_mismatch", true);
  const metadataById = new Map(material.metadata.records.map((r) => [r.recordId, r]));
  const scanStillCollecting =
    terminalOffset === null ||
    reasons.some((reason) => ["page_missing", "page_partial", "page_failed"].includes(reason));
  for (const source of sources) {
    if (!recoveredMap.has(source.matchId)) {
      if (allIds.has(source.matchId) || scanStillCollecting) block("source_concordance_pending");
      else block("materialization_mismatch", true);
    }
    const meta = metadataById.get(source.matchId);
    if (meta?.captures.some((c) => c.state === "legacy")) block("legacy_unattested");
    for (const capture of meta?.captures ?? [])
      inspectCapture(
        capture,
        detailCaptureBinding(
          {
            ...source,
            playerId: material.content.identity.playerId,
            platform: material.content.identity.platform,
          },
          capture,
        ),
      );
  }
  const preparedInput: EvidenceMaterializationInput = {
    version: EVIDENCE_FORMAT_VERSION,
    identity: value.identity,
    scope: material.content.scope,
    kind: "matches",
    code: value.target.kind === "win_streak" ? "unstoppable" : "otp-specialist",
    attribution: material.metadata.attribution,
    sourceRevision: value.sourceRevision,
    manifest: { state: "declared", recordIds: ranked.map(({ record }) => record.matchId) },
    coverage: material.content.coverage,
    records: ranked.map(({ record, capture }) => ({ identity: value.identity, record, capture })),
  };
  const analysis = materializeAchievementEvidence(preparedInput);
  if (analysis.content === null || analysis.observation === null || analysis.matchSummary === null)
    return noContent(
      contradictory ? "contradictory" : "blocked",
      [...reasons, "materialization_invalid"],
      value.identity,
      value.target,
    );
  if (analysis.observation.reasons.includes("ambiguous_timestamp")) block("ambiguous_timestamp");
  if (value.target.kind === "win_streak") {
    const chosen = value.target.chosenWinIds;
    const selected = chosen.map((matchId) => recoveredMap.get(matchId));
    const supported = [material.observation, analysis.observation].every((observation) => {
      if (observation.evidence?.kind !== "recorded_win_streak") return false;
      const ids = observation.evidence.matchIds;
      return ids.some((_, start) =>
        chosen.every((matchId, index) => ids[start + index] === matchId),
      );
    });
    if (
      new Set(chosen).size !== 5 ||
      !supported ||
      selected.some((row) => !row || row.win !== true || row.isRemake !== false)
    )
      block("chosen_streak_not_supported");
  } else {
    const calendar = value.target.calendar;
    if (material.content.scope.season.endAt === null) block("season_open");
    if (calendar.state === "unknown") block("calendar_missing");
    else if (
      calendar.platform !== value.identity.platform ||
      calendar.season !== value.identity.season ||
      Date.parse(calendar.startAt) !== from ||
      Date.parse(calendar.endAt) !== to ||
      from !== bounds.start ||
      material.content.scope.season.endAt === null ||
      Date.parse(material.content.scope.season.endAt) !== to
    )
      block("calendar_mismatch");
  }
  const orderedReasons = reasonsOrdered(reasons);
  const collecting = new Set<ReceiptReason>([
    "page_missing",
    "terminal_missing",
    "page_partial",
    "page_failed",
    "disposition_missing",
    "detail_pending",
    "detail_unknown",
    "source_concordance_pending",
  ]);
  const status = contradictory
    ? "contradictory"
    : orderedReasons.some((reason) => !collecting.has(reason))
      ? "blocked"
      : orderedReasons.length
        ? "collecting"
        : "structurally_complete";
  const target = normalizedTarget(value.target);
  const content: StructuralReceiptContent = {
    version: STRUCTURAL_RECEIPT_VERSION,
    canonicalizationVersion: RECEIPT_CANONICALIZATION_VERSION,
    nature: value.nature,
    identity: value.identity,
    target,
    scanId: value.scanId,
    query: value.query,
    sourceRevision: value.sourceRevision,
    indexChange: value.indexChange,
    pages,
    dispositions,
    discoveredIds: [...allIds].sort(compareId),
    effectiveOffsets: effective.map((page) => page.query.start),
    terminalOffset,
    counts: {
      discovered: allIds.size,
      disposed: [...unique.keys()].filter((matchId) => allIds.has(matchId)).length,
      known: allIds.size - unresolvedIds.size,
      unresolved: unresolvedIds.size,
      rankedInTarget: ranked.length,
    },
    materialization: { content: material.content, metadata: material.metadata },
    observation: analysis.observation,
    matchSummary: analysis.matchSummary,
    reasons: orderedReasons,
  };
  return {
    ...base,
    identity: value.identity,
    target,
    counts: content.counts,
    status,
    reasons: orderedReasons,
    content,
    fingerprint: contradictory ? null : hash(content as unknown as Json),
  };
}
