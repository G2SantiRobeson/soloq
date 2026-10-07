import type { Metadata } from "next";
import Link from "next/link";
import { QUEUE_LABELS, VIEWS, parseView } from "@/lib/queues";
import { getLeaderboard } from "@/server/queries";
import { CURRENT_SEASON, parsePeriod, type MetricsPeriod } from "@/lib/season";
import { getSeasonOverview } from "@/server/season-queries";
import { ActivityChart } from "@/components/performance-chart";
import { ChampionIdentity } from "@/components/champion-identity";
import { RankDisplay } from "@/components/rank-display";
import { RankEmblem } from "@/components/rank-emblem";
import { InfoTip } from "@/components/info-tip";
import {
  AwardList,
  Block,
  FormRows,
  HeroStat,
  PlayerLink,
  TrendBar,
} from "@/components/metrics-bento";
import { getAssets } from "@/server/riot/assets";
import { championAsset } from "@/lib/champion-assets";
import { TIERS } from "@/lib/ranking";
import {
  HIGHLIGHT_MIN_GAMES,
  RECENT_FORM_GAMES,
  globalMetrics,
  recentHighlights,
} from "@/lib/global-metrics";
import { computeAwards, formExtremes, formRanking } from "@/lib/awards";
import { kda } from "@/lib/stats";
import { signedLp } from "@/lib/lp-metrics";
export const metadata: Metadata = { title: "Métricas" };
export const dynamic = "force-dynamic";

const PERIODS: { key: MetricsPeriod; label: string }[] = [
  { key: "season", label: CURRENT_SEASON.label },
  { key: "30d", label: "30 días" },
  { key: "7d", label: "7 días" },
];

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
  const ranked = view !== "5v5";
  const partial = players.filter((p) => p.seasonHistory?.status !== "completed").length;
  const games = players.reduce((n, p) => n + p.stats.games, 0);
  const classified = players.filter((p) => p.rank && p.rank.tier !== "UNRANKED").length;
  const stats = globalMetrics(players, view, "matches");
  const highlights = recentHighlights(players, overview.recentForm);
  const awards = computeAwards(players, view, overview.sequences);
  const form = formExtremes(formRanking(players, overview.sequences));
  const leader = stats.leader?.player;
  const minimum = `Mínimo ${HIGHLIGHT_MIN_GAMES} partidas`;
  const trend = [
    {
      key: "up",
      label: "en subida",
      count: players.filter((p) => (p.momentum?.net ?? 0) > 0).length,
    },
    {
      key: "down",
      label: "en bajada",
      count: players.filter((p) => (p.momentum?.net ?? 0) < 0).length,
    },
    {
      key: "flat",
      label: "sin cambio",
      count: players.filter((p) => p.momentum?.net === 0).length,
    },
    {
      key: "none",
      label: "sin datos",
      count: players.filter((p) => p.momentum?.net == null).length,
    },
  ];
  const distribution = [...TIERS, "UNRANKED"]
    .map((tier) => ({
      tier,
      count: players.filter((p) => (p.rank?.tier ?? "UNRANKED") === tier).length,
    }))
    .filter((r) => r.count > 0);
  return (
    <div className={`metrics-page ${ranked ? "" : "is-5v5"}`}>
      <header className="metrics-bar">
        <h1>
          Métricas<span className="heading-dot">.</span>
        </h1>
        <nav className="segmented" aria-label="Tipo de partida">
          {VIEWS.map((q) => (
            <Link
              key={q}
              href={`/metrics?queue=${q}&period=${period}`}
              aria-current={q === view ? "page" : undefined}
            >
              {QUEUE_LABELS[q]}
            </Link>
          ))}
        </nav>
        <nav className="segmented" aria-label="Período">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`/metrics?queue=${view}&period=${p.key}`}
              aria-current={p.key === period ? "page" : undefined}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </header>
      <ul className="metrics-chips" aria-label="Resumen del período">
        <li>{players.length} jugadores</li>
        <li>{games.toLocaleString("es-CL")} participaciones</li>
        <li>{overview.uniqueGames.toLocaleString("es-CL")} partidas únicas</li>
        {ranked && <li>{classified} clasificados</li>}
        {partial > 0 && (
          <li className="chip-warning">
            <InfoTip align="start" term={<>{partial} con historial parcial</>}>
              Todavía se está importando el historial de {partial} jugadores: las cifras crecerán al
              completarse. Los filtros solo cambian la consulta.
            </InfoTip>
          </li>
        )}
      </ul>

      <div className="bento">
        {ranked && (
          <Block
            title="Líder ranked"
            className="span-hero"
            info="El líder se ordena por tier, división y LP oficiales actuales; no se reconstruye rango histórico con partidas."
          >
            <HeroStat
              value={leader?.rank ? `${leader.rank.leaguePoints} LP` : "—"}
              badge={leader?.rank && <RankDisplay rank={leader.rank} emblem={false} />}
              player={leader}
              view={view}
              note="Rango oficial actual"
              aside={leader && <RankEmblem tier={leader.rank?.tier} size={64} decorative />}
            />
          </Block>
        )}
        <Block
          title="Mejor winrate"
          className="span-hero"
          info={`Victorias / resultados de las partidas importadas del período. ${minimum}.`}
        >
          <HeroStat
            value={stats.bestWinrate ? `${stats.bestWinrate.rate.toFixed(1)}%` : "—"}
            player={stats.bestWinrate?.player}
            view={view}
            note={
              stats.bestWinrate
                ? `${stats.bestWinrate.wins} V / ${stats.bestWinrate.losses} D · ${minimum.toLowerCase()}`
                : minimum
            }
          />
        </Block>
        <Block
          title="Mejor KDA"
          className="span-hero"
          info={`(Kills + asistencias) / muertes, con divisor mínimo de 1. ${minimum}.`}
        >
          <HeroStat
            value={
              stats.bestKda
                ? kda(
                    stats.bestKda.stats.kills,
                    stats.bestKda.stats.deaths,
                    stats.bestKda.stats.assists,
                  ).toFixed(2)
                : "—"
            }
            player={stats.bestKda}
            view={view}
            note={minimum}
          />
        </Block>
        <Block
          title="Más partidas"
          className="span-hero"
          info="Partidas importadas del período seleccionado; los remakes no cuentan."
        >
          <HeroStat
            value={stats.mostGames?.games.toLocaleString("es-CL") ?? "—"}
            player={stats.mostGames?.player}
            view={view}
            note="Partidas del período"
          />
        </Block>

        <Block
          title="Winrate conjunto"
          className="span-community"
          info="Victorias / resultados de todo el grupo. No es un promedio simple de porcentajes."
        >
          <strong className="community-value">
            {stats.winrate === null ? "—" : `${stats.winrate.toFixed(1)}%`}
          </strong>
          <span className="community-meter" aria-hidden="true">
            <span style={{ width: `${stats.winrate ?? 0}%` }} />
          </span>
        </Block>
        <Block
          title="KDA conjunto"
          className="span-community"
          info="(Kills + asistencias) / muertes de todo el grupo, con divisor mínimo de 1."
        >
          <strong className="community-value">{stats.kda?.toFixed(2) ?? "—"}</strong>
          <small className="community-note">Todo el grupo</small>
        </Block>
        <Block
          title="Partidas por participante"
          className="span-community community-last"
          info="Participaciones del período / jugadores con partidas."
        >
          <strong className="community-value">{stats.averageGames?.toFixed(1) ?? "—"}</strong>
          <small className="community-note">Media del período</small>
        </Block>

        <Block
          title="Salón de honor"
          className="span-half awards-honor"
          info={`Winrate, KDA y forma exigen ${HIGHLIGHT_MIN_GAMES} partidas. Forma = últimas ${RECENT_FORM_GAMES}. LP: último tramo comparable del mismo tier y división. Empates: más partidas, luego nombre.`}
        >
          <AwardList awards={awards.honor} view={view} />
        </Block>
        <Block
          title="Salón de la vergüenza"
          className="span-half awards-shame"
          info={`Con cariño: mismos datos y umbrales (${HIGHLIGHT_MIN_GAMES} partidas). Los «peores» necesitan al menos 2 jugadores comparables.`}
        >
          <p className="awards-tagline">Con cariño. La próxima sale mejor.</p>
          <AwardList awards={awards.shame} view={view} />
        </Block>

        <Block
          title="Forma reciente"
          className="span-form"
          info={`Últimas ${RECENT_FORM_GAMES} partidas importadas del período, la más reciente a la izquierda. Mínimo ${HIGHLIGHT_MIN_GAMES}; remakes excluidos.`}
        >
          {form.top.length ? (
            <div className="form-groups">
              <div>
                <h3>Mejores</h3>
                <FormRows rows={form.top} view={view} />
              </div>
              {form.bottom.length > 0 && (
                <div>
                  <h3>Peores</h3>
                  <FormRows rows={form.bottom} view={view} />
                </div>
              )}
            </div>
          ) : (
            <p className="bento-empty">Nadie tiene {HIGHLIGHT_MIN_GAMES} partidas recientes.</p>
          )}
        </Block>
        {ranked && (
          <Block
            title="Tendencia de LP"
            className="span-trend"
            info="Último tramo comparable de hasta 30 registros de rango por jugador, dentro del mismo tier y división. Puede incluir ajustes de LP; no se atribuye a partidas individuales."
          >
            <TrendBar segments={trend} />
            <dl className="trend-extremes">
              {[
                { label: "Mayor subida", player: highlights.climb },
                { label: "Mayor caída", player: highlights.drop },
              ].map(({ label, player }) => (
                <div key={label}>
                  <dt>{label}</dt>
                  {player ? (
                    <dd>
                      <PlayerLink player={player} view={view} />
                      <strong className={player.momentum!.net! > 0 ? "positive" : "negative"}>
                        {signedLp(player.momentum!.net!)} LP
                      </strong>
                    </dd>
                  ) : (
                    <dd className="bento-empty">Sin tramo de {HIGHLIGHT_MIN_GAMES} partidas</dd>
                  )}
                </div>
              ))}
            </dl>
          </Block>
        )}

        <Block
          title={period === "season" ? "Actividad de temporada" : "Actividad del período"}
          className="span-activity"
          info="Cada jugador cuenta una participación: una partida compartida puede sumar varias. Remakes excluidos; mientras se importa el historial, la cobertura es parcial."
        >
          <ActivityChart points={overview.activity} />
        </Block>
        <Block
          title="Campeones más jugados"
          className="span-champions"
          info={`Uso = participaciones con el campeón / participaciones del grupo. El winrate requiere ${HIGHLIGHT_MIN_GAMES} partidas.`}
        >
          {overview.champions.length ? (
            <ul className="champion-list">
              {overview.champions.slice(0, 4).map((c) => (
                <li key={c.championId}>
                  <ChampionIdentity {...championAsset(c.championId, c.champion, assets.champions)}>
                    {games ? ((100 * c.games) / games).toFixed(1) : "0"}% de uso
                  </ChampionIdentity>
                  <span className="champion-score">
                    {c.wins} V / {c.games - c.wins} D
                    <small>
                      {c.games >= HIGHLIGHT_MIN_GAMES
                        ? `${((100 * c.wins) / c.games).toFixed(1)}% WR`
                        : `${c.games} partidas`}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bento-empty">Todavía no hay partidas en este período.</p>
          )}
        </Block>
        {ranked && (
          <Block
            title="Distribución de rangos"
            className="span-ranks"
            info="Rango oficial actual de cada jugador."
          >
            {distribution.length ? (
              <ul className="rank-bars">
                {distribution.map((r) => (
                  <li key={r.tier}>
                    <RankDisplay
                      rank={{ tier: r.tier, division: "", leaguePoints: 0, wins: 0, losses: 0 }}
                      size={18}
                    />
                    <span className="distribution-track" aria-hidden="true">
                      <span style={{ width: `${(100 * r.count) / players.length}%` }} />
                    </span>
                    <strong>{r.count}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="bento-empty">Añade jugadores para comenzar.</p>
            )}
          </Block>
        )}
      </div>
    </div>
  );
}
