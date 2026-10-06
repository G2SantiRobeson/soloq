import type { Metadata } from "next";
import Link from "next/link";
import { parseView } from "@/lib/queues";
import { getLeaderboard } from "@/server/queries";
import { GlobalMetricsSection } from "@/components/global-metrics-section";
import { QueueTabs } from "@/components/queue-tabs";
import { CURRENT_SEASON, parsePeriod } from "@/lib/season";
import { getSeasonOverview } from "@/server/season-queries";
import { ActivityChart } from "@/components/performance-chart";
import { ChampionIdentity } from "@/components/champion-identity";
import { RankDisplay } from "@/components/rank-display";
import { getAssets } from "@/server/riot/assets";
import { championAsset } from "@/lib/champion-assets";
import { TIERS } from "@/lib/ranking";
import { HIGHLIGHT_MIN_GAMES, RECENT_FORM_GAMES, recentHighlights } from "@/lib/global-metrics";
import { signedLp } from "@/lib/lp-metrics";
export const metadata: Metadata = { title: "Métricas" };
export const dynamic = "force-dynamic";
export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string; period?: string }>;
}) {
  const params = await searchParams;
  const view = parseView(params.queue);
  const period = parsePeriod(params.period);
  const [players, overview, assets] = await Promise.all([
    getLeaderboard(view, period),
    getSeasonOverview(view, period),
    getAssets(),
  ]);
  const partial = players.filter((p) => p.seasonHistory?.status !== "completed").length;
  const games = players.reduce((n, p) => n + p.stats.games, 0);
  const highlights = recentHighlights(players, overview.recentForm);
  return (
    <>
      <Link href={`/?queue=${view}`} className="back-link">
        ← Volver a la clasificación
      </Link>
      <section className="ladder-heading">
        <div>
          <div className="eyebrow">LA COMUNIDAD EN NÚMEROS</div>
          <h1>
            Métricas<span className="heading-dot">.</span>
          </h1>
        </div>
      </section>
      <QueueTabs view={view} base="/metrics" period={period} />
      <nav className="period-tabs" aria-label="Período de estadísticas">
        {(["season", "30d", "7d"] as const).map((p) => (
          <Link
            key={p}
            href={`/metrics?queue=${view}&period=${p}`}
            aria-current={period === p ? "page" : undefined}
          >
            {p === "season"
              ? CURRENT_SEASON.label
              : p === "30d"
                ? "Últimos 30 días"
                : "Últimos 7 días"}
          </Link>
        ))}
      </nav>
      <p className="metric-note">
        {!players.length
          ? "Todavía no hay jugadores activos."
          : partial
            ? `${partial} jugadores con historial parcial. Las cifras crecerán al completar la importación.`
            : "Historial disponible importado para los jugadores activos."}{" "}
        Los filtros solo cambian la consulta.
      </p>
      <div className="season-record">
        <strong>{players.length} jugadores</strong>
        <span>{games} participaciones</span>
        <span>{overview.uniqueGames} partidas únicas</span>
        {view !== "5v5" && (
          <span>
            {players.filter((p) => p.rank && p.rank.tier !== "UNRANKED").length} clasificados
          </span>
        )}
      </div>
      <GlobalMetricsSection players={players} view={view} source="matches" />
      <section className="panel season-performance">
        <div className="panel-title">
          <h2>Forma reciente</h2>
          <span>ÚLTIMAS {RECENT_FORM_GAMES} DEL PERÍODO</span>
        </div>
        <div className="metric-leader-row">
          <span>Mejor forma</span>
          {highlights.form?.player ? (
            <>
              <Link href={`/player/${highlights.form.player.id}?queue=${view}`}>
                {highlights.form.player.gameName}
                <span className="muted">#{highlights.form.player.tagLine}</span>
              </Link>
              <strong>
                {((100 * highlights.form.wins) / highlights.form.games).toFixed(1)}%{" "}
                <small>
                  {highlights.form.wins} V / {highlights.form.games - highlights.form.wins} D
                </small>
              </strong>
            </>
          ) : (
            <span className="muted">
              Muestra insuficiente · mínimo {HIGHLIGHT_MIN_GAMES} partidas
            </span>
          )}
        </div>
        <p className="metric-note">
          Se comparan hasta {RECENT_FORM_GAMES} partidas importadas recientes por jugador, con un
          mínimo de {HIGHLIGHT_MIN_GAMES}. Remakes excluidos; un historial parcial puede cambiar el
          resultado.
        </p>
      </section>
      {view !== "5v5" && (
        <section className="panel season-performance">
          <div className="panel-title">
            <h2>Tendencia de LP reciente</h2>
            <span>SNAPSHOTS OFICIALES</span>
          </div>
          <div className="season-record">
            <strong>{players.filter((p) => (p.momentum?.net ?? 0) > 0).length} en subida</strong>
            <span>{players.filter((p) => (p.momentum?.net ?? 0) < 0).length} en bajada</span>
            <span>{players.filter((p) => p.momentum?.net === 0).length} sin cambio neto</span>
            <span>
              {players.filter((p) => p.momentum?.net == null).length} sin datos comparables
            </span>
          </div>
          <p className="metric-note">
            Último tramo comparable de hasta 30 snapshots por jugador, dentro del mismo tier y
            división. Puede incluir ajustes de LP. Esta tendencia y el rango actual son
            independientes del filtro de partidas; no representan el cambio de toda la temporada.
          </p>
          {[
            { label: "Mayor subida observada", player: highlights.climb },
            { label: "Mayor caída observada", player: highlights.drop },
          ].map(({ label, player }) => (
            <div className="metric-leader-row" key={label}>
              <span>{label}</span>
              {player ? (
                <>
                  <Link href={`/player/${player.id}?queue=${view}`}>
                    {player.gameName}
                    <span className="muted">#{player.tagLine}</span>
                  </Link>
                  <strong className={player.momentum!.net! > 0 ? "positive" : "negative"}>
                    {signedLp(player.momentum!.net!)} LP{" "}
                    <small>
                      {player.momentum!.games} partidas ·{" "}
                      {new Date(player.momentum!.from!).toLocaleDateString("es-CL", {
                        timeZone: "UTC",
                      })}
                      –
                      {new Date(player.momentum!.to!).toLocaleDateString("es-CL", {
                        timeZone: "UTC",
                      })}
                    </small>
                  </strong>
                </>
              ) : (
                <span className="muted">
                  Sin tramo elegible de al menos {HIGHLIGHT_MIN_GAMES} partidas
                </span>
              )}
            </div>
          ))}
          <p className="metric-note">
            Los intervalos pueden tener distinta duración; se muestra su cambio neto observado, sin
            atribuirlo a partidas individuales.
          </p>
        </section>
      )}
      <section className="panel season-performance">
        <div className="panel-title">
          <h2>{period === "season" ? "Actividad de temporada" : "Actividad del período"}</h2>
          <span>PARTICIPACIONES / SEMANA</span>
        </div>
        <ActivityChart points={overview.activity} />
      </section>
      <div className={`metrics-detail-grid ${view === "5v5" ? "single-column" : ""}`}>
        <section className="panel champion-panel">
          <div className="panel-title">
            <h2>Campeones más jugados</h2>
            <span>PERÍODO SELECCIONADO</span>
          </div>
          {overview.champions.length ? (
            overview.champions.map((c) => (
              <div className="champion-row" key={c.championId}>
                <ChampionIdentity {...championAsset(c.championId, c.champion, assets.champions)}>
                  {c.games} participaciones · {games ? ((100 * c.games) / games).toFixed(1) : "0"}%
                  de uso
                </ChampionIdentity>
                <div className="champion-results">
                  <strong>
                    {c.wins} V / {c.games - c.wins} D
                  </strong>
                  <small>
                    {c.games >= HIGHLIGHT_MIN_GAMES
                      ? `${((100 * c.wins) / c.games).toFixed(1)}% WR`
                      : `WR: mínimo ${HIGHLIGHT_MIN_GAMES} partidas`}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <p className="empty-copy">Todavía no hay partidas para este período.</p>
          )}
          <p className="metric-note">
            Uso = participaciones con el campeón / participaciones del grupo. El winrate requiere{" "}
            {HIGHLIGHT_MIN_GAMES} partidas.
          </p>
        </section>
        {view !== "5v5" && (
          <section className="panel champion-panel">
            <div className="panel-title">
              <h2>Distribución de rangos</h2>
              <span>ESTADO ACTUAL</span>
            </div>
            {[...TIERS, "UNRANKED"]
              .map((tier) => ({
                tier,
                count: players.filter((p) => (p.rank?.tier ?? "UNRANKED") === tier).length,
              }))
              .filter((r) => r.count > 0)
              .map((r) => (
                <div className="champion-row rank-distribution-row" key={r.tier}>
                  <RankDisplay
                    rank={{ tier: r.tier, division: "", leaguePoints: 0, wins: 0, losses: 0 }}
                  />
                  <span className="distribution-track" aria-hidden="true">
                    <span style={{ width: `${(100 * r.count) / players.length}%` }} />
                  </span>
                  <strong>{r.count}</strong>
                </div>
              ))}
            {!players.length && <p className="empty-copy">Añade jugadores para comenzar.</p>}
          </section>
        )}
      </div>
    </>
  );
}
