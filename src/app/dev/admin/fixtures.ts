import type { AdminPlayer } from "@/lib/admin-sync";
import { CURRENT_SEASON, seasonStart, type HistoryStatus } from "@/lib/season";

// Synthetic data for development QA and rendering tests; never read from Neon.
export function adminFixture(
  index: number,
  status: HistoryStatus["status"],
  enabled = true,
): AdminPlayer {
  const discovered = status === "not_started" ? 0 : 205;
  const processed = status === "completed" ? 205 : status === "not_started" ? 0 : 75;
  const unavailable = status === "completed" ? 1 : 0;
  return {
    id: `fixture-${index}`,
    gameName: `Jugador ${status}`,
    tagLine: "DEMO",
    platform: "LA2",
    enabled,
    lastSyncedAt: null,
    syncError: null,
    legacyError: null,
    backfillSeason: CURRENT_SEASON.id,
    backfillStatus: status,
    backfillDiscovered: discovered,
    backfillProcessed: processed,
    backfillUnavailable: unavailable,
    syncState: {
      rank: { checkedAt: null, error: null },
      recent: { coveredThrough: null, lastIdsResponseAt: null, error: null },
      lastAttempt: null,
      history: {
        season: CURRENT_SEASON.id,
        status,
        discovered,
        processed,
        unavailable,
        completedAt: null,
        updatedAt: null,
        error: null,
        cursor: {
          season: CURRENT_SEASON.id,
          from: seasonStart("LA2").toISOString(),
          through: null,
          offset: 0,
          pending: 0,
          exhausted: status === "completed",
        },
      },
    },
  };
}
