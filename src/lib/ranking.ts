export const TIERS = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
] as const;
export type Tier = (typeof TIERS)[number];
export type Rank = {
  tier: string;
  division: string;
  leaguePoints: number;
  wins: number;
  losses: number;
};
const divisions: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 };
// Lexicographic weights for the official ladder only, never an MMR estimate.
export function rankSortValue(rank: Rank | null): number {
  if (!rank || rank.tier === "UNRANKED") return -1;
  const tier = TIERS.indexOf(rank.tier as Tier);
  if (tier < 0) return -1;
  return (
    tier * 1_000_000 + (tier < 7 ? (divisions[rank.division] ?? 0) * 10000 : 0) + rank.leaguePoints
  );
}
export function rankLabel(rank: Rank | null): string {
  if (!rank || rank.tier === "UNRANKED") return "Sin clasificar";
  return (
    rank.tier[0] +
    rank.tier.slice(1).toLowerCase() +
    (TIERS.indexOf(rank.tier as Tier) < 7 ? ` ${rank.division}` : "")
  );
}
// Internal position for differences; apex tiers share a continuous LP range.
export function rankProgress(rank: Rank) {
  const tier = TIERS.indexOf(rank.tier as Tier);
  return tier < 0 ||
    !Number.isInteger(rank.leaguePoints) ||
    rank.leaguePoints < 0 ||
    (tier < 7 && !(rank.division in divisions))
    ? null
    : tier >= 7
      ? 2800 + rank.leaguePoints
      : tier * 400 + (divisions[rank.division] ?? 0) * 100 + rank.leaguePoints;
}
// Ordered chart bands only. Never subtract these coordinates to compute LP deltas.
export function chartRankCoordinate(rank: Rank) {
  const tier = TIERS.indexOf(rank.tier as Tier);
  if (tier < 0) return null;
  return tier < 7
    ? tier * 4 + (divisions[rank.division] ?? 0) + Math.min(99, rank.leaguePoints) / 100
    : 28 + tier - 7 + rank.leaguePoints / (rank.leaguePoints + 1000);
}
export function chartRankLabel(value: number) {
  const level = Math.floor(value);
  if (level < 0 || level > 30) return "";
  return rankLabel({
    tier: level >= 28 ? TIERS[level - 21] : TIERS[Math.floor(level / 4)],
    division: level >= 28 ? "" : ["IV", "III", "II", "I"][level % 4],
    leaguePoints: 0,
    wins: 0,
    losses: 0,
  });
}
