import { rankProgress, rankSortValue, TIERS, type Rank, type Tier } from "./ranking";
import { rankedQueue, type RankedQueue, type View } from "./queues";
import { PLATFORMS } from "./routing";
import type { PublicPlayer } from "./types";

export const RIVALRY_LP_THRESHOLD = 35;
export const MAX_RIVALRIES = 3;
const DIVISIONS = ["IV", "III", "II", "I"] as const;
export type RivalRankInput = Pick<PublicPlayer, "id" | "platform" | "rank">;
type RankedPlayer<P extends RivalRankInput> = P & { rank: Rank };
export type Rivalry<P extends RivalRankInput = PublicPlayer> = {
  players: readonly [RankedPlayer<P>, RankedPlayer<P>];
  queue: RankedQueue;
  proximity: "same-rank" | "adjacent-divisions";
  /** Current LP difference only within the same official tier/division. Never a historical delta. */
  lpDifference: number | null;
};

export function hasRivalRank<P extends RivalRankInput>(player: P): player is RankedPlayer<P> {
  const rank = player.rank;
  if (!rank || !player.id || !PLATFORMS.includes(player.platform)) return false;
  const tier = TIERS.indexOf(rank.tier as Tier);
  return (
    tier >= 0 &&
    Number.isInteger(rank.leaguePoints) &&
    rank.leaguePoints >= 0 &&
    (tier < 7
      ? rank.leaguePoints < 100 && DIVISIONS.includes(rank.division as (typeof DIVISIONS)[number])
      : rank.division === "I" || rank.division === "")
  );
}
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Players must come from the leaderboard query for `view`; PublicPlayer.rank is queue-specific.
 * Only adjacent players in each platform's official ladder are considered. UI sorting does not
 * affect selection. No Match-V5 data, MMR estimates or additional queries are used.
 */
export function eligibleRivalPairs<P extends RivalRankInput>(
  players: readonly P[],
  view: View,
  { lpThreshold = RIVALRY_LP_THRESHOLD }: { lpThreshold?: number } = {},
): Rivalry<P>[] {
  const queue = rankedQueue(view);
  if (!queue || !Number.isInteger(lpThreshold) || lpThreshold < 0) return [];
  const idCounts = new Map<string, number>();
  for (const player of players) idCounts.set(player.id, (idCounts.get(player.id) ?? 0) + 1);
  const ordered = players
    .filter((p): p is RankedPlayer<P> => hasRivalRank(p) && idCounts.get(p.id) === 1)
    .sort((a, b) => rankSortValue(b.rank) - rankSortValue(a.rank) || compareId(a.id, b.id));
  const platforms = new Map<string, RankedPlayer<P>[]>();
  for (const player of ordered) {
    const group = platforms.get(player.platform) ?? [];
    group.push(player);
    platforms.set(player.platform, group);
  }
  const candidates: { rivalry: Rivalry<P>; proximityScore: number }[] = [];
  for (const group of platforms.values()) {
    for (let i = 0; i + 1 < group.length; i++) {
      const first = group[i],
        second = group[i + 1];
      const proximity = rivalProximity(first, second, view, { lpThreshold });
      if (!proximity) continue;
      candidates.push({
        rivalry: {
          players: [first, second],
          queue: proximity.queue,
          proximity: proximity.proximity,
          lpDifference: proximity.lpDifference,
        },
        proximityScore: proximity.proximityScore,
      });
    }
  }
  candidates.sort(
    (a, b) =>
      a.proximityScore - b.proximityScore ||
      rankSortValue(b.rivalry.players[0].rank) - rankSortValue(a.rivalry.players[0].rank) ||
      compareId(a.rivalry.players[0].id, b.rivalry.players[0].id) ||
      compareId(a.rivalry.players[1].id, b.rivalry.players[1].id),
  );
  return candidates.map((candidate) => candidate.rivalry);
}

/** Existing public selection: at most three disjoint pairs in the same priority order. */
export function selectRivalries<P extends RivalRankInput>(
  players: readonly P[],
  view: View,
  options: { lpThreshold?: number } = {},
): Rivalry<P>[] {
  const candidates = eligibleRivalPairs(players, view, options);
  const used = new Set<string>();
  const selected: Rivalry<P>[] = [];
  for (const rivalry of candidates) {
    if (rivalry.players.some((player) => used.has(player.id))) continue;
    selected.push(rivalry);
    for (const player of rivalry.players) used.add(player.id);
    if (selected.length === MAX_RIVALRIES) break;
  }
  return selected;
}

/** Shared current-rank rules for public pairs and individual profile rivals. */
export function rivalProximity(
  first: RivalRankInput,
  second: RivalRankInput,
  view: View,
  { lpThreshold = RIVALRY_LP_THRESHOLD }: { lpThreshold?: number } = {},
) {
  const queue = rankedQueue(view);
  if (
    !queue ||
    !Number.isInteger(lpThreshold) ||
    lpThreshold < 0 ||
    !hasRivalRank(first) ||
    !hasRivalRank(second) ||
    first.id === second.id ||
    first.platform !== second.platform
  )
    return null;
  const a = first.rank,
    b = second.rank;
  if (a.tier !== b.tier) return null;
  const apex = TIERS.indexOf(a.tier as Tier) >= 7,
    sameRank = apex || a.division === b.division;
  if (
    !sameRank &&
    Math.abs(
      DIVISIONS.indexOf(a.division as (typeof DIVISIONS)[number]) -
        DIVISIONS.indexOf(b.division as (typeof DIVISIONS)[number]),
    ) !== 1
  )
    return null;
  const proximityScore = sameRank
    ? Math.abs(a.leaguePoints - b.leaguePoints)
    : Math.abs(rankProgress(a)! - rankProgress(b)!);
  if (proximityScore > lpThreshold) return null;
  return {
    queue,
    proximity: sameRank ? ("same-rank" as const) : ("adjacent-divisions" as const),
    lpDifference: sameRank ? proximityScore : null,
    proximityScore,
  };
}
