import { z } from "zod";
import { RANKED_QUEUES, STANDARD_QUEUES, queueIds, rankedQueue } from "../queues";
import { PLATFORMS } from "../routing";
import { MAX_RANK_INTERVAL_MS } from "../rank-trajectory";
import { ACHIEVEMENT_RULE_VERSION } from "./catalog";
import type {
  AchievementReason,
  AchievementScope,
  MatchEvaluationInput,
  RankEvaluationInput,
} from "./types";

const instant = z.iso.datetime({ offset: true });
const id = z
  .string()
  .min(1)
  .refine((v) => v.trim() === v);
const integer = z.number().int().refine(Number.isSafeInteger);
const positive = integer.refine((v) => v > 0);
const scopeSchema = z
  .object({
    view: z.enum(["soloq", "flex"]),
    platform: z.enum(PLATFORMS),
    season: z.object({ id, startAt: instant, endAt: instant.nullable() }),
    asOf: instant,
  })
  .refine(
    (s) =>
      Date.parse(s.asOf) > Date.parse(s.season.startAt) &&
      (s.season.endAt === null || Date.parse(s.season.endAt) > Date.parse(s.season.startAt)),
  );
const coverageSchema = z.object({
  source: z.enum(["imported_history", "profile_recent_window"]),
  historyStatus: z.enum(["unknown", "not_started", "running", "completed", "failed"]),
  unavailable: integer.refine((n) => n >= 0).nullable(),
  intervalCoverage: z.literal("unproven"),
});
const snapshotSchema = z.object({
  id: id.optional(),
  queue: z.enum(RANKED_QUEUES),
  timestamp: instant,
  tier: z.string(),
  division: z.string(),
  leaguePoints: integer,
  wins: integer,
  losses: integer,
});
const matchSchema = z.object({
  matchId: id,
  queueId: positive.refine((v) => Object.hasOwn(STANDARD_QUEUES, v)),
  timestamp: instant,
  win: z.boolean().nullable(),
  isRemake: z.boolean().nullable(),
  championId: positive.nullable(),
});
const version = z.literal(ACHIEVEMENT_RULE_VERSION);
export const resurrectionRuleSchema = z.object({
  version,
  minDropLp: positive,
  maxRecoveryMs: positive,
  // A configurable rule can be stricter, never weaken the existing comparability boundary.
  maxGapMs: positive.refine((v) => v <= MAX_RANK_INTERVAL_MS),
});
export const unstoppableRuleSchema = z.object({ version, minWins: positive });
export const otpRuleSchema = z.object({
  version,
  minGames: positive,
  minShare: z
    .object({ numerator: positive, denominator: positive })
    .refine((r) => r.numerator <= r.denominator),
});
const rankInputSchema = z.object({ scope: scopeSchema, snapshots: z.array(snapshotSchema) });
const matchInputSchema = z.object({
  scope: scopeSchema,
  matches: z.array(matchSchema),
  coverage: coverageSchema,
});
type Parsed<T> = { ok: true; value: T } | { ok: false; reasons: AchievementReason[] };
function invalidReasons(error: z.ZodError): AchievementReason[] {
  const reasons: AchievementReason[] = ["invalid_input"];
  for (const issue of error.issues) {
    const field = issue.path.at(-1);
    if (["timestamp", "startAt", "endAt", "asOf"].includes(String(field)))
      reasons.push("invalid_timestamp");
    if (issue.path[0] === "scope")
      reasons.push(field === "view" ? "unsupported_view" : "invalid_scope");
    if (field === "championId") reasons.push("invalid_champion");
    if (["tier", "division", "leaguePoints", "wins", "losses"].includes(String(field)))
      reasons.push("invalid_rank");
    if (field === "queueId" || field === "queue") reasons.push("unknown_queue");
  }
  return reasons;
}
export function parseRankInput(input: unknown): Parsed<RankEvaluationInput> {
  const p = rankInputSchema.safeParse(input);
  return p.success ? { ok: true, value: p.data } : { ok: false, reasons: invalidReasons(p.error) };
}
export function parseMatchInput(input: unknown): Parsed<MatchEvaluationInput> {
  const p = matchInputSchema.safeParse(input);
  return p.success ? { ok: true, value: p.data } : { ok: false, reasons: invalidReasons(p.error) };
}
export function scopeBounds(scope: AchievementScope) {
  return {
    start: Date.parse(scope.season.startAt),
    end: Math.min(
      Date.parse(scope.asOf),
      scope.season.endAt === null ? Infinity : Date.parse(scope.season.endAt),
    ),
  };
}
export function scopeQueue(scope: AchievementScope) {
  return rankedQueue(scope.view)!;
}
export function scopeQueueId(scope: AchievementScope) {
  return queueIds(scope.view)[0];
}
/** Canonical UTC ordering without rewriting the timestamps returned as evidence. */
export function chronological<T extends { timestamp: string }>(a: T, b: T) {
  return Date.parse(a.timestamp) - Date.parse(b.timestamp);
}
export function compareId(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
