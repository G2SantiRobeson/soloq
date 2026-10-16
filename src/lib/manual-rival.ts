import type { RivalIdentity } from "./nearest-rival";
import { normalizedRivalIds } from "./shared-rivalry";
import { hasRivalRank } from "./rivalries";
import { rankSortValue, rankProgress, TIERS } from "./ranking";
export type ManualRivalContext = {
  available: boolean;
  demo: boolean;
  selectedId: string | null;
  candidates: RivalIdentity[];
};
export function validManualChoice(player: RivalIdentity, rival: RivalIdentity | undefined) {
  return (
    !!rival && !!normalizedRivalIds([player.id, rival.id]) && player.platform === rival.platform
  );
}
export function manualComparison(a: RivalIdentity, b: RivalIdentity) {
  if (!hasRivalRank(a) || !hasRivalRank(b)) return { leaderId: null, gap: null };
  if (
    a.platform !== b.platform ||
    !Number.isSafeInteger(a.rank.leaguePoints) ||
    !Number.isSafeInteger(b.rank.leaguePoints)
  )
    return { leaderId: null, gap: null };
  const tierOrder =
    TIERS.indexOf(a.rank.tier as (typeof TIERS)[number]) -
    TIERS.indexOf(b.rank.tier as (typeof TIERS)[number]);
  const order =
    tierOrder ||
    (TIERS.indexOf(a.rank.tier as (typeof TIERS)[number]) >= 7
      ? a.rank.leaguePoints - b.rank.leaguePoints
      : rankSortValue(a.rank) - rankSortValue(b.rank));
  const comparable =
    (TIERS.indexOf(a.rank.tier as (typeof TIERS)[number]) >= 7 &&
      TIERS.indexOf(b.rank.tier as (typeof TIERS)[number]) >= 7) ||
    (a.rank.tier === b.rank.tier &&
      (TIERS.indexOf(a.rank.tier as (typeof TIERS)[number]) >= 7 ||
        a.rank.division === b.rank.division));
  return {
    leaderId: order === 0 ? null : order > 0 ? a.id : b.id,
    gap: comparable ? Math.abs(a.rank.leaguePoints - b.rank.leaguePoints) : null,
  };
}

/** Nominal 100 points/division scale, not actual LP required or gained. Apex categories are excluded. */
export function equivalentLpDistance(a: RivalIdentity, b: RivalIdentity): number | null {
  if (
    a.platform !== b.platform ||
    !hasRivalRank(a) ||
    !hasRivalRank(b) ||
    manualComparison(a, b).gap !== null
  )
    return null;
  if (
    TIERS.indexOf(a.rank.tier as (typeof TIERS)[number]) >= 7 ||
    TIERS.indexOf(b.rank.tier as (typeof TIERS)[number]) >= 7
  )
    return null;
  const left = rankProgress(a.rank),
    right = rankProgress(b.rank);
  return left === null || right === null ? null : Math.abs(left - right);
}
