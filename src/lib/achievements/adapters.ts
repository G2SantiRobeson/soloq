import type { RankSnapshot } from "../lp-metrics";
import type { RankedQueue } from "../queues";
import type { Platform } from "../routing";
import { CURRENT_SEASON, seasonEnd, seasonStart, type HistoryStatus } from "../season";
import type { RecentMatch } from "../types";
import type {
  AchievementCoverage,
  AchievementMatch,
  AchievementScope,
  AchievementSnapshot,
  RankedAchievementView,
} from "./types";

/** Requires an explicit clock and platform; no universal UTC season boundary. */
export function currentAchievementScope(
  view: RankedAchievementView,
  platform: Platform,
  asOf: string,
): AchievementScope {
  return {
    view,
    platform,
    season: {
      id: CURRENT_SEASON.id,
      startAt: seasonStart(platform).toISOString(),
      endAt: seasonEnd()?.toISOString() ?? null,
    },
    asOf,
  };
}
/** Caller explicitly supplies a queue when the public snapshot lacks it; never silently infer it. */
export function snapshotInput(
  snapshot: RankSnapshot & { id?: string },
  queue: RankedQueue,
): AchievementSnapshot {
  return {
    ...(snapshot.id === undefined ? {} : { id: snapshot.id }),
    queue: snapshot.queue ?? queue,
    timestamp: snapshot.timestamp,
    tier: snapshot.tier,
    division: snapshot.division,
    leaguePoints: snapshot.leaguePoints,
    wins: snapshot.wins,
    losses: snapshot.losses,
  };
}
export function matchInput(match: RecentMatch): AchievementMatch {
  return {
    matchId: match.matchId,
    queueId: match.queueId,
    timestamp: match.timestamp,
    win: match.win,
    championId: match.championId,
    isRemake: match.isRemake ?? null,
  };
}
/** Backfill summaries convey diagnostics only. completed does not manufacture a certificate. */
export function historyCoverage(
  history: HistoryStatus | undefined,
  season: string,
  source: AchievementCoverage["source"],
): AchievementCoverage {
  const sameSeason = history?.season === season;
  return {
    source,
    historyStatus: sameSeason ? history.status : "unknown",
    unavailable: sameSeason ? history.unavailable : null,
    intervalCoverage: "unproven",
  };
}
