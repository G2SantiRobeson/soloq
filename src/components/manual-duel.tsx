import Link from "next/link";
import type { CSSProperties } from "react";
import { profileIconAsset } from "@/lib/profile-icon";
import { Avatar } from "./avatar";
import { RankDisplay } from "./rank-display";
import { hasRivalRank } from "@/lib/rivalries";
import { rivalComparisonLabel } from "@/lib/rival-comparison-label";
import { manualComparison } from "@/lib/manual-rival";
import type { RivalIdentity } from "@/lib/nearest-rival";
import type { View } from "@/lib/queues";
import { PLATFORM_LABELS } from "@/lib/routing";
import { tierColorVar, tierKey } from "@/lib/ladder-strata";
import styles from "./versus.module.css";

/** The existing manual duel, also used as the current-state header of shared automatic pairs. */
export function ManualDuel({
  players,
  view,
  version,
  demo,
  automatic = false,
}: {
  players: readonly [RivalIdentity, RivalIdentity];
  view: View;
  version: string | null;
  demo: boolean;
  automatic?: boolean;
}) {
  const comparison = manualComparison(...players);
  const label = rivalComparisonLabel(...players);
  const crossApex = label.crossApex;
  return (
    <section
      className={styles.duel}
      aria-label={automatic ? "Rivalidad compartida" : "Comparación elegida"}
    >
      <div className={styles.context}>
        <span>
          {automatic ? "Rivalidad compartida" : "Comparación elegida"} · Clasificación actual
        </span>
        {demo && <span className={styles.demo}>Ficticio · Demo</span>}
      </div>
      <div className={styles.faceoff}>
        {players.map((p, i) => (
          <Link
            key={p.id}
            className={styles.player}
            data-side={i}
            href={"/player/" + p.id + "?queue=" + view}
            aria-label={"Ver perfil de " + p.gameName + "#" + p.tagLine}
            style={
              {
                "--rank-color": tierColorVar(tierKey(hasRivalRank(p) ? p.rank : null)),
              } as CSSProperties
            }
          >
            <Avatar
              name={p.gameName}
              decorative
              size={64}
              src={profileIconAsset(version, p.profileIconId)}
            />
            <span className={styles.playerName}>
              {p.gameName}
              <span className={styles.tag}>#{p.tagLine}</span>
            </span>
            <span className={styles.region}>{PLATFORM_LABELS[p.platform]}</span>
            <RankDisplay rank={hasRivalRank(p) ? p.rank : null} size={44} />
            <strong className={styles.lp}>
              {hasRivalRank(p) && Number.isSafeInteger(p.rank.leaguePoints)
                ? p.rank.leaguePoints + " LP"
                : "Sin datos de rango"}
            </strong>
            <span className={styles.standing}>
              {comparison.leaderId === p.id
                ? crossApex
                  ? "Por delante por categoría"
                  : "Por delante en clasificación"
                : comparison.leaderId
                  ? "Persiguiendo"
                  : comparison.gap === 0
                    ? "Empate de clasificación"
                    : "Rango no comparable"}
            </span>
            <span className={styles.profileAction}>Ver perfil →</span>
          </Link>
        ))}
        <div className={styles.versus}>
          <strong className={styles.vs}>VS</strong>
          <span>
            {label.kind === "lp"
              ? crossApex
                ? "Diferencia de LP"
                : "Ventaja actual"
              : "Posición registrada"}
          </span>
          <strong className={styles.gap}>
            {comparison.gap !== null
              ? comparison.gap + " LP"
              : label.kind === "unavailable"
                ? "No comparable"
                : "Por rango"}
          </strong>
          <span>
            {comparison.leaderId
              ? players.find((p) => p.id === comparison.leaderId)!.gameName +
                (crossApex ? " · por categoría" : " lidera")
              : comparison.gap === 0
                ? "Mismos LP registrados"
                : "Sin ventaja acreditada"}
          </span>
        </div>
      </div>
      {crossApex ? (
        <p className={styles.note}>
          LP comparados directamente, conservando los tiers oficiales. La diferencia no indica los
          LP necesarios para ascender de categoría.
        </p>
      ) : label.kind !== "lp" ? (
        <p className={styles.note}>{label.text}</p>
      ) : null}
    </section>
  );
}
