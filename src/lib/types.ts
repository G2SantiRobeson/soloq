import type { Platform } from "./routing";
import type { Rank } from "./ranking";
import type { Totals } from "./stats";
import type { LpMetrics, RankSnapshot } from "./lp-metrics";
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
  observedAt: string;
  createdAt: string;
  rank: Rank | null;
  stats: Totals;
  recent: RecentChampionMatch[];
  momentum: LpMetrics | null;
};
export type ChampionStats = Totals & { champion: string; championId: number };
export type PlayerProfile = Omit<PublicPlayer, "recent"> & {
  recent: RecentMatch[];
  champions: ChampionStats[];
  history: RankSnapshot[];
};
