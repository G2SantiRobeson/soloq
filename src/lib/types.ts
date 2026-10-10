import type { Platform } from "./routing";
import type { Rank } from "./ranking";
import type { Totals } from "./stats";
import type { FiveMatchLp, LpMetrics, RankSnapshot } from "./lp-metrics";
import type { WeeklyLp } from "./weekly-lp";
import type { HistoryStatus } from "./season";
import type { PerformancePoint, LpObservation } from "./history";
export type RecentChampionMatch = Pick<
  RecentMatch,
  "matchId" | "champion" | "championId" | "win" | "isRemake"
>;
export type RecentMatch = {
  matchId: string;
  queueId: number;
  timestamp: string;
  champion: string;
  championId: number;
  position: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  duration: number;
  damage: number;
  win: boolean;
  isRemake?: boolean | null;
  killParticipation: number | null;
};
export type PublicPlayer = {
  id: string;
  gameName: string;
  tagLine: string;
  platform: Platform;
  profileIconId: number | null;
  lastSyncedAt: string | null;
  /** Player-wide LEAGUE-V4 verification, not a per-queue snapshot or match coverage. */
  rankCheckedAt?: string | null;
  observedAt: string;
  createdAt: string;
  rank: Rank | null;
  stats: Totals;
  recent: RecentChampionMatch[];
  momentum: LpMetrics | null;
  weeklyLp?: number | null;
  weeklySummary?: WeeklyLp | null;
  lastFiveLp?: FiveMatchLp;
  seasonHistory?: HistoryStatus;
};
export type ChampionStats = Totals & { champion: string; championId: number };
export type PlayerProfile = Omit<PublicPlayer, "recent"> & {
  recent: RecentMatch[];
  champions: ChampionStats[];
  history: RankSnapshot[];
  performance: PerformancePoint[];
  trackingSince: string | null;
  lpObservations: LpObservation[];
};
