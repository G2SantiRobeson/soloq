import { rankProgress } from "./ranking";
import { observedRankInterval, type RankSnapshot } from "./lp-metrics";
import { weekStart } from "./time";
import { seasonStart } from "./season";
import type { Platform } from "./routing";
import type { RankedQueue } from "./queues";

export type WeeklyLp = {
  net: number;
  wins: number;
  losses: number;
  from: string;
  to: string;
  partial: boolean;
};
/** Same official interval for rank displacement and V/D; never synthesize Monday's rank. */
export function weeklyRankSummary(
  history: RankSnapshot[],
  now = new Date(),
  platform: Platform = "LA2",
  queue?: RankedQueue,
): WeeklyLp | null {
  const start = seasonStart(platform).getTime(),
    monday = weekStart(now).getTime();
  if (
    history.some(
      (s) => !Number.isFinite(Date.parse(s.timestamp)) || Date.parse(s.timestamp) > now.getTime(),
    )
  )
    return null;
  const points = history
    .filter((s) => Date.parse(s.timestamp) >= start && Date.parse(s.timestamp) <= now.getTime())
    .toSorted((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const valid = (s: RankSnapshot) =>
    rankProgress(s) !== null &&
    [s.wins, s.losses].every((n) => Number.isInteger(n) && n >= 0) &&
    (!queue || s.queue === queue);
  const before = points.findLastIndex((s) => Date.parse(s.timestamp) <= monday && valid(s));
  const reference =
    before >= 0 ? before : points.findIndex((s) => Date.parse(s.timestamp) > monday && valid(s));
  if (reference < 0 || !points.some((s) => Date.parse(s.timestamp) >= monday)) return null;
  const interval = observedRankInterval(points.slice(reference), platform, now, queue);
  return interval ? { ...interval, partial: before < 0 } : null;
}

/** Net displacement, not per-match LP rewards. No baseline means no invented value. */
export function weeklyRankDelta(
  baseline: RankSnapshot | null,
  latest: RankSnapshot | null,
  now = new Date(),
): number | null {
  if (!baseline || !latest) return null;
  const before = rankProgress(baseline),
    after = rankProgress(latest);
  const from = Date.parse(baseline.timestamp),
    to = Date.parse(latest.timestamp);
  if (
    before === null ||
    after === null ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from > weekStart(now).getTime() ||
    to < from ||
    to > now.getTime() ||
    ![baseline.wins, baseline.losses, latest.wins, latest.losses].every(
      (n) => Number.isInteger(n) && n >= 0,
    ) ||
    latest.wins < baseline.wins ||
    latest.losses < baseline.losses
  )
    return null;
  return after - before;
}
