"use client";
import { useId, useState } from "react";
import { RivalryTimeline } from "./rivalry-timeline";
import { rivalryTimeline } from "@/lib/rivalry-timeline";
import { ArrowLeftRight } from "lucide-react";
import {
  detectLeadershipChange,
  RIVALRY_OBSERVATION_TOLERANCE_MS,
  type LeadershipChange,
} from "@/lib/rivalry-leadership";
import { rankLabel } from "@/lib/ranking";
import type { Rivalry } from "@/lib/rivalries";
import type { View } from "@/lib/queues";
const format = (timestamp: string) =>
  new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(timestamp));
export function RivalryLeadership({
  rivalry,
  view,
  demo,
  weeklyChange,
  weeklyEnabled = true,
  showSummary = true,
}: {
  rivalry: Rivalry;
  view: View;
  demo: boolean;
  weeklyChange?: LeadershipChange;
  weeklyEnabled?: boolean;
  /** Hide only the introductory copy when the surrounding view already explains the event. */
  showSummary?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const [first, second] = rivalry.players;
  const asOf =
    Date.parse(first.observedAt) <= Date.parse(second.observedAt)
      ? first.observedAt
      : second.observedAt;
  if (
    !Number.isFinite(Date.parse(first.observedAt)) ||
    !Number.isFinite(Date.parse(second.observedAt))
  )
    return null;
  const change = weeklyChange ?? detectLeadershipChange(first, second, view, { asOf });
  const events = weeklyEnabled ? rivalryTimeline(rivalry, view, { asOf }) : [];
  const comparison =
    change ?? (events[0] ? { before: events[0].before, after: events[0].after } : null);
  if (!comparison) return null;
  const name = (id: string) => {
    const p = rivalry.players.find((p) => p.id === id)!;
    return p.gameName;
  };
  const previousLeader = change ? name(change.before.leaderId) : "",
    nextLeader = change ? name(change.after.leaderId) : "";
  const currentDifference = first.rank.leaguePoints - second.rank.leaguePoints;
  const currentLeader =
    currentDifference === 0 ? null : currentDifference > 0 ? first.id : second.id;
  const stillLeads = currentLeader === change?.after.leaderId;
  return (
    <>
      <div className="rivalry-leadership">
        {showSummary && (
          <p className="rivalry-leadership-title">
            <ArrowLeftRight size={16} aria-hidden="true" />
            <strong>
              {change ? "Cambio de liderazgo observado" : "Historial de la rivalidad"}
            </strong>
            {demo && <span className="leadership-demo-badge">Ficticio · Demo</span>}
          </p>
        )}
        {showSummary && change && (
          <>
            <p className="leadership-banter">
              {stillLeads
                ? `Ahora ${nextLeader} tiene de hijo a ${previousLeader}`
                : `En ese corte, ${nextLeader} le quitó el trono a ${previousLeader}`}
              {"\u00a0"}
              <span aria-hidden="true">🐶</span>
            </p>
            <p className="leadership-fact">
              Antes lideraba {previousLeader}; en un corte posterior comparable, {nextLeader} pasó a
              liderar.
            </p>
          </>
        )}
        <button
          type="button"
          className="leadership-evolution-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>{" "}
          {expanded ? "Ocultar evolución" : "Ver evolución"}
        </button>
      </div>
      <section
        id={panelId}
        className="rivalry-evolution-content"
        hidden={!expanded}
        aria-label="Evolución del enfrentamiento"
      >
        <h4>Evolución del enfrentamiento</h4>
        <table className="leadership-comparison">
          <caption>
            Historial de la rivalidad · LP observados ·{" "}
            {rankLabel(comparison.before.observations[0])}
          </caption>
          <thead>
            <tr>
              <th scope="col">Jugador</th>
              <th scope="col">
                Antes <small>Primer corte</small>
              </th>
              <th scope="col">Último corte observado</th>
            </tr>
          </thead>
          <tbody>
            {rivalry.players.map((player, playerIndex) => (
              <tr key={player.id}>
                <th scope="row">{player.gameName}</th>
                {([comparison.before, comparison.after] as const).map((cut, index) => (
                  <td
                    key={index}
                    className={
                      player.id === cut.leaderId
                        ? `leadership-cell-leader ${index === 0 ? "was-leading" : "is-leading"}`
                        : ""
                    }
                  >
                    <strong>{cut.observations[playerIndex].leaguePoints} LP</strong>
                    {player.id === cut.leaderId && (
                      <span className="leadership-cell-label">
                        {index === 0 ? "Lideraba" : "Lidera en este corte"}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="leadership-dates">
          {([comparison.before, comparison.after] as const).map((cut, index) => (
            <div key={index}>
              <dt>{index === 0 ? "Antes · Primer corte" : "Último corte observado"}</dt>
              {cut.observations[0].timestamp === cut.observations[1].timestamp ? (
                <dd>
                  Ambos jugadores:{" "}
                  <time
                    dateTime={cut.observations[0].timestamp}
                    title={cut.observations[0].timestamp}
                  >
                    {format(cut.observations[0].timestamp)} UTC
                  </time>
                </dd>
              ) : (
                cut.observations.map((point, playerIndex) => (
                  <dd key={playerIndex}>
                    {rivalry.players[playerIndex].gameName}:{" "}
                    <time dateTime={point.timestamp} title={point.timestamp}>
                      {format(point.timestamp)} UTC
                    </time>
                  </dd>
                ))
              )}
            </div>
          ))}
        </dl>
        <RivalryTimeline events={events} rivalry={rivalry} />
        <dl className="leadership-method">
          <div>
            <dt>Intervalo observado</dt>
            <dd>
              {format(comparison.before.from)} → {format(comparison.after.to)} UTC
            </dd>
          </div>
          <div>
            <dt>Nota interpretativa</dt>
            <dd>
              Cortes históricos con hasta {RIVALRY_OBSERVATION_TOLERANCE_MS / 60_000} minutos entre
              jugadores. No indica el momento exacto ni una partida. El último corte observado es
              histórico; el estado actual se muestra en la rivalidad.
            </dd>
          </div>
        </dl>
        {weeklyChange && (
          <p className="weekly-rivalry-note">
            Reconocimiento algorítmico sobre las observaciones disponibles de esta semana en
            Santiago. No es un premio oficial de Riot; el historial limitado puede omitir otros
            cambios.
          </p>
        )}
      </section>
    </>
  );
}
