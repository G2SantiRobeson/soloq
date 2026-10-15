import { observedLeadershipCuts, type LeadershipChange } from "./rivalry-leadership";
import { selectRivalries, type Rivalry } from "./rivalries";
import { rankedQueue, type View } from "./queues";
import { weekStart } from "./time";

export const WEEKLY_RIVALRY_HISTORY_LIMIT = 1024;
export const rivalryKey = (rivalry: { players: readonly [{ id: string }, { id: string }] }) =>
  JSON.stringify(rivalry.players.map((p) => p.id).sort());
export type WeeklyRivalry = { rivalry: Rivalry; change: LeadershipChange; weekStartedAt: string };

/** Calendar week in Santiago; choose only among the currently visible ordinary rivalries.
 * Uses bounded stored observations, so missing/truncated history can hide a candidate.
 * Most recent observed interval end wins, then comparable current LP gap, then stable IDs.
 * This is an algorithmic recognition, not an official Riot award or a head-to-head win.
 */
export function selectWeeklyRivalry(
  rivalries: readonly Rivalry[],
  view: View,
  { asOf }: { asOf: string },
): WeeklyRivalry | null {
  const now = Date.parse(asOf),
    queue = rankedQueue(view);
  if (!queue || !Number.isFinite(now)) return null;
  const monday = weekStart(new Date(now)).getTime();
  const candidates: WeeklyRivalry[] = [];
  const seen = new Set<string>();
  for (const rivalry of rivalries) {
    const key = rivalryKey(rivalry);
    if (seen.has(key) || rivalry.queue !== queue) continue;
    seen.add(key);
    const eligible = selectRivalries(rivalry.players, view)[0];
    if (!eligible || rivalryKey(eligible) !== key) continue;
    if (rivalry.players.some((p) => p.weeklyRivalryHistoryComplete === false)) return null;
    const historyPlayers = rivalry.players.map((p) => ({
      ...p,
      rivalryHistory: p.weeklyRivalryHistory ?? p.rivalryHistory,
    })) as [(typeof rivalry.players)[0], (typeof rivalry.players)[1]];
    const cuts = observedLeadershipCuts(...historyPlayers, view, {
      asOf,
      historyLimit: WEEKLY_RIVALRY_HISTORY_LIMIT,
    });
    if (!cuts) continue;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const after = cuts[i],
        before = cuts[i + 1];
      if (!before.leaderId || !after.leaderId || before.leaderId === after.leaderId) continue;
      if (Date.parse(before.from) < monday || Date.parse(after.to) > now) continue;
      candidates.push({
        rivalry,
        change: { before, after },
        weekStartedAt: new Date(monday).toISOString(),
      });
      break;
    }
  }
  const gap = (item: WeeklyRivalry) =>
    item.rivalry.players[0].rank.tier === item.rivalry.players[1].rank.tier &&
    item.rivalry.players[0].rank.division === item.rivalry.players[1].rank.division
      ? Math.abs(
          item.rivalry.players[0].rank.leaguePoints - item.rivalry.players[1].rank.leaguePoints,
        )
      : Infinity;
  candidates.sort((a, b) => {
    const time = Date.parse(b.change.after.to) - Date.parse(a.change.after.to);
    if (time) return time;
    const distance = gap(a) - gap(b);
    if (distance) return distance;
    const one = rivalryKey(a.rivalry),
      two = rivalryKey(b.rivalry);
    return one < two ? -1 : one > two ? 1 : 0;
  });
  return candidates[0] ?? null;
}
