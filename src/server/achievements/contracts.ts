import "server-only";
import type { AchievementMatch, AchievementScope, AchievementSnapshot } from "@/lib/achievements";
import type { Platform } from "@/lib/routing";
import type { HistoryStatus } from "@/lib/season";

/** Only internal identity and diagnostic metadata, never credentials or PUUID. */
export type AchievementPlayerContext = {
  id: string;
  platform: Platform;
  enabled: boolean;
  backfillSeason: string | null;
  backfillStatus: HistoryStatus["status"];
  backfillProcessed: number;
  backfillDiscovered: number;
  backfillUnavailable: number;
  lastSyncedAt: Date | null;
  rankCheckedAt: Date | null;
};
export type AchievementCoverageContext = {
  availability: "available" | "partial" | "unknown";
  historyStatus: HistoryStatus["status"] | "unknown";
  /** Player-wide import counters; not ranked-queue totals or season percentages. */
  importCounters: { processed: number; discovered: number; unavailable: number } | null;
  counterScope: "player_all_imported_queues";
  recentCoveredUntil: string | null;
  rankCheckedAt: string | null;
  storedMatches: number;
  storedSnapshots: number;
  intervalCoverage: "unproven";
};
export type AchievementRecords = {
  snapshots: AchievementSnapshot[];
  matches: AchievementMatch[];
};
/** Implementations are server-owned. Never construct this from browser evidence. */
export interface AchievementReader {
  player(id: string): Promise<AchievementPlayerContext | undefined>;
  records(player: AchievementPlayerContext, scope: AchievementScope): Promise<AchievementRecords>;
}
