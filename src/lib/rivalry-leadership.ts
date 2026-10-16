import { LP_WINDOW, observedRankInterval, type RankSnapshot } from "./lp-metrics";
import { rankedQueue, type View } from "./queues";
import { TIERS, type Tier } from "./ranking";
import { PLATFORMS } from "./routing";
import { seasonEnd } from "./season";
import type { PublicPlayer } from "./types";

export const RIVALRY_HISTORY_LIMIT = LP_WINDOW;
export const RIVALRY_OBSERVATION_TOLERANCE_MS = 30 * 60_000;
type HistoryPlayer = Pick<PublicPlayer, "id" | "platform" | "rank" | "rivalryHistory">;
export type LeadershipCut = {
  /** Original observations in the order of the two input players. */
  observations: readonly [RankSnapshot, RankSnapshot];
  from: string;
  to: string;
  leaderId: string;
};
export type LeadershipChange = { before: LeadershipCut; after: LeadershipCut };

function utcTime(timestamp: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(timestamp)) return NaN;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 19) === timestamp.slice(0, 19)
    ? time
    : NaN;
}
/** Conservative observation comparison, not the exact instant or cause of an overtake.
 * Validates the entire bounded input without sorting, interpolating or repairing it.
 * Greedily pairs newest observations within tolerance; unmatched observations are skipped.
 * Each earlier cut finishes strictly before the next begins; no observation is reused.
 * Returns newest first; ties have no leader. The current-event detector still uses two cuts.
 */
export function observedLeadershipCuts(
  first: HistoryPlayer,
  second: HistoryPlayer,
  view: View,
  {
    asOf,
    toleranceMs = RIVALRY_OBSERVATION_TOLERANCE_MS,
    historyLimit = RIVALRY_HISTORY_LIMIT,
  }: { asOf: string; toleranceMs?: number; historyLimit?: number },
): readonly LeadershipCut[] | null {
  const queue = rankedQueue(view),
    now = utcTime(asOf);
  if (
    !Number.isSafeInteger(historyLimit) ||
    historyLimit < 2 ||
    historyLimit > 1024 ||
    !queue ||
    !Number.isFinite(now) ||
    !Number.isSafeInteger(toleranceMs) ||
    toleranceMs < 0 ||
    !first.id ||
    first.id === second.id ||
    !second.id ||
    first.platform !== second.platform ||
    !PLATFORMS.includes(first.platform) ||
    !first.rank ||
    !second.rank ||
    first.rank.tier !== second.rank.tier ||
    first.rank.division !== second.rank.division
  )
    return null;
  const a = first.rivalryHistory ?? [],
    b = second.rivalryHistory ?? [];
  const end = seasonEnd()?.getTime() ?? Infinity;
  for (const [player, points] of [
    [first, a],
    [second, b],
  ] as const) {
    if (
      points.length < 2 ||
      points.length > historyLimit ||
      !observedRankInterval([...points], player.platform, new Date(now), queue) ||
      points.some(
        (p) =>
          !Number.isFinite(utcTime(p.timestamp)) ||
          ![p.leaguePoints, p.wins, p.losses].every(Number.isSafeInteger) ||
          Date.parse(p.timestamp) >= end ||
          p.tier !== first.rank!.tier ||
          p.division !== first.rank!.division ||
          (TIERS.indexOf(p.tier as Tier) < 7
            ? p.leaguePoints >= 100
            : !["I", ""].includes(p.division)),
      )
    )
      return null;
    const last = points.at(-1)!;
    const current = player.rank!;
    if (
      last.tier !== current.tier ||
      last.division !== current.division ||
      last.leaguePoints !== current.leaguePoints ||
      last.wins !== current.wins ||
      last.losses !== current.losses
    )
      return null;
  }
  const cuts: {
    observations: readonly [RankSnapshot, RankSnapshot];
    from: string;
    to: string;
    difference: number;
  }[] = [];
  let i = a.length - 1,
    j = b.length - 1,
    boundary = Infinity;
  while (i >= 0 && j >= 0) {
    const ta = Date.parse(a[i].timestamp),
      tb = Date.parse(b[j].timestamp);
    if (ta >= boundary) {
      i--;
      continue;
    }
    if (tb >= boundary) {
      j--;
      continue;
    }
    if (Math.abs(ta - tb) > toleranceMs) {
      if (ta > tb) i--;
      else j--;
      continue;
    }
    cuts.push({
      observations: [a[i], b[j]],
      from: ta <= tb ? a[i].timestamp : b[j].timestamp,
      to: ta >= tb ? a[i].timestamp : b[j].timestamp,
      difference: a[i].leaguePoints - b[j].leaguePoints,
    });
    boundary = Math.min(ta, tb);
    i--;
    j--;
  }
  return cuts.map((value) => ({
    observations: value.observations,
    from: value.from,
    to: value.to,
    leaderId: value.difference === 0 ? "" : value.difference > 0 ? first.id : second.id,
  }));
}

/** Only the newest two cuts count for the existing current-event UI. */
export function detectLeadershipChange(
  first: HistoryPlayer,
  second: HistoryPlayer,
  view: View,
  options: { asOf: string; toleranceMs?: number },
): LeadershipChange | null {
  const cuts = observedLeadershipCuts(first, second, view, options);
  if (!cuts || cuts.length < 2) return null;
  const [after, before] = cuts;
  if (!before.leaderId || !after.leaderId || before.leaderId === after.leaderId) return null;
  return { before, after };
}
