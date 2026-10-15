import "server-only";
import { z } from "zod";
import {
  currentAchievementScope,
  evaluateOtpSpecialist,
  evaluateResurrection,
  evaluateUnstoppable,
  type AchievementEvaluation,
  type AchievementScope,
} from "@/lib/achievements";
import { PLATFORMS } from "@/lib/routing";
import { CURRENT_SEASON } from "@/lib/season";
import type {
  AchievementCoverageContext,
  AchievementPlayerContext,
  AchievementReader,
} from "./contracts";
import { reportAchievementFailure } from "./errors";

const requestSchema = z.object({
  playerId: z.uuid(),
  view: z.enum(["soloq", "flex", "5v5"]),
  season: z.literal(CURRENT_SEASON.id),
  asOf: z.iso.datetime({ offset: true }),
});
export const parseAchievementRequest = (request: unknown) => requestSchema.safeParse(request);
const playerSchema = z.object({
  id: z.uuid(),
  platform: z.enum(PLATFORMS),
  enabled: z.boolean(),
  backfillSeason: z.string().nullable(),
  backfillStatus: z.enum(["not_started", "running", "completed", "failed"]),
  backfillProcessed: z.number().int().nonnegative(),
  backfillDiscovered: z.number().int().nonnegative(),
  backfillUnavailable: z.number().int().nonnegative(),
  lastSyncedAt: z.date().nullable(),
  rankCheckedAt: z.date().nullable(),
});
export type AchievementReadResult =
  | {
      status: "available";
      source: "stored_official" | "fictitious";
      scope: AchievementScope;
      coverage: AchievementCoverageContext;
      evaluations: AchievementEvaluation[];
    }
  | {
      status:
        | "invalid_request"
        | "not_found"
        | "ineligible"
        | "not_applicable"
        | "unavailable"
        | "invalid_data";
    };

export function coverageContext(
  player: AchievementPlayerContext,
  scope: AchievementScope,
  storedMatches: number,
  storedSnapshots: number,
): AchievementCoverageContext {
  const sameSeason = player.backfillSeason === scope.season.id;
  return {
    availability: !sameSeason
      ? "unknown"
      : player.backfillStatus === "completed" &&
          player.backfillUnavailable === 0 &&
          player.backfillProcessed === player.backfillDiscovered
        ? "available"
        : "partial",
    historyStatus: sameSeason ? player.backfillStatus : "unknown",
    importCounters: sameSeason
      ? {
          processed: player.backfillProcessed,
          discovered: player.backfillDiscovered,
          unavailable: player.backfillUnavailable,
        }
      : null,
    counterScope: "player_all_imported_queues",
    recentCoveredUntil: player.lastSyncedAt?.toISOString() ?? null,
    rankCheckedAt: player.rankCheckedAt?.toISOString() ?? null,
    storedMatches,
    storedSnapshots,
    intervalCoverage: "unproven",
  };
}

/** Three reads per player/queue, regardless of history length. All errors are sanitized. */
export async function evaluateStoredAchievements(
  reader: AchievementReader,
  request: unknown,
  source: "stored_official" | "fictitious" = "stored_official",
): Promise<AchievementReadResult> {
  const parsed = parseAchievementRequest(request);
  if (!parsed.success) return { status: "invalid_request" };
  if (parsed.data.view === "5v5") return { status: "not_applicable" };
  const view = parsed.data.view;
  const materialize = async (snapshotReader: AchievementReader) => {
    const row = await snapshotReader.player(parsed.data.playerId);
    if (!row) return { status: "not_found" as const };
    const player = playerSchema.safeParse(row);
    if (!player.success || player.data.id !== parsed.data.playerId)
      return { status: "invalid_data" as const };
    if (!player.data.enabled) return { status: "ineligible" as const };
    const scope = currentAchievementScope(view, player.data.platform, parsed.data.asOf);
    if (Date.parse(scope.asOf) <= Date.parse(scope.season.startAt))
      return { status: "invalid_request" as const };
    const records = await snapshotReader.records(player.data, scope);
    return { status: "ready" as const, player: player.data, scope, records };
  };
  let materialized: Awaited<ReturnType<typeof materialize>>;
  try {
    materialized = await (reader.snapshot ? reader.snapshot(materialize) : materialize(reader));
  } catch (error) {
    const kind = reportAchievementFailure("read", error);
    return { status: kind === "invalid_data" ? "invalid_data" : "unavailable" };
  }
  if (materialized.status !== "ready") return materialized;
  // The transaction has committed before CPU work, serialization or component rendering.
  const { player, scope, records } = materialized;
  try {
    const coverage = coverageContext(
      player,
      scope,
      records.matches.length,
      records.snapshots.length,
    );
    const matchInput = {
      scope,
      matches: records.matches,
      coverage: {
        source: "imported_history",
        historyStatus: coverage.historyStatus,
        unavailable: coverage.importCounters?.unavailable ?? null,
        intervalCoverage: "unproven",
      },
    };
    return {
      status: "available",
      source,
      scope,
      coverage,
      evaluations: [
        evaluateResurrection({ scope, snapshots: records.snapshots }),
        evaluateUnstoppable(matchInput),
        evaluateOtpSpecialist(matchInput),
      ],
    };
  } catch (error) {
    reportAchievementFailure("evaluate", error);
    return { status: "unavailable" };
  }
}
