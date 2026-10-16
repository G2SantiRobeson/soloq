import Link from "next/link";
import { profileIconAsset } from "@/lib/profile-icon";
import { ShareRivalry } from "./share-rivalry";
import { rivalryAnchor } from "@/lib/shared-rivalry";
import type { LadderFilters } from "@/lib/ladder-filters";
import { Swords, Trophy, ArrowLeftRight, TrendingDown, TrendingUp } from "lucide-react";
import { QUEUE_LABELS, rankedQueue, type View } from "@/lib/queues";
import type { Rivalry } from "@/lib/rivalries";
import { detectRivalryDynamics, RIVALRY_EVENT_LABELS } from "@/lib/rivalry-dynamics";
import { rivalryKey, selectWeeklyRivalry } from "@/lib/weekly-rivalry";
import { rankSortValue } from "@/lib/ranking";
import { Avatar } from "./avatar";
import { PLATFORM_LABELS } from "@/lib/routing";
import { RankDisplay } from "./rank-display";
import { RivalryLeadership } from "./rivalry-leadership";
import { tierColorVar, tierKey } from "@/lib/ladder-strata";
import type { CSSProperties } from "react";

export function Rivalries({
  rivalries,
  view,
  version,
  demo = false,
  asOf,
  weeklyEnabled = true,
  filters,
  sharedPairKey,
  rankingHref = "#clasificacion",
}: {
  rivalries: readonly Rivalry[];
  view: View;
  version: string | null;
  demo?: boolean;
  asOf?: string;
  weeklyEnabled?: boolean;
  filters?: LadderFilters;
  sharedPairKey?: string;
  rankingHref?: string;
}) {
  const queue = rankedQueue(view);
  const visible = rivalries.filter((rivalry) => queue !== null && rivalry.queue === queue);
  if (!visible.length) return null;
  const reference =
    asOf ??
    visible
      .flatMap((r) => r.players.map((p) => p.observedAt))
      .reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
  const weekly = weeklyEnabled ? selectWeeklyRivalry(visible, view, { asOf: reference }) : null;
  // The week's rivalry leads the list; the others keep the order they were selected in.
  const ordered = weekly
    ? [
        ...visible.filter((r) => rivalryKey(r) === rivalryKey(weekly.rivalry)),
        ...visible.filter((r) => rivalryKey(r) !== rivalryKey(weekly.rivalry)),
      ]
    : visible;
  return (
    <section
      className="rivalries"
      aria-label={`Rivalidades de clasificación ${QUEUE_LABELS[view]}`}
    >
      <header className="rivalries-heading">
        <h3 id="rivalidades" tabIndex={-1}>
          <Swords size={17} aria-hidden="true" /> Rivalidades de clasificación
        </h3>
        <span>
          {QUEUE_LABELS[view]} · {demo ? "Rangos ficticios de demo" : "Rangos oficiales actuales"}
        </span>
        <a className="rivalries-return" href={rankingHref}>
          Volver al ranking <span aria-hidden="true">↑</span>
        </a>
      </header>
      <ul className="rivalries-list">
        {ordered.map((rivalry) => {
          const highlighted = rivalryKey(rivalry) === sharedPairKey;
          const awarded =
            weekly && rivalryKey(weekly.rivalry) === rivalryKey(rivalry) ? weekly : null;
          const dynamics = detectRivalryDynamics(rivalry, view, { asOf: reference });
          const DynamicIcon =
            dynamics?.kind === "leadership-change"
              ? ArrowLeftRight
              : dynamics?.kind === "approaching"
                ? TrendingDown
                : TrendingUp;
          const [first, second] = rivalry.players;
          const order = rankSortValue(first.rank) - rankSortValue(second.rank);
          const leader = order === 0 ? null : order > 0 ? first.id : second.id;
          const comparable = rivalry.lpDifference !== null;
          const difference = comparable
            ? Math.abs(first.rank.leaguePoints - second.rank.leaguePoints)
            : null;
          return (
            <li
              className={highlighted ? "rivalry-row shared-rivalry" : "rivalry-row"}
              id={rivalryAnchor([first.id, second.id])}
              tabIndex={-1}
              aria-label={highlighted ? "Rivalidad compartida" : undefined}
              data-weekly={awarded ? "" : undefined}
              key={rivalry.players.map((p) => p.id).join(":")}
            >
              <div className="rivalry-current">
                <div className="rivalry-current-heading">
                  <p className="rivalry-state-label">
                    {highlighted ? "Rivalidad compartida" : "Rivalidad actual"}
                  </p>
                  {awarded && (
                    <span
                      className="weekly-rivalry-badge"
                      title="Reconocimiento algorítmico de la semana de Santiago, basado en observaciones disponibles; no es un premio oficial de Riot."
                    >
                      <Trophy size={14} aria-hidden="true" />
                      Rivalidad de la semana
                    </span>
                  )}
                </div>
                <div className="rivalry-duel">
                  {rivalry.players.map((player, index) => (
                    <Link
                      className={`rivalry-player rivalry-player-${index + 1}${leader === player.id ? " current-leader" : ""}`}
                      key={player.id}
                      href={`/player/${player.id}?queue=${view}`}
                      aria-label={`Ver perfil de ${player.gameName}#${player.tagLine} en ${QUEUE_LABELS[view]}`}
                      style={
                        { "--rank-color": tierColorVar(tierKey(player.rank)) } as CSSProperties
                      }
                    >
                      <span className="player-identity">
                        <Avatar
                          name={player.gameName}
                          decorative
                          size={40}
                          src={profileIconAsset(version, player.profileIconId)}
                        />
                        <span className="identity-copy">
                          <span className="player-name">
                            {player.gameName}
                            <span className="tagline">#{player.tagLine}</span>
                          </span>
                          <span className="player-sub">
                            <span className="region-tag">{PLATFORM_LABELS[player.platform]}</span>
                          </span>
                        </span>
                      </span>
                      <span className="rivalry-rank">
                        <RankDisplay rank={player.rank} size={32} />
                        <strong className="rivalry-current-lp numeric">
                          {player.rank.leaguePoints} LP
                        </strong>
                      </span>
                      <span className="rivalry-standing">
                        {leader === null
                          ? "Empate de clasificación"
                          : leader === player.id
                            ? comparable
                              ? "Va liderando"
                              : "Lidera por división"
                            : "Persiguiendo"}
                      </span>
                    </Link>
                  ))}
                  <div className="rivalry-versus">
                    <span aria-hidden="true">VS</span>

                    <p className="rivalry-current-advantage" data-comparable={comparable}>
                      <span className="rivalry-advantage-label">Ventaja actual</span>
                      {difference === null
                        ? "Divisiones contiguas · Sin ventaja de LP comparable"
                        : difference === 0
                          ? "Empate · 0 LP"
                          : `${difference} LP`}
                      <span>
                        {leader !== null &&
                          `${rivalry.players.find((p) => p.id === leader)!.gameName} lidera ahora`}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="rivalry-footer">
                  {dynamics && (
                    <p
                      className="rivalry-dynamics"
                      data-kind={dynamics.kind}
                      title="Cambio entre dos cortes históricos comparables, no en tiempo real."
                    >
                      <DynamicIcon size={13} aria-hidden="true" />
                      {RIVALRY_EVENT_LABELS[dynamics.kind]}
                    </p>
                  )}
                  <ShareRivalry ids={[first.id, second.id]} view={view} filters={filters} />
                </div>
              </div>
              <RivalryLeadership
                rivalry={rivalry}
                view={view}
                demo={demo}
                weeklyChange={awarded?.change}
                weeklyEnabled={weeklyEnabled}
              />
            </li>
          );
        })}
      </ul>
      <p className="rivalries-note">
        Proximidad en la clasificación de la misma región. No representa partidas entre ambos
        jugadores.
      </p>
    </section>
  );
}
