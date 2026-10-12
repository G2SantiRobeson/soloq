import "server-only";
import { z } from "zod";
import { PLATFORMS } from "@/lib/routing";
import { RANKED_QUEUES } from "@/lib/queues";

export const OPERATIONAL_CAPTURE_VERSION = "1.2.B.2.E.2.1-capture-preparation-v1";
export const SCAN_LIFECYCLE_VERSION = "1.2.B.2.E.2.1-scan-lifecycle-v1";
// Vocabulary only: no constructor/validator in this stage can reach the last three levels.
export const CAPTURE_TRUST_LEVELS = Object.freeze([
  "synthetic",
  "declared",
  "received_by_server",
  "validated",
  "committed",
] as const);
export const CAPTURE_ERROR_CODES = [
  "invalid_capture",
  "storage_capacity",
  "scope_mismatch",
  "identity_mismatch",
  "conflicting_source",
  "retry_ambiguity",
] as const;
export class CapturePreparationError extends Error {
  constructor(public readonly code: (typeof CAPTURE_ERROR_CODES)[number]) {
    super(`Capture preparation: ${code}`);
  }
}
const integer = z.number().int().nonnegative().refine(Number.isSafeInteger);
const positive = integer.refine((v) => v > 0);
// Bounded identifiers, not arbitrary strings that could carry URLs, tokens or payloads.
const matchId = z
  .string()
  .max(64)
  .regex(/^[A-Z][A-Z0-9]{1,4}_[0-9]{1,20}$/);
const season = z.string().regex(/^[0-9]{4}$/);
const instant = z.iso
  .datetime({ precision: 3 })
  .refine((v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
export const captureOwnerSchema = z.strictObject({
  playerId: z.uuid(),
  platform: z.enum(PLATFORMS),
  queue: z.enum(RANKED_QUEUES),
  season,
});
const interval = z
  .strictObject({
    from: instant,
    to: instant,
    bounds: z.literal("half_open"),
  })
  .refine((v) => Date.parse(v.from) < Date.parse(v.to));
const query = z
  .strictObject({
    startTime: integer,
    endTime: integer,
    start: integer,
    count: positive.max(100),
    queue: integer.nullable(),
    type: z.enum(["ranked", "normal", "tourney", "tutorial"]).nullable(),
    timeSemantics: z.literal("unconfirmed"),
  })
  .refine((v) => v.startTime < v.endTime);
const capture = z
  .strictObject({
    trust: z.enum(["synthetic", "declared"]),
    captureId: z.uuid().nullable(),
    receptionId: z.uuid().nullable(),
    receivedAt: instant.nullable(),
    validatedAt: instant.nullable(),
    // Persistence dates cannot be supplied by a preparation-only caller.
    createdAt: z.null(),
    committedAt: z.null(),
    schemaVersion: z.literal(OPERATIONAL_CAPTURE_VERSION),
    normalizationVersion: z.literal("minimal-capture-v1"),
  })
  .refine((v) => !v.validatedAt || (!!v.receivedAt && v.validatedAt >= v.receivedAt));
const source = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("none") }),
  z.strictObject({ state: z.literal("legacy"), captureId: z.null(), receivedAt: z.null() }),
  z.strictObject({
    state: z.literal("existing_declared"),
    referenceId: z.uuid(),
    owner: captureOwnerSchema,
    version: z.literal(OPERATIONAL_CAPTURE_VERSION),
    concordance: z.enum(["matching_declared", "conflicting", "unknown"]),
  }),
]);
const response = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("http_success"),
    status: z.literal(200),
    completeness: z.enum(["complete", "partial"]),
  }),
  z.strictObject({ state: z.literal("http_404"), status: z.literal(404) }),
  z.strictObject({
    state: z.literal("http_429"),
    status: z.literal(429),
    retryAfterMs: integer.nullable(),
  }),
  z.strictObject({ state: z.literal("http_5xx"), status: integer.min(500).max(599) }),
  z.strictObject({
    state: z.literal("http_other"),
    status: integer
      .min(400)
      .max(499)
      .refine((v) => v !== 404 && v !== 429),
  }),
  z.strictObject({ state: z.literal("invalid_json"), status: z.literal(200) }),
  z.strictObject({ state: z.literal("invalid_schema"), status: z.literal(200) }),
  z.strictObject({ state: z.literal("network_failure"), failedAt: instant }),
  z.strictObject({ state: z.literal("timeout"), failedAt: instant }),
  z.strictObject({ state: z.literal("pending") }),
  z.strictObject({ state: z.literal("unknown") }),
]);
const binding = z.strictObject({
  state: z.enum(["matching_declared", "mismatching_declared", "unknown"]),
  playerId: z.uuid().nullable(),
  platform: z.enum(PLATFORMS).nullable(),
});
const tier = z.enum([
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
]);
const entry = z.strictObject({
  queue: z.enum(RANKED_QUEUES),
  tier,
  division: z.enum(["I", "II", "III", "IV"]),
  leaguePoints: integer,
  wins: integer,
  losses: integer,
});
const remake = z
  .strictObject({
    truePresent: integer,
    falsePresent: integer,
    absent: integer,
    observationalIsRemake: z.boolean().nullable(),
    classifierVersion: z.literal("any-early-surrender-true-v1"),
    evidentiarySufficiency: z.literal("unknown"),
  })
  .refine((v) => {
    const total = v.truePresent + v.falsePresent + v.absent;
    return (
      Number.isSafeInteger(total) &&
      total <= 20 &&
      v.observationalIsRemake === (total === 0 ? null : v.truePresent > 0)
    );
  });
const detail = z.strictObject({
  matchId,
  timestampMs: integer.max(8640000000000000).nullable(),
  queueId: integer.nullable(),
  mapId: integer.nullable(),
  gameMode: z.enum(["CLASSIC", "OTHER"]).nullable(),
  participant: z.strictObject({ binding, matchingCount: integer.max(20) }),
  win: z.boolean().nullable(),
  championId: positive.nullable(),
  remake,
});
const common = {
  version: z.literal(OPERATIONAL_CAPTURE_VERSION),
  owner: captureOwnerSchema,
  capture,
  source,
  attempt: positive,
  response,
};
const input = z.discriminatedUnion("endpoint", [
  z.strictObject({ ...common, endpoint: z.literal("ACCOUNT-V1"), binding: binding.nullable() }),
  z.strictObject({
    ...common,
    endpoint: z.literal("LEAGUE-V4"),
    entries: z.array(entry).max(20).nullable(),
    snapshot: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("none") }),
      z.strictObject({ state: z.literal("existing_declared"), id: z.uuid(), timestamp: instant }),
      z.strictObject({ state: z.literal("proposed"), timestamp: instant }),
    ]),
  }),
  z.strictObject({
    ...common,
    endpoint: z.literal("MATCH-V5-IDS"),
    scanId: z.uuid(),
    interval,
    query,
    ids: z.array(matchId).max(100).nullable(),
    indexChange: z.enum(["unproven", "observed_change"]),
  }),
  z.strictObject({
    ...common,
    endpoint: z.literal("MATCH-V5-DETAIL"),
    requestedMatchId: matchId,
    interval,
    detail: detail.nullable(),
  }),
]);
export const operationalCaptureInputSchema = input.superRefine((v, ctx) => {
  const noResponse = ["network_failure", "timeout", "pending", "unknown"].includes(
    v.response.state,
  );
  const success = v.response.state === "http_success";
  const content =
    v.endpoint === "ACCOUNT-V1"
      ? v.binding
      : v.endpoint === "LEAGUE-V4"
        ? v.entries
        : v.endpoint === "MATCH-V5-IDS"
          ? v.ids
          : v.detail;
  if (
    (noResponse &&
      (v.capture.receivedAt !== null ||
        v.capture.validatedAt !== null ||
        v.capture.receptionId !== null)) ||
    success !== (content !== null) ||
    (v.endpoint === "LEAGUE-V4" && !success && v.snapshot.state !== "none") ||
    (v.endpoint === "MATCH-V5-IDS" && v.ids && v.ids.length > v.query.count)
  )
    ctx.addIssue({ code: "custom", message: "Invalid capture structure" });
});
export const evidenceScanSchema = z
  .strictObject({
    version: z.literal(SCAN_LIFECYCLE_VERSION),
    scanId: z.uuid(),
    owner: captureOwnerSchema,
    phase: z.enum(["recent", "season_backfill", "incremental_repair"]),
    interval,
    query,
    lifecycle: z.enum(["active", "import_finished", "prefix_unknown", "blocked"]),
    runId: z.uuid().nullable(),
    checkpointId: z.uuid().nullable(),
    structuralReceiptId: z.null(),
    sealId: z.null(),
    prefix: z.enum(["declared_from_zero", "unknown"]),
    finishedAt: instant.nullable(),
  })
  .refine((v) => (v.lifecycle === "import_finished") === (v.finishedAt !== null))
  .refine((v) => v.lifecycle !== "prefix_unknown" || v.prefix === "unknown");
export type CaptureOwner = z.infer<typeof captureOwnerSchema>;
export type CapturePreparationInput = z.infer<typeof operationalCaptureInputSchema>;
export type EvidenceScan = z.infer<typeof evidenceScanSchema>;
export const PREPARATION_LIMITATIONS = Object.freeze({
  certification: "not_established",
  grantAuthorized: false,
  writes: "none",
  provenanceAuthentication: "not_performed",
  revisionValidation: "not_performed",
  recoverableCoverage: "not_established",
  seasonClosure: "not_established",
} as const);
