import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Crosshair, TrendingUp } from "lucide-react";
import { getProfile } from "@/server/queries";
import { getAssets, profileIconUrl } from "@/server/riot/assets";
import { parseView, STANDARD_QUEUES } from "@/lib/queues";
import { PLATFORM_LABELS } from "@/lib/routing";
import { kda, winrate } from "@/lib/stats";
import { matchOutcome } from "@/lib/match-outcome";
import { RankAvatar } from "@/components/rank-avatar";
import { RankDisplay } from "@/components/rank-display";
import { RankEmblem } from "@/components/rank-emblem";
import { LPDisplay } from "@/components/lp-display";
import { RecentChampionForm } from "@/components/recent-champion-form";
import { LpDeltaSummary } from "@/components/lp-delta-summary";
import { PlayerMomentum } from "@/components/player-momentum";
import { championAsset } from "@/lib/champion-assets";
import { ChampionIdentity } from "@/components/champion-identity";
import { Freshness } from "@/components/freshness";
import { QueueTabs } from "@/components/queue-tabs";
import { BackToLadder } from "@/components/back-link";
import { RankChart } from "@/components/rank-chart";
import { PerformanceChart } from "@/components/performance-chart";
import { HistoryStatusLabel } from "@/components/history-status";
import { CURRENT_SEASON, seasonStart } from "@/lib/season";
import { HIGHLIGHT_MIN_GAMES } from "@/lib/global-metrics";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ queue?: string }> };
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const player = await getProfile(id, parseView((await searchParams).queue));
  const title = player ? `${player.gameName}#${player.tagLine}` : "Jugador no encontrado";
  const description = `Rango, campeones y partidas de ${title} en SoloQ.`;
  return { title, description, openGraph: { title: `${title} | SoloQ`, description } };
}
export default async function PlayerPage({ params, searchParams }: Props) {
  const { id } = await params;
  const view = parseView((await searchParams).queue);
  const [player, assets] = await Promise.all([getProfile(id, view), getAssets()]);
  if (!player) notFound();
  const record = view !== "5v5" && player.rank ? player.rank : player.stats;
  const rate = winrate(record.wins, record.losses);
  return (
    <>
      <BackToLadder view={view} />
      <section className="profile-header">
        <RankAvatar
          tier={view === "5v5" ? null : player.rank?.tier}
          name={player.gameName}
          src={profileIconUrl(assets.version, player.profileIconId)}
          size={132}
        />
        <div>
          <div className="eyebrow">PERFIL DE JUGADOR · {PLATFORM_LABELS[player.platform]}</div>
          <h1>
            {player.gameName}
            <span>#{player.tagLine}</span>
          </h1>
          <Freshness timestamp={player.lastSyncedAt} observedAt={player.observedAt} />
        </div>
        <span className="profile-since">
          En seguimiento desde
          <br />
          <b>{new Date(player.createdAt).toLocaleDateString("es-CL", { timeZone: "UTC" })}</b>
        </span>
      </section>
      <div className="tabs-line">
        <QueueTabs view={view} base={`/player/${id}`} />
      </div>
      <div className="profile-grid">
        <section className="panel rank-panel">
          <div className="card-label">
            <Crosshair size={15} /> {view === "5v5" ? "REGISTRO 5V5" : "RANGO ACTUAL"}
          </div>
          <div className="profile-rank-heading">
            {view !== "5v5" && <RankEmblem tier={player.rank?.tier} size={112} decorative />}
            <RankDisplay rank={player.rank} noRank={view === "5v5"} emblem={false} />
          </div>
          <div className="profile-lp">
            <LPDisplay rank={player.rank} noRank={view === "5v5"} />
            {view !== "5v5" && <PlayerMomentum metrics={player.momentum} />}
          </div>
          <div className="profile-record">
            <strong className="positive">{record.wins} V</strong>
            <span>{record.losses} D</span>
            <b>{record.wins + record.losses ? `${rate.toFixed(1)}% WR` : "— WR"}</b>
          </div>
          <div className={`winrate-track ${record.wins + record.losses ? "" : "no-games"}`}>
            <span style={{ width: `${rate}%` }} />
          </div>
          <p className="muted">
            {record.wins + record.losses} partidas{" "}
            {view === "5v5" || !player.rank ? "importadas" : "en el estado ranked actual"}
          </p>
          <div className="profile-form">
            <span>FORMA RECIENTE</span>
            <RecentChampionForm matches={player.recent} champions={assets.champions} />
          </div>
        </section>
        <section className="panel evolution-panel">
          <div className="panel-title">
            <h2>
              <TrendingUp size={17} /> Progresión de rango
            </h2>
            <span>SNAPSHOTS OFICIALES</span>
          </div>
          {view === "5v5" ? (
            <div className="chart-empty">
              <p>5v5 es una vista de estadísticas.</p>
              <span>No tiene un rango ni LP propios.</span>
            </div>
          ) : (
            <>
              <p className="metric-note">
                {player.trackingSince
                  ? `Seguimiento de rango desde ${new Date(player.trackingSince).toLocaleDateString("es-CL", { timeZone: "UTC" })}. No hay LP históricos anteriores a esta fecha.`
                  : "Aún no hay snapshots de rango en esta temporada."}
              </p>
              <RankChart history={player.history} />
            </>
          )}
        </section>
      </div>
      {view !== "5v5" && <LpDeltaSummary observations={player.lpObservations} />}
      <section className="panel season-performance">
        <div className="panel-title">
          <h2>Rendimiento de temporada</h2>
          <span>{CURRENT_SEASON.label.toUpperCase()}</span>
        </div>
        <p className="metric-note">
          Partidas desde{" "}
          {seasonStart(player.platform).toLocaleDateString("es-CL", { timeZone: "UTC" })}. Este
          historial puede preceder al seguimiento de rango.
        </p>
        <HistoryStatusLabel history={player.seasonHistory} />
        <div className="season-record">
          <strong>{player.stats.games} partidas</strong>
          <span>
            {player.stats.wins} V / {player.stats.losses} D
          </span>
          <strong>
            {player.stats.games
              ? `${winrate(player.stats.wins, player.stats.losses).toFixed(1)}% WR`
              : "— WR"}
          </strong>
        </div>
        <PerformanceChart points={player.performance} />
      </section>
      <section className="stat-strip" aria-label="Estadísticas del historial importado">
        <div>
          <span>KDA</span>
          <strong>
            {player.stats.games
              ? kda(player.stats.kills, player.stats.deaths, player.stats.assists).toFixed(2)
              : "—"}
          </strong>
        </div>
        <div>
          <span>CS / MIN</span>
          <strong>
            {player.stats.duration
              ? (player.stats.cs / (player.stats.duration / 60)).toFixed(1)
              : "—"}
          </strong>
        </div>
        <div>
          <span>DAÑO / PARTIDA</span>
          <strong>
            {player.stats.games
              ? Math.round(player.stats.damage / player.stats.games).toLocaleString("es-CL")
              : "—"}
          </strong>
        </div>
        <div>
          <span>PARTIDAS IMPORTADAS</span>
          <strong>{player.stats.games}</strong>
        </div>
      </section>
      <div className="profile-detail-grid">
        <section className="panel champion-panel">
          <div className="panel-title">
            <h2>Pool de campeones</h2>
            <span>HISTORIAL IMPORTADO</span>
          </div>
          {player.champions.length ? (
            player.champions.map((c) => (
              <div className="champion-row" key={c.championId}>
                <ChampionIdentity {...championAsset(c.championId, c.champion, assets.champions)}>
                  {c.games} partidas · {kda(c.kills, c.deaths, c.assists).toFixed(2)} KDA
                </ChampionIdentity>
                <div className="champion-rate">
                  <strong
                    className={
                      c.games >= HIGHLIGHT_MIN_GAMES && winrate(c.wins, c.losses) >= 50
                        ? "positive"
                        : ""
                    }
                    title={
                      c.games < HIGHLIGHT_MIN_GAMES
                        ? `WR disponible desde ${HIGHLIGHT_MIN_GAMES} partidas`
                        : undefined
                    }
                  >
                    {c.games >= HIGHLIGHT_MIN_GAMES
                      ? `${winrate(c.wins, c.losses).toFixed(0)}%`
                      : "— WR"}
                  </strong>
                  <span>
                    {c.wins} V / {c.losses} D
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="empty-copy">Aún no hay partidas importadas en esta cola.</p>
          )}
          <p className="metric-note">
            Winrate por campeón desde {HIGHLIGHT_MIN_GAMES} partidas; muestras menores muestran V/D.
          </p>
        </section>
        <section className="panel match-panel">
          <div className="panel-title">
            <h2>Últimas partidas</h2>
            <span>HASTA 40 RESULTADOS</span>
          </div>
          <p className="metric-note">
            Los remakes se conservan en el historial y se excluyen de las estadísticas importadas.
            Los contadores ranked son los oficiales de Riot.
          </p>
          {player.recent.length ? (
            player.recent.map((m) => (
              <article
                className={`match-row ${m.isRemake ? "match-remake" : m.win ? "match-win" : "match-loss"}`}
                key={m.matchId}
              >
                <div className="match-outcome">
                  <strong>{matchOutcome(m).toUpperCase()}</strong>
                  <span>
                    {Math.floor(m.duration / 60)}:{String(m.duration % 60).padStart(2, "0")}
                  </span>
                </div>
                <ChampionIdentity {...championAsset(m.championId, m.champion, assets.champions)}>
                  {m.position}
                </ChampionIdentity>
                <div className="match-kda">
                  <strong>
                    {m.kills} <i>/ {m.deaths} /</i> {m.assists}
                  </strong>
                  <span>K / D / A</span>
                </div>
                <div className="match-detail">
                  <strong>
                    {m.cs} CS{" "}
                    <i>
                      ·{" "}
                      {m.killParticipation === null
                        ? "—"
                        : `${Math.round(m.killParticipation * 100)}%`}{" "}
                      KP
                    </i>
                  </strong>
                  <span>
                    {STANDARD_QUEUES[m.queueId as keyof typeof STANDARD_QUEUES] ?? m.queueId} ·{" "}
                    {new Date(m.timestamp).toLocaleDateString("es-CL", {
                      timeZone: "UTC",
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
              </article>
            ))
          ) : (
            <p className="empty-copy">Las nuevas partidas aparecerán después de sincronizar.</p>
          )}
        </section>
      </div>
      <p className="page-note">
        Las estadísticas de combate y campeones corresponden al historial importado; pueden cubrir
        menos partidas que el registro ranked de la temporada. Fechas en UTC.
      </p>
    </>
  );
}
