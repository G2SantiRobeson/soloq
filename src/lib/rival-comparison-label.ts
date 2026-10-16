import { hasRivalRank } from "./rivalries";
import { manualComparison } from "./manual-rival";
import type { RivalIdentity } from "./nearest-rival";
export type RivalComparisonLabel = {
  kind: "lp" | "division" | "tier" | "unavailable";
  text: string;
  crossApex: boolean;
};
export function rivalComparisonLabel(
  player: RivalIdentity,
  rival: RivalIdentity,
): RivalComparisonLabel {
  const comparison = manualComparison(player, rival);
  if (
    !hasRivalRank(player) ||
    !hasRivalRank(rival) ||
    player.platform !== rival.platform ||
    !Number.isSafeInteger(player.rank.leaguePoints) ||
    !Number.isSafeInteger(rival.rank.leaguePoints)
  )
    return {
      kind: "unavailable",
      text: "No hay datos suficientes para comparar",
      crossApex: false,
    };
  if (comparison.gap !== null)
    return {
      kind: "lp",
      text:
        comparison.gap === 0
          ? "Mismos LP registrados"
          : rival.gameName +
            " está " +
            comparison.gap +
            " LP " +
            (rival.rank.leaguePoints > player.rank.leaguePoints
              ? "por encima de "
              : "por debajo de ") +
            player.gameName,
      crossApex: player.rank.tier !== rival.rank.tier,
    };
  if (player.rank.tier !== rival.rank.tier)
    return {
      kind: "tier",
      text: "Rangos diferentes · distancia en LP no comparable",
      crossApex: false,
    };
  return {
    kind: "division",
    text:
      rival.gameName +
      " está en otra división, " +
      (comparison.leaderId === rival.id ? "por delante de " : "por detrás de ") +
      player.gameName,
    crossApex: false,
  };
}
