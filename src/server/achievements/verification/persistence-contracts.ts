import "server-only";
import { z } from "zod";
import { PLATFORMS } from "@/lib/routing";
import { RANKED_QUEUES } from "@/lib/queues";
import type { IdDisposition, DeclaredPage } from "./receipt-contracts";

export const LOCAL_EVIDENCE_VERSION = "1.2.B.2.D-local-evidence-v1";
export const LOCAL_LIMITS = {
  headerBytes: 65536,
  unitBytes: 16384,
  unitsPerHeader: 100000,
  bytesPerHeader: 32 * 1024 * 1024,
  headersPerPlayer: 1000,
  bytesPerPlayer: 64 * 1024 * 1024,
} as const;
export const MAX_REVISION = 9223372036854775807n;
export class LocalEvidenceError extends Error {
  constructor(
    public readonly code: "invalid" | "missing" | "conflict" | "revision" | "limit" | "incomplete",
  ) {
    super(`Local evidence: ${code}`);
  }
}
export const decimalRevision = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((v) => /^(0|[1-9][0-9]*)$/.test(v) && v.length <= 19 && BigInt(v) <= MAX_REVISION);
const key = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
const entity = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
const instant = z.iso
  .datetime({ offset: true })
  .refine((v) => Number.isFinite(Date.parse(v)) && (/\.(\d+)/.exec(v)?.[1].length ?? 0) <= 3);
export const localIdentity = z.strictObject({
  playerId: z.uuid(),
  platform: z.enum(PLATFORMS),
  queue: z.enum(RANKED_QUEUES),
  season: key.max(64),
});
export const captureSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("legacy"),
    source: z.enum(["stored", "unknown"]),
    endpoint: z.literal("unknown"),
    captureId: z.null(),
    receivedAt: z.null(),
  }),
  z.strictObject({
    state: z.literal("declared"),
    source: z.enum(["synthetic", "unknown"]),
    endpoint: z.enum(["LEAGUE-V4", "MATCH-V5", "unknown"]),
    captureId: key.nullable(),
    receivedAt: instant.nullable(),
  }),
]);
export const headerSchema = z
  .strictObject({
    identity: localIdentity,
    operationKey: key,
    kind: z.enum(["rank_capture", "match_scan"]),
    source: z.enum(["unknown", "synthetic"]),
    parentId: z.uuid().nullable(),
    interval: z.strictObject({ from: instant, to: instant }).nullable(),
    capture: captureSchema,
  })
  .refine((v) => !v.interval || Date.parse(v.interval.from) < Date.parse(v.interval.to))
  .refine((v) =>
    v.capture.state === "legacy" ? v.source === "unknown" : v.capture.source === v.source,
  );
const detail = z.strictObject({
  matchId: entity,
  playerId: z.uuid().nullable(),
  platform: z.enum(PLATFORMS).nullable(),
  queueId: z.number().int().positive().nullable(),
  timestamp: instant.nullable(),
  win: z.boolean().nullable(),
  isRemake: z.boolean().nullable(),
  championId: z.number().int().positive().nullable(),
});
const detailFields = { matchId: entity, detail, capture: captureSchema };
const dispositionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("pending"), matchId: entity }),
  z.strictObject({ state: z.literal("unknown"), matchId: entity }),
  z.strictObject({ state: z.literal("unavailable_404"), matchId: entity }),
  z.strictObject({
    state: z.literal("invalid"),
    matchId: entity,
    reason: z.enum(["schema", "identity", "scope", "conflict"]),
  }),
  z.strictObject({ state: z.literal("resolved"), ...detailFields }),
  z.strictObject({
    state: z.literal("excluded_with_basis"),
    ...detailFields,
    basis: z.enum(["other_queue", "outside_target_interval", "confirmed_remake"]),
  }),
  z.strictObject({
    state: z.literal("reused_without_attestation"),
    matchId: entity,
    detail: detail.nullable(),
  }),
  z.strictObject({
    state: z.literal("reused_with_matching_attestation_declared"),
    ...detailFields,
    attestation: z.strictObject({
      state: z.literal("declared"),
      identity: localIdentity,
      sourceRevision: z.discriminatedUnion("state", [
        z.strictObject({ state: z.literal("unknown") }),
        z.strictObject({ state: z.literal("declared"), value: decimalRevision }),
      ]),
      contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      metadataFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  }),
]);
const query = z.strictObject({
  startTime: z.number().int().nonnegative().refine(Number.isSafeInteger),
  endTime: z.number().int().nonnegative().refine(Number.isSafeInteger),
  start: z.number().int().nonnegative(),
  count: z.number().int().min(1).max(100),
  queue: z.number().int().positive().nullable(),
  type: z.enum(["ranked", "normal", "tourney", "tutorial"]).nullable(),
  timeSemantics: z.literal("unconfirmed"),
});
const pageSchema = z.strictObject({
  scanId: key,
  attempt: z.number().int().positive(),
  identity: localIdentity,
  query,
  capture: captureSchema,
  response: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("success"), ids: z.array(entity).max(100) }),
    z.strictObject({ state: z.literal("partial"), ids: z.array(entity).max(100) }),
    z.strictObject({
      state: z.literal("failed"),
      reason: z.enum(["network", "http_429", "http_5xx", "invalid_response"]),
    }),
  ]),
});
const common = { unitKey: key, ordinal: z.number().int().nonnegative() };
export const unitSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...common, kind: z.literal("page"), page: pageSchema }),
  z.strictObject({
    ...common,
    kind: z.literal("disposition"),
    disposition: dispositionSchema,
    previousUnitId: z.uuid().nullable(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("snapshot"),
    snapshot: z.strictObject({
      id: entity,
      queue: z.enum(RANKED_QUEUES),
      timestamp: instant,
      tier: z.enum([
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
        "UNRANKED",
      ]),
      division: z.enum(["I", "II", "III", "IV", ""]),
      leaguePoints: z.number().int().nonnegative(),
      wins: z.number().int().nonnegative(),
      losses: z.number().int().nonnegative(),
    }),
    capture: captureSchema,
  }),
]);
export type LocalHeaderInput = z.infer<typeof headerSchema>;
export type LocalUnitInput = z.infer<typeof unitSchema>;
export type EffectiveEvidence = {
  pages: DeclaredPage[];
  dispositions: IdDisposition[];
  unitIds: string[];
};
export const UNAUTHENTICATED = {
  certification: "not_established",
  grantAuthorized: false,
  provenanceAuthentication: "not_performed",
  recoverableCoverage: "not_established",
  seasonClosure: "not_established",
} as const;

export function parseLocal<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new LocalEvidenceError("invalid");
  return result.data;
}
/** Private canonical JSON: validated records only; no coercion of bigint or unknown fields. */
export function localCanonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(localCanonical).join(",")}]`;
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${localCanonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  throw new LocalEvidenceError("invalid");
}
