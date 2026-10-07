import Link from "next/link";
import type { PublicPlayer } from "@/lib/types";
import type { View } from "@/lib/queues";
import { globalMetrics, HIGHLIGHT_MIN_GAMES } from "@/lib/global-metrics";
import { rankLabel } from "@/lib/ranking";
import { kda } from "@/lib/stats";
import { RankEmblem } from "./rank-emblem";
import { MethodNote } from "./method-note";
export function GlobalMetricsSection({
  players,
  view,
  source = "ranked",
}: {
  players: PublicPlayer[];
  view: View;
  source?: "ranked" | "matches";
}) {
  const stats = globalMetrics(players, view, source);
  const highlights = [
    ...(view !== "5v5"
      ? [
          {
            label: "Líder ranked",
            player: stats.leader?.player,
            value: stats.leader ? `${stats.leader.player.rank!.leaguePoints} LP` : "—",
            detail: stats.leader
              ? rankLabel(stats.leader.player.rank)
              : "Sin jugadores clasificados",
          },
        ]
      : []),
    {
      label: "Mejor winrate",
      player: stats.bestWinrate?.player,
      value: stats.bestWinrate ? `${stats.bestWinrate.rate.toFixed(1)}%` : "—",
      detail: `Mínimo ${HIGHLIGHT_MIN_GAMES} partidas`,
    },
    {
      label: "Mejor KDA",
      player: stats.bestKda,
      value: stats.bestKda
        ? kda(
            stats.bestKda.stats.kills,
            stats.bestKda.stats.deaths,
            stats.bestKda.stats.assists,
          ).toFixed(2)
        : "—",
      detail: `Mínimo ${HIGHLIGHT_MIN_GAMES} importadas`,
    },
    {
      label: "Más partidas",
      player: stats.mostGames?.player,
      value: stats.mostGames?.games.toLocaleString("es-CL") ?? "—",
      detail:
        source === "matches" || view === "5v5"
          ? "Partidas importadas del período"
          : "Registro ranked de temporada",
    },
  ];
  return (
    <section className="global-metrics" aria-labelledby="global-metrics-heading">
      <div className="section-heading">
        <h2 id="global-metrics-heading">El pulso de la comunidad</h2>
        <span>
          {stats.participants} PARTICIPANTES / {view.toUpperCase()}
        </span>
      </div>
      <div className={`global-leaders ${view === "5v5" ? "three-highlights" : ""}`}>
        {highlights.map((item) => (
          <article
            className={`community-highlight ${item.label === "Líder ranked" ? "ranked-highlight" : ""}`}
            key={item.label}
          >
            {item.label === "Líder ranked" && item.player && (
              <RankEmblem tier={item.player.rank?.tier} size={72} decorative />
            )}
            <h3>{item.label}</h3>
            <strong className="highlight-value numeric">{item.value}</strong>
            {item.player ? (
              <Link href={`/player/${item.player.id}?queue=${view}`}>
                {item.player.gameName}
                <span>#{item.player.tagLine}</span>
              </Link>
            ) : (
              <span className="muted">Muestra insuficiente</span>
            )}
            <small>{item.detail}</small>
          </article>
        ))}
      </div>
      <dl className="global-averages">
        <div>
          <dt>Winrate conjunto</dt>
          <dd>{stats.winrate === null ? "—" : `${stats.winrate.toFixed(1)}%`}</dd>
        </div>
        <div>
          <dt>KDA conjunto</dt>
          <dd>{stats.kda?.toFixed(2) ?? "—"}</dd>
        </div>
        <div>
          <dt>Partidas / participante{source === "ranked" && view !== "5v5" ? " ranked" : ""}</dt>
          <dd>{stats.averageGames?.toFixed(1) ?? "—"}</dd>
        </div>
      </dl>
      {view !== "5v5" && stats.highestLp && (
        <p className="metric-note">
          Mayor LP actual:{" "}
          <Link href={`/player/${stats.highestLp.player.id}?queue=${view}`}>
            {stats.highestLp.player.gameName}#{stats.highestLp.player.tagLine}
          </Link>
          {" · "}
          {rankLabel(stats.highestLp.player.rank)} · {stats.highestLp.player.rank!.leaguePoints} LP.
        </p>
      )}
      <MethodNote>
        <p>
          {source === "matches"
            ? "Rendimiento calculado exclusivamente desde las partidas importadas del período seleccionado. El líder muestra el rango actual; no se reconstruye rango histórico con partidas."
            : view === "5v5"
              ? "Resultados del historial importado."
              : `LP, victorias y partidas: ${stats.rankedParticipants} cuentas clasificadas en esta cola. El líder se determina por tier, división y LP.`}{" "}
          Winrate conjunto = victorias / resultados; KDA conjunto = (kills + asistencias) / muertes
          importadas, con divisor mínimo de 1. No es un promedio simple de porcentajes.
          {source === "ranked" && " Los filtros de la tabla no cambian este resumen."}
        </p>
        {view !== "5v5" && (
          <p>
            «Mayor LP actual» compara LP dentro de la división actual; el líder ranked se ordena por
            tier, división y LP.
          </p>
        )}
      </MethodNote>
    </section>
  );
}
