import { Check, X, RotateCcw } from "lucide-react";
import { matchOutcome } from "@/lib/match-outcome";
import type { RecentChampionMatch, RecentMatch } from "@/lib/types";
import { championAsset, type ChampionCatalog } from "@/lib/champion-assets";
import { Avatar } from "./avatar";
import { InfoTip } from "./info-tip";

type FormMatch = RecentChampionMatch &
  Partial<Pick<RecentMatch, "kills" | "deaths" | "assists" | "timestamp">>;

function OutcomeMark({ match }: { match: FormMatch }) {
  return (
    <span className="outcome-mark" aria-hidden="true">
      {match.isRemake ? (
        <RotateCcw size={10} strokeWidth={3} />
      ) : match.win ? (
        <Check size={10} strokeWidth={3} />
      ) : (
        <X size={10} strokeWidth={3} />
      )}
    </span>
  );
}

/**
 * Last five matches, most recent first. The compact variant (ladder) keeps a hover hint;
 * the interactive variant (profile) makes every match a toggletip that opens on hover,
 * keyboard focus, click or tap, with a visible V/D/R letter so results never rely on color.
 */
export function RecentChampionForm({
  matches,
  champions,
  interactive = false,
  size = 28,
}: {
  matches: FormMatch[];
  champions: ChampionCatalog;
  interactive?: boolean;
  size?: number;
}) {
  if (!matches.length) return <span className="no-results">Sin partidas</span>;
  const shown = matches.slice(0, 5);
  return (
    <span
      className={`recent-champions${interactive ? " is-interactive" : ""}`}
      role="list"
      aria-label="Últimas partidas, más reciente a la izquierda"
    >
      {shown.map((match, index) => {
        const asset = championAsset(match.championId, match.champion, champions);
        const outcome = matchOutcome(match);
        const label = `${asset.name} · ${outcome}${index === 0 ? " · Más reciente" : ""}`;
        const state = match.isRemake ? "remade" : match.win ? "won" : "lost";
        if (!interactive)
          return (
            <span
              role="listitem"
              className={`recent-champion ${state}`}
              key={match.matchId}
              data-tip={label}
            >
              <span className="sr-only">{label}</span>
              <Avatar decorative champion {...asset} size={size} />
              <OutcomeMark match={match} />
            </span>
          );
        const kda =
          match.kills !== undefined && match.deaths !== undefined && match.assists !== undefined
            ? `K / D / A: ${match.kills} / ${match.deaths} / ${match.assists}`
            : null;
        const date = match.timestamp
          ? new Date(match.timestamp).toLocaleDateString("es-CL", {
              timeZone: "UTC",
              day: "numeric",
              month: "short",
            })
          : null;
        return (
          <span role="listitem" className="recent-form-item" key={match.matchId}>
            <InfoTip
              align={index < shown.length / 2 ? "start" : "end"}
              term={
                <span className={`recent-champion ${state}`}>
                  <span className="sr-only">{label}</span>
                  <Avatar decorative champion {...asset} size={size} />
                  <OutcomeMark match={match} />
                  <span className="recent-result" aria-hidden="true">
                    {match.isRemake ? "R" : match.win ? "V" : "D"}
                  </span>
                </span>
              }
            >
              <strong>{asset.name}</strong> · {outcome}
              {index === 0 && " · más reciente"}
              {kda && (
                <>
                  <br />
                  {kda}
                </>
              )}
              {date && (
                <>
                  <br />
                  {date} UTC
                </>
              )}
            </InfoTip>
          </span>
        );
      })}
    </span>
  );
}
