import { observedLeadershipCuts } from "./rivalry-leadership";
import { classifyRivalryInterval, type RivalryEvent } from "./rivalry-dynamics";
import { selectRivalries, type Rivalry } from "./rivalries";
import { rankedQueue, type View } from "./queues";
import { weekStart } from "./time";
import { WEEKLY_RIVALRY_HISTORY_LIMIT } from "./weekly-rivalry";
export const MAX_RIVALRY_EVENTS = 5;
export const rivalryEventKey = (e: RivalryEvent) =>
  JSON.stringify([
    e.kind,
    e.before.leaderId,
    e.after.leaderId,
    [...e.before.observations.map((p) => p.timestamp)].sort(),
    [...e.after.observations.map((p) => p.timestamp)].sort(),
  ]);
/** Observed activity of this selected pair, not a persistent rivalry archive.
 * Consecutive changes in one direction form an interval; neutral cuts break a run.
 * Original observations are retained without interpolation or repair.
 */
export function rivalryTimeline(
  rivalry: Rivalry,
  view: View,
  { asOf, limit = MAX_RIVALRY_EVENTS }: { asOf: string; limit?: number },
): RivalryEvent[] {
  const now = Date.parse(asOf);
  if (
    !Number.isFinite(now) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_RIVALRY_EVENTS ||
    rivalry.queue !== rankedQueue(view) ||
    !selectRivalries(rivalry.players, view).length ||
    rivalry.players.some((p) => p.weeklyRivalryHistoryComplete === false)
  )
    return [];
  const [a, b] = rivalry.players;
  const input = (p: typeof a) => ({
    ...p,
    rivalryHistory: p.weeklyRivalryHistory ?? p.rivalryHistory,
  });
  const cuts = observedLeadershipCuts(input(a), input(b), view, {
    asOf,
    historyLimit: WEEKLY_RIVALRY_HISTORY_LIMIT,
  });
  if (!cuts) return [];
  const start = weekStart(new Date(now)).getTime(),
    events: RivalryEvent[] = [];
  for (let i = cuts.length - 1; i > 0; i--) {
    const before = cuts[i],
      after = cuts[i - 1];
    if (Date.parse(before.from) < start || Date.parse(after.to) > now) continue;
    const event = classifyRivalryInterval(before, after);
    if (!event) continue;
    const previous = events.at(-1);
    if (
      previous &&
      previous.kind === event.kind &&
      ["approaching", "separating"].includes(event.kind) &&
      previous.after === event.before &&
      previous.after.leaderId === event.after.leaderId
    ) {
      events[events.length - 1] = {
        ...event,
        before: previous.before,
        previousGap: previous.previousGap,
      };
    } else events.push(event);
  }
  const seen = new Set<string>();
  return events
    .toReversed()
    .filter((e) => {
      const key = rivalryEventKey(e);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
