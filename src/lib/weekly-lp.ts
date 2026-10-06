import { rankProgress } from "./ranking";
import type { RankSnapshot } from "./lp-metrics";
import { weekStart } from "./time";

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
