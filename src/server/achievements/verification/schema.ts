import "server-only";
import { z } from "zod";
import { PLATFORMS } from "@/lib/routing";
import { RANKED_QUEUES } from "@/lib/queues";
import { VERIFICATION_POLICIES } from "./contracts";

const instant = z.iso.datetime({ offset: true });
const id = z
  .string()
  .min(1)
  .max(256)
  .refine((v) => v.trim() === v);
export function knowledge<T extends z.ZodType>(schema: T) {
  return z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("known"), value: schema }),
    z.strictObject({ state: z.literal("unknown") }),
    z.strictObject({ state: z.literal("not_applicable") }),
  ]);
}
const identity = z.strictObject({
  playerId: z.uuid(),
  platform: z.enum(PLATFORMS),
  queue: z.enum(RANKED_QUEUES),
  season: id,
});
const integer = z.number().int().refine(Number.isSafeInteger);
const record = z.strictObject({
  matchId: id,
  queueId: z.union([z.literal(420), z.literal(440)]),
  timestamp: instant,
  win: z.boolean().nullable(),
  isRemake: z.boolean().nullable(),
  championId: integer.positive().nullable(),
});
const receipt = z.strictObject({
  version: z.literal("1.2.B.1-receipt-draft-v1"),
  origin: z.literal("server_reconciliation"),
  identity,
  traceId: id,
  checkedAt: instant,
  interval: z.strictObject({ from: instant, to: instant }),
  query: z.strictObject({
    from: instant,
    to: instant,
    precision: z.literal("seconds"),
    bounds: z.literal("half_open"),
    exhausted: knowledge(z.literal(true)),
  }),
  ids: z.array(id),
  details: z.array(
    z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("resolved"), record }),
      z.strictObject({ state: z.literal("unavailable"), matchId: id, code: z.literal(404) }),
      z.strictObject({ state: z.literal("unknown"), matchId: id }),
    ]),
  ),
  limitation: z.literal("recoverable_records_not_absolute_riot_history"),
});
export const contextSchema = z.strictObject({
  environment: z.enum(["local", "staging_preview", "production", "unknown"]),
  identity,
  evaluatedAt: instant,
  source: z.enum(["stored_riot", "demo", "client", "unknown"]),
  provenance: knowledge(
    z.strictObject({
      identity,
      traceId: id,
      readAt: instant,
      dataCutoff: instant,
      recordIds: z.array(id),
    }),
  ),
  sourceRevision: knowledge(id),
  policyAuthorization: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("not_authorized") }),
    z.strictObject({
      state: z.literal("simulation_only"),
      version: z.enum(Object.values(VERIFICATION_POLICIES)),
    }),
  ]),
});
export const submissionSchema = z.strictObject({
  code: z.enum(["resurrection", "unstoppable", "otp-specialist"]),
  evaluatorVersion: id,
  policyVersion: id,
  evidence: z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("available"),
      input: z.unknown(),
      presentedEvidence: z.unknown(),
    }),
    z.strictObject({
      state: z.literal("unavailable"),
      reason: z.enum(["infrastructure", "invalid_data", "unexpected"]),
    }),
  ]),
  reconciliation: knowledge(receipt),
  seasonClosure: knowledge(
    z.strictObject({
      season: id,
      platform: z.enum(PLATFORMS),
      endAt: instant,
      confirmedAt: instant,
      basis: z.literal("approved_regional_calendar"),
    }),
  ),
});
