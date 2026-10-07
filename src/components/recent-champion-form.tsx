import { Check, X, RotateCcw } from "lucide-react";
import { matchOutcome } from "@/lib/match-outcome";
import type { RecentChampionMatch } from "@/lib/types";
import { championAsset, type ChampionCatalog } from "@/lib/champion-assets";
import { Avatar } from "./avatar";
export function RecentChampionForm({
  matches,
  champions,
}: {
  matches: RecentChampionMatch[];
  champions: ChampionCatalog;
}) {
  if (!matches.length) return <span className="no-results">Sin partidas</span>;
  return (
    <span
      className="recent-champions"
      role="list"
      aria-label="Últimas partidas, más reciente a la izquierda"
    >
      {matches.slice(0, 5).map((match, index) => {
        const asset = championAsset(match.championId, match.champion, champions);
        const label = `${asset.name} · ${matchOutcome(match)}${index === 0 ? " · Más reciente" : ""}`;
        return (
          <span
            role="listitem"
            className={`recent-champion ${match.isRemake ? "remade" : match.win ? "won" : "lost"}`}
            key={match.matchId}
            data-tip={label}
          >
            <span className="sr-only">{label}</span>
            <Avatar decorative champion {...asset} size={28} />
            <span className="outcome-mark" aria-hidden="true">
              {match.isRemake ? (
                <RotateCcw size={10} strokeWidth={3} />
              ) : match.win ? (
                <Check size={10} strokeWidth={3} />
              ) : (
                <X size={10} strokeWidth={3} />
              )}
            </span>
          </span>
        );
      })}
    </span>
  );
}
