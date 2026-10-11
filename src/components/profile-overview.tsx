import type { PlayerProfile } from "@/lib/types";
import { QUEUE_LABELS, type View } from "@/lib/queues";
import { kda, winrate } from "@/lib/stats";
import { HIGHLIGHT_MIN_GAMES } from "@/lib/global-metrics";
import { championAsset, type ChampionCatalog } from "@/lib/champion-assets";
import { Block } from "./metrics-bento";
import { RankEmblem } from "./rank-emblem";
import { RankDisplay } from "./rank-display";
import { LPDisplay } from "./lp-display";
import { PlayerMomentum } from "./player-momentum";
import { RecentChampionForm } from "./recent-champion-form";
import { ChampionIdentity } from "./champion-identity";
import { HistoryStatusLabel } from "./history-status";

/*
 * Player overview bento. Each block keeps its data source explicit: the official (or
 * fictional demo) ranked state is never mixed with statistics of the imported history.
 * Presentation only: every value comes from the same profile fields and formulas.
 */

type Source = { player: PlayerProfile; demo: boolean };

const importedTag = (demo: boolean) => (demo ? "HISTORIAL FICTICIO" : "HISTORIAL IMPORTADO");

/** Ranked queues only: 5v5 has no rank or LP of its own, so no block is rendered. */
export function RankBlock({ player, view, demo }: Source & { view: Exclude<View, "5v5"> }) {
  return (
    <Block
      title="RANGO ACTUAL"
      tag={`${QUEUE_LABELS[view].toUpperCase()} · ${demo ? "FICTICIO" : "OFICIAL"}`}
      className="profile-block-rank"
    >
      <div className="profile-rank-heading">
        <RankEmblem tier={player.rank?.tier} size={112} decorative />
        <div className="profile-rank-copy">
          <RankDisplay rank={player.rank} emblem={false} />
          <LPDisplay rank={player.rank} />
        </div>
      </div>
      <div className="profile-momentum">
        <PlayerMomentum metrics={player.momentum} detailed demo={demo} />
      </div>
    </Block>
  );
}

/** Official ranked counters when a rank exists; otherwise the imported record. */
export function RecordBlock({ player, view, demo }: Source & { view: View }) {
  const official = view !== "5v5" && !!player.rank;
  const record = official && player.rank ? player.rank : player.stats;
  const games = record.wins + record.losses;
  const rate = winrate(record.wins, record.losses);
  return (
    <Block
      title={view === "5v5" ? "REGISTRO 5V5" : official ? "REGISTRO RANKED" : "REGISTRO IMPORTADO"}
      tag={official ? (demo ? "FICTICIO" : "OFICIAL") : importedTag(demo)}
      className="profile-block-record"
    >
      <div className="record-summary">
        <strong className="record-rate">
          {games ? `${rate.toFixed(1)}%` : "—"} <small>WR</small>
        </strong>
        <span className="profile-record">
          <strong className="positive">{record.wins} V</strong>
          <span>{record.losses} D</span>
        </span>
      </div>
      <div className={`winrate-track ${games ? "" : "no-games"}`} aria-hidden="true">
        <span style={{ width: `${rate}%` }} />
      </div>
      <p className="record-caption">
        {games} partidas {official ? "en el estado ranked actual" : "importadas"}
      </p>
      {view === "5v5" && (
        <p className="record-caption">Sin rango propio: 5v5 no tiene rango ni LP.</p>
      )}
    </Block>
  );
}

export function FormBlock({ player, champions, demo }: Source & { champions: ChampionCatalog }) {
  return (
    <Block title="FORMA RECIENTE" tag="ÚLTIMAS 5" className="profile-block-form">
      <div className="profile-form">
        <RecentChampionForm matches={player.recent} champions={champions} />
      </div>
      <p className="record-caption">
        Más reciente a la izquierda · {demo ? "historial ficticio" : "historial importado"}
      </p>
    </Block>
  );
}

export function CombatBlock({ player, demo }: Source) {
  const { stats } = player;
  return (
    <Block title="COMBATE" tag={importedTag(demo)} className="profile-block-combat">
      <HistoryStatusLabel history={player.seasonHistory} demo={demo} compact />
      <section className="stat-strip" aria-label="Estadísticas del historial importado">
        <div>
          <span>KDA</span>
          <strong>
            {stats.games ? kda(stats.kills, stats.deaths, stats.assists).toFixed(2) : "—"}
          </strong>
        </div>
        <div>
          <span>CS / MIN</span>
          <strong>{stats.duration ? (stats.cs / (stats.duration / 60)).toFixed(1) : "—"}</strong>
        </div>
        <div>
          <span>DAÑO / PARTIDA</span>
          <strong>
            {stats.games ? Math.round(stats.damage / stats.games).toLocaleString("es-CL") : "—"}
          </strong>
        </div>
        <div>
          <span>PARTIDAS IMPORTADAS</span>
          <strong>{stats.games}</strong>
        </div>
      </section>
    </Block>
  );
}

const POOL_SUMMARY = 3;

export function ChampionPoolBlock({
  player,
  champions,
  demo,
}: Source & { champions: ChampionCatalog }) {
  const rows = player.champions.map((c) => (
    <div className="champion-row" key={c.championId}>
      <ChampionIdentity {...championAsset(c.championId, c.champion, champions)}>
        {c.games} partidas · {kda(c.kills, c.deaths, c.assists).toFixed(2)} KDA
      </ChampionIdentity>
      <div className="champion-rate">
        <strong
          className={
            c.games >= HIGHLIGHT_MIN_GAMES && winrate(c.wins, c.losses) >= 50 ? "positive" : ""
          }
        >
          {c.games >= HIGHLIGHT_MIN_GAMES ? `${winrate(c.wins, c.losses).toFixed(0)}%` : "— WR"}
        </strong>
        <span>
          {c.wins} V / {c.losses} D
        </span>
      </div>
    </div>
  ));
  return (
    <Block title="POOL DE CAMPEONES" tag={importedTag(demo)} className="profile-block-pool">
      {rows.length ? (
        <>
          <div className="profile-pool-grid">{rows.slice(0, POOL_SUMMARY)}</div>
          {rows.length > POOL_SUMMARY && (
            <details className="disclosure disclosure-inline profile-pool-more">
              <summary>Ver pool completo ({rows.length} campeones)</summary>
              <div className="profile-pool-grid">{rows.slice(POOL_SUMMARY)}</div>
            </details>
          )}
        </>
      ) : (
        <p className="empty-copy">Aún no hay partidas importadas en esta cola.</p>
      )}
      <p className="metric-note">
        Winrate por campeón desde {HIGHLIGHT_MIN_GAMES} partidas; muestras menores muestran V/D.
      </p>
    </Block>
  );
}
