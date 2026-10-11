import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ACHIEVEMENT_RULE_VERSION,
  OTP_RULE_VERSION,
  evaluateResurrection,
  evaluateUnstoppable,
  evaluateOtpSpecialist,
  type AchievementMatch,
  type AchievementSnapshot,
} from "@/lib/achievements";
import { compareId, scopeBounds, scopeQueue, scopeQueueId } from "@/lib/achievements/validation";
import { PLATFORMS } from "@/lib/routing";
import { RANKED_QUEUES } from "@/lib/queues";
import { TIERS } from "@/lib/ranking";
import {
  EVIDENCE_FORMAT_VERSION,
  CANONICALIZATION_VERSION,
  type EvidenceMaterializationInput,
  type EvidenceMaterializationResult,
  type MaterializationReason,
  type MaterializedContent,
  type MaterializedCaptureMetadata,
  type MatchSetSummary,
  type SourceCapture,
} from "./materialization-contracts";

// No implicit truncation of sub-millisecond instants. JS Date represents milliseconds.
const instant = z.iso.datetime({ offset: true }).refine((v) => {
  const fractional = /\.(\d+)/.exec(v)?.[1];
  return Number.isFinite(Date.parse(v)) && (!fractional || fractional.length <= 3);
});
const id = z
  .string()
  .min(1)
  .max(256)
  .refine((v) => v.trim() === v);
const integer = z.number().int().refine(Number.isSafeInteger);
const identity = z.strictObject({
  playerId: z.uuid(),
  platform: z.enum(PLATFORMS),
  queue: z.enum(RANKED_QUEUES),
  season: id,
});
const scope = z.strictObject({
  view: z.enum(["soloq", "flex"]),
  platform: z.enum(PLATFORMS),
  season: z.strictObject({ id, startAt: instant, endAt: instant.nullable() }),
  asOf: instant,
});
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
    endpoint: z.enum(["LEAGUE-V4", "MATCH-V5", "unknown"]),
    captureId: id.nullable(),
    receivedAt: instant.nullable(),
  }),
]);
const coverage = z.strictObject({
  source: z.enum(["imported_history", "profile_recent_window"]),
  historyStatus: z.enum(["unknown", "not_started", "running", "completed", "failed"]),
  unavailable: integer.nonnegative().nullable(),
  intervalCoverage: z.literal("unproven"),
});
const common = {
  version: z.literal(EVIDENCE_FORMAT_VERSION),
  identity,
  scope,
  coverage,
  attribution: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("known"), origin: z.enum(["synthetic", "stored", "riot"]) }),
    z.strictObject({ state: z.literal("unknown") }),
    z.strictObject({ state: z.literal("unproven"), claim: z.enum(["stored", "riot"]) }),
  ]),
  sourceRevision: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unknown") }),
    z.strictObject({ state: z.literal("declared"), value: id }),
  ]),
  manifest: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unknown") }),
    z.strictObject({ state: z.literal("declared"), recordIds: z.array(id) }),
  ]),
};
const rankedRecord = z
  .strictObject({
    id,
    queue: z.enum(RANKED_QUEUES),
    timestamp: instant,
    tier: z.enum([...TIERS, "UNRANKED"]),
    division: z.enum(["I", "II", "III", "IV", ""]),
    leaguePoints: integer.nonnegative(),
    wins: integer.nonnegative(),
    losses: integer.nonnegative(),
  })
  .refine((point) =>
    point.tier === "UNRANKED"
      ? point.division === "" && point.leaguePoints === 0 && point.wins === 0 && point.losses === 0
      : TIERS.indexOf(point.tier) >= 7 || point.division !== "",
  );
const matchRecord = z.strictObject({
  matchId: id,
  queueId: z.union([z.literal(420), z.literal(440)]),
  timestamp: instant,
  win: z.boolean().nullable(),
  isRemake: z.boolean().nullable(),
  championId: integer.positive().nullable(),
});
const inputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...common,
    kind: z.literal("ranked"),
    code: z.literal("resurrection"),
    records: z.array(z.strictObject({ identity, capture, record: rankedRecord })),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("matches"),
    code: z.enum(["unstoppable", "otp-specialist"]),
    records: z.array(z.strictObject({ identity, capture, record: matchRecord })),
  }),
]);

const base = {
  mode: "pure_materialization",
  certification: "not_established",
  grantAuthorized: false,
  writes: "none",
  provenanceAuthentication: "not_performed",
  revisionValidation: "not_performed",
  intervalCoverage: "unproven",
  reconciliation: { state: "unknown" },
  seasonClosure: { state: "unknown" },
} as const;

type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
/** Called only with validated, owned, finite JSON shapes; not an arbitrary object serializer. */
function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort(compareId)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function fingerprint(value: MaterializedContent | MaterializedCaptureMetadata) {
  return createHash("sha256")
    .update(canonicalJson(value as unknown as Json), "utf8")
    .digest("hex");
}
const utc = (value: string) => new Date(value).toISOString();
const recordId = (record: AchievementMatch | AchievementSnapshot) =>
  "matchId" in record ? record.matchId : record.id!;
const stableReasons = (reasons: MaterializationReason[]) => [...new Set(reasons)].sort(compareId);
function rejected(
  status: "invalid_input" | "contradictory",
  reasons: MaterializationReason[],
): EvidenceMaterializationResult {
  return {
    ...base,
    status,
    reasons: stableReasons(reasons),
    content: null,
    contentFingerprint: null,
    metadata: null,
    metadataFingerprint: null,
    observation: null,
    matchSummary: null,
  };
}
function normalizeCapture(value: SourceCapture): SourceCapture {
  return value.state === "legacy"
    ? value
    : {
        ...value,
        receivedAt: value.receivedAt === null ? null : utc(value.receivedAt),
      };
}

function summarizeMatches(records: AchievementMatch[]): MatchSetSummary {
  const summary: MatchSetSummary = {
    validGames: 0,
    championCounts: [],
    validMatchIds: [],
    exclusions: [],
    unresolved: [],
  };
  const champions = new Map<number, number>();
  for (const record of records) {
    if (record.isRemake === true) {
      summary.exclusions.push({ matchId: record.matchId, reason: "confirmed_remake" });
      continue;
    }
    const fields: Array<"win" | "isRemake" | "championId"> = [];
    if (record.win === null) fields.push("win");
    if (record.isRemake === null) fields.push("isRemake");
    if (record.championId === null) fields.push("championId");
    if (fields.length) {
      summary.unresolved.push({ matchId: record.matchId, fields });
      continue;
    }
    summary.validMatchIds.push(record.matchId);
    champions.set(record.championId!, (champions.get(record.championId!) ?? 0) + 1);
  }
  summary.validGames = summary.validMatchIds.length;
  summary.championCounts = [...champions]
    .sort(([a], [b]) => a - b)
    .map(([championId, games]) => ({ championId, games }));
  return summary;
}

/** Internal preparation only. No factory of authenticated Riot evidence or B.1 attestations. */
export function materializeAchievementEvidence(input: unknown): EvidenceMaterializationResult {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return rejected("invalid_input", [
      "invalid_structure",
      ...(parsed.error.issues.some((issue) =>
        ["timestamp", "receivedAt", "startAt", "endAt", "asOf"].includes(String(issue.path.at(-1))),
      )
        ? ["invalid_timestamp" as const]
        : []),
    ]);
  const value: EvidenceMaterializationInput = parsed.data;
  const reasons: MaterializationReason[] = [];
  const { identity: owner, scope: window } = value;
  if (
    owner.platform !== window.platform ||
    owner.season !== window.season.id ||
    owner.queue !== scopeQueue(window)
  )
    reasons.push("scope_mismatch");
  const bounds = scopeBounds(window);
  if (
    bounds.end <= bounds.start ||
    (window.season.endAt !== null && Date.parse(window.season.endAt) <= bounds.start)
  )
    reasons.push("invalid_timestamp");
  for (const source of value.records) {
    if (canonicalJson(source.identity) !== canonicalJson(owner)) reasons.push("identity_mismatch");
    const record = source.record;
    const timestamp = Date.parse(record.timestamp);
    if (timestamp < bounds.start || timestamp >= bounds.end) reasons.push("outside_window");
    if ("matchId" in record) {
      if (record.queueId !== scopeQueueId(window)) reasons.push("queue_mismatch");
      if (
        !record.matchId.startsWith(`${owner.platform}_`) ||
        !/^\d+$/.test(record.matchId.slice(owner.platform.length + 1))
      )
        reasons.push("platform_mismatch");
    } else if (record.queue !== owner.queue) reasons.push("queue_mismatch");
    if (
      source.capture.endpoint !== "unknown" &&
      source.capture.endpoint !== (value.kind === "ranked" ? "LEAGUE-V4" : "MATCH-V5")
    )
      reasons.push("capture_endpoint_mismatch");
  }
  if (reasons.length) return rejected("invalid_input", reasons);

  // Explicit fields, no implicit projection of an interpolated point or arbitrary raw payload.
  const unique = new Map<string, AchievementMatch | (AchievementSnapshot & { id: string })>();
  const metadata = new Map<
    string,
    { recordId: string; originalTimestamps: Set<string>; captures: Map<string, SourceCapture> }
  >();
  for (const source of value.records) {
    const record = { ...source.record, timestamp: utc(source.record.timestamp) };
    const key = recordId(record);
    const previous = unique.get(key);
    if (previous && canonicalJson(previous) !== canonicalJson(record))
      return rejected("contradictory", ["conflicting_duplicate"]);
    unique.set(key, record);
    const meta = metadata.get(key) ?? {
      recordId: key,
      originalTimestamps: new Set<string>(),
      captures: new Map<string, SourceCapture>(),
    };
    meta.originalTimestamps.add(source.record.timestamp);
    const normalized = normalizeCapture(source.capture);
    meta.captures.set(canonicalJson(normalized), normalized);
    metadata.set(key, meta);
  }
  const ordered = [...unique.values()].sort(
    (a, b) =>
      Date.parse(a.timestamp) - Date.parse(b.timestamp) || compareId(recordId(a), recordId(b)),
  );
  const manifest =
    value.manifest.state === "unknown"
      ? value.manifest
      : {
          state: "declared" as const,
          recordIds: [...new Set(value.manifest.recordIds)].sort(compareId),
        };
  if (manifest.state === "unknown") reasons.push("manifest_unknown");
  else if (
    manifest.recordIds.length !== unique.size ||
    manifest.recordIds.some((key) => !unique.has(key))
  )
    reasons.push("manifest_mismatch");
  if (
    ordered.some((record, index) => index > 0 && record.timestamp === ordered[index - 1].timestamp)
  )
    reasons.push("ambiguous_timestamp");

  const sources: MaterializedContent["sources"] =
    value.kind === "ranked"
      ? { kind: "ranked", records: ordered as Array<AchievementSnapshot & { id: string }> }
      : { kind: "matches", records: ordered as AchievementMatch[] };
  const content: MaterializedContent = {
    formatVersion: EVIDENCE_FORMAT_VERSION,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    identity: owner,
    scope: {
      ...window,
      asOf: utc(window.asOf),
      season: {
        ...window.season,
        startAt: utc(window.season.startAt),
        endAt: window.season.endAt === null ? null : utc(window.season.endAt),
      },
    },
    code: value.code,
    ruleVersion: value.code === "otp-specialist" ? OTP_RULE_VERSION : ACHIEVEMENT_RULE_VERSION,
    manifest,
    coverage: value.coverage,
    sources,
  };
  const contentFingerprint = fingerprint(content);
  const captures: MaterializedCaptureMetadata = {
    formatVersion: EVIDENCE_FORMAT_VERSION,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    contentFingerprint,
    attribution: value.attribution,
    sourceRevision: value.sourceRevision,
    originalScope: window,
    records: [...metadata.values()]
      .sort((a, b) => compareId(a.recordId, b.recordId))
      .map((record) => ({
        recordId: record.recordId,
        originalTimestamps: [...record.originalTimestamps].sort(compareId),
        captures: [...record.captures.entries()]
          .sort(([a], [b]) => compareId(a, b))
          .map(([, capture]) => capture),
      })),
  };
  const observation =
    sources.kind === "ranked"
      ? evaluateResurrection({ scope: content.scope, snapshots: sources.records })
      : (value.code === "unstoppable" ? evaluateUnstoppable : evaluateOtpSpecialist)({
          scope: content.scope,
          matches: sources.records,
          coverage: content.coverage,
        });
  const matchSummary = sources.kind === "matches" ? summarizeMatches(sources.records) : null;
  if (matchSummary?.unresolved.length) reasons.push("unknown_match_fields");
  if (value.coverage.historyStatus !== "completed") reasons.push("history_not_completed");
  if (value.coverage.unavailable !== 0) reasons.push("unavailable_details");
  if (value.coverage.source !== "imported_history") reasons.push("limited_source_window");
  const incomplete = reasons.length > 0;
  reasons.push(
    "operational_authentication_not_performed",
    "interval_coverage_unproven",
    "source_revision_not_verified",
  );
  if (value.records.some((source) => source.capture.state === "legacy"))
    reasons.push("legacy_provenance_unproven");
  if (value.kind === "matches") reasons.push("reconciliation_not_materialized");
  if (value.code === "otp-specialist") reasons.push("season_closure_not_established");
  return {
    ...base,
    status: incomplete ? "incomplete" : "materialized",
    reasons: stableReasons(reasons),
    content,
    contentFingerprint,
    metadata: captures,
    metadataFingerprint: fingerprint(captures),
    observation,
    matchSummary,
  };
}
