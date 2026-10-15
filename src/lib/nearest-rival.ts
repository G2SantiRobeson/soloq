import { hasRivalRank, rivalProximity, type Rivalry } from "./rivalries";
import { rankSortValue, type Rank } from "./ranking";
import { rankedQueue, type View } from "./queues";
import type { PublicPlayer } from "./types";
export type RivalIdentity = Pick<
  PublicPlayer,
  "id" | "gameName" | "tagLine" | "platform" | "profileIconId" | "rank" | "observedAt"
>;
export type NearestRival = {
  player: RivalIdentity & { rank: Rank };
  rival: RivalIdentity & { rank: Rank };
  pair: Rivalry<RivalIdentity>;
  relation: "ahead" | "behind" | "tied";
};
/** Only immediate official ladder neighbours, with the same proximity rules.
 * Individual selection is independent of the public maximum of three disjoint pairs.
 */
export function selectNearestRival(
  players: readonly RivalIdentity[],
  playerId: string,
  view: View,
): NearestRival | null {
  if (!rankedQueue(view)) return null;
  const counts = new Map<string, number>();
  for (const p of players) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  const target = players.find((p) => p.id === playerId);
  if (!target || counts.get(playerId) !== 1 || !hasRivalRank(target)) return null;
  const ordered = players
    .filter(
      (p): p is RivalIdentity & { rank: Rank } =>
        p.platform === target.platform && counts.get(p.id) === 1 && hasRivalRank(p),
    )
    .sort(
      (a, b) =>
        rankSortValue(b.rank) - rankSortValue(a.rank) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const index = ordered.findIndex((p) => p.id === playerId);
  const candidates = [ordered[index - 1], ordered[index + 1]]
    .filter((p) => !!p)
    .map((rival) => ({ rival, proximity: rivalProximity(target, rival, view) }))
    .filter((item) => item.proximity !== null);
  candidates.sort(
    (a, b) =>
      a.proximity!.proximityScore - b.proximity!.proximityScore ||
      (a.rival.id < b.rival.id ? -1 : a.rival.id > b.rival.id ? 1 : 0),
  );
  const chosen = candidates[0];
  if (!chosen) return null;
  const { rival, proximity } = chosen,
    difference = rankSortValue(rival.rank) - rankSortValue(target.rank);
  return {
    player: target,
    rival,
    pair: {
      players: [target, rival],
      queue: proximity!.queue,
      proximity: proximity!.proximity,
      lpDifference: proximity!.lpDifference,
    },
    relation: difference === 0 ? "tied" : difference > 0 ? "ahead" : "behind",
  };
}
