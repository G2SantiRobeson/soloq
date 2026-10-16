import Link from "next/link";
import { profileIconAsset } from "@/lib/profile-icon";
import { Avatar } from "./avatar";
import { RankDisplay } from "./rank-display";
import { hasRivalRank } from "@/lib/rivalries";
import { rivalComparisonLabel } from "@/lib/rival-comparison-label";
import { manualComparison } from "@/lib/manual-rival";
import type { RivalIdentity } from "@/lib/nearest-rival";
import type { View } from "@/lib/queues";
import { tierColorVar, tierKey } from "@/lib/ladder-strata";
import type { CSSProperties } from "react";
export function ManualDuel({
  players,
  view,
  version,
  demo,
}: {
  players: readonly [RivalIdentity, RivalIdentity];
  view: View;
  version: string | null;
  demo: boolean;
}) {
  const comparison = manualComparison(...players);
  const label = rivalComparisonLabel(...players);
  const crossApex = comparison.gap !== null && players[0].rank?.tier !== players[1].rank?.tier;
  return (
    <section className="manual-duel" aria-label="Comparación elegida">
      <p className="rivalry-state-label">
        Comparación elegida · Registros de clasificación {demo && "· Ficticio · Demo"}
      </p>
      <div className="rivalry-duel">
        {players.map((p, i) => (
          <Link
            key={p.id}
            className={
              "rivalry-player rivalry-player-" +
              (i + 1) +
              (comparison.leaderId === p.id ? " current-leader" : "")
            }
            href={"/player/" + p.id + "?queue=" + view}
            style={
              {
                "--rank-color": tierColorVar(tierKey(hasRivalRank(p) ? p.rank : null)),
              } as CSSProperties
            }
          >
            <Avatar
              name={p.gameName}
              decorative
              size={36}
              src={profileIconAsset(version, p.profileIconId)}
            />
            <strong>{p.gameName}</strong>
            <span className="tagline">#{p.tagLine}</span>
            <RankDisplay rank={hasRivalRank(p) ? p.rank : null} size={26} />
            <strong className="rivalry-player-lp">
              {hasRivalRank(p) && Number.isSafeInteger(p.rank.leaguePoints)
                ? p.rank.leaguePoints + " LP"
                : "Sin datos de rango"}
            </strong>
            {comparison.leaderId === p.id && (
              <span className="rivalry-player-state">
                {crossApex ? "Por delante por categoría" : "Va liderando"}
              </span>
            )}
          </Link>
        ))}
        <div className="rivalry-versus">
          <strong>VS</strong>
          <span>
            {label.kind === "lp"
              ? crossApex
                ? "Diferencia de LP"
                : "Ventaja actual"
              : "Posición registrada"}
          </span>
          <strong>
            {label.kind === "lp"
              ? comparison.gap + " LP"
              : label.kind === "unavailable"
                ? "No comparable"
                : "Por rango"}
          </strong>
          <span>
            {comparison.leaderId
              ? players.find((p) => p.id === comparison.leaderId)!.gameName +
                (crossApex ? " está por delante por categoría" : " lidera")
              : comparison.gap === 0
                ? "Empate"
                : "No comparable"}
          </span>
        </div>
      </div>
      {crossApex && (
        <p className="comparison-note">
          LP comparados directamente, conservando los tiers oficiales. La diferencia no indica los
          LP necesarios para ascender de categoría.
        </p>
      )}
      {label.kind !== "lp" && <p className="comparison-note">{label.text}</p>}
    </section>
  );
}
