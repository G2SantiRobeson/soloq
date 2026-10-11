import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeftRight, FingerprintPattern, TrendingUp } from "lucide-react";
import { getProfile } from "@/server/queries";
import { getAssets, profileIconUrl } from "@/server/riot/assets";
import { parseView, STANDARD_QUEUES } from "@/lib/queues";
import { PLATFORM_LABELS } from "@/lib/routing";
import { winrate } from "@/lib/stats";
import { matchOutcome } from "@/lib/match-outcome";
import { RankAvatar } from "@/components/rank-avatar";
import { LpDeltaSummary } from "@/components/lp-delta-summary";
import { championAsset } from "@/lib/champion-assets";
import { ChampionIdentity } from "@/components/champion-identity";
import { ProfileFreshness } from "@/components/profile-freshness";
import { QueueTabs } from "@/components/queue-tabs";
import { BackToLadder } from "@/components/back-link";
import { MatchHistory } from "@/components/match-history";
import { RankChart } from "@/components/rank-chart";
import { PerformanceChart } from "@/components/performance-chart";
import { HistoryStatusLabel } from "@/components/history-status";
import { CURRENT_SEASON, seasonStart } from "@/lib/season";
import { DisclosureLabel } from "@/components/disclosure";
import {
  ChampionPoolBlock,
  CombatBlock,
  FormBlock,
  RankBlock,
  RecordBlock,
} from "@/components/profile-overview";
import { Suspense } from "react";
import {
  PlayerSignatureSection,
  PlayerSignatureSkeleton,
} from "@/components/player-signature-section";
import { toSignaturePlayer } from "@/lib/signature";
import { isDemo } from "@/server/env";
import {
  ProfileAchievements,
  ProfileOtpHighlight,
} from "@/components/achievements/profile-achievements";
import { profileAchievementLoader } from "@/server/achievements/profile";
import { countLabel } from "@/lib/format";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ queue?: string }> };
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const player = await getProfile(id, parseView((await searchParams).queue));
  const title = player ? `${player.gameName}#${player.tagLine}` : "Jugador no encontrado";
  const description = isDemo()
    ? `Perfil ficticio de ${title} en la demo de SoloQ. Rangos, LP y partidas simulados.`
    : `Rango, campeones y partidas de ${title} en SoloQ.`;
  return { title, description, openGraph: { title: `${title} | SoloQ`, description } };
}
export default async function PlayerPage({ params, searchParams }: Props) {
  const demo = isDemo();
  const { id } = await params;
  const view = parseView((await searchParams).queue);
  const [player, assets] = await Promise.all([getProfile(id, view), getAssets()]);
  if (!player) notFound();
  const signatureInput = toSignaturePlayer(
    player,
    view,
    (championId, fallback) => championAsset(championId, fallback, assets.champions).name,
  );
  const source = { player, demo };
  // Lazy: nothing runs unless the flag allows a consumer to render; both consumers share it.
  const achievements = profileAchievementLoader(id, view, player.observedAt, assets.champions);
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
          <ProfileFreshness
            rankCheckedAt={player.rankCheckedAt ?? null}
            lastSyncedAt={player.lastSyncedAt}
            observedAt={player.observedAt}
            view={view}
            demo={demo}
          />
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
      {/* Bento order is also the mobile reading order: rank/record, form, stats, pool, extras. */}
      <div className={`profile-bento${view === "5v5" ? " is-5v5" : ""}`}>
        {view !== "5v5" && <RankBlock {...source} view={view} />}
        <RecordBlock {...source} view={view} />
        <FormBlock {...source} champions={assets.champions} />
        <CombatBlock {...source} />
        <ChampionPoolBlock {...source} champions={assets.champions}>
          <ProfileOtpHighlight view={view} load={achievements} champions={assets.champions} />
        </ChampionPoolBlock>
        <details className="disclosure disclosure-block profile-disclosure">
          <summary>
            <DisclosureLabel
              icon={<FingerprintPattern size={18} />}
              title="Firma competitiva"
              hint="Lecturas estadísticas del jugador frente a referencias de la comunidad o del sistema"
            />
          </summary>
          <Suspense fallback={<PlayerSignatureSkeleton name={player.gameName} />}>
            <PlayerSignatureSection
              input={signatureInput}
              view={view}
              name={player.gameName}
              tier={view === "5v5" ? null : (player.rank?.tier ?? null)}
            />
          </Suspense>
        </details>
        <ProfileAchievements
          playerId={id}
          view={view}
          asOf={player.observedAt}
          champions={assets.champions}
          load={achievements}
        />
      </div>
      <div className="profile-progression-grid">
        <section className="panel evolution-panel">
          <div className="panel-title">
            <h2>
              <TrendingUp size={17} /> Progresión de rango
            </h2>
            <span>{demo ? "REGISTROS FICTICIOS" : "REGISTROS OFICIALES"}</span>
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
                  : "Aún no hay registros de rango en esta temporada."}
              </p>
              <RankChart key={`${id}-${view}`} history={player.history} demo={demo} />
            </>
          )}
        </section>
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
          <HistoryStatusLabel history={player.seasonHistory} demo={demo} />
          <div className="season-record">
            <strong>{countLabel(player.stats.games, "partida", "partidas")}</strong>
            <span>
              {player.stats.wins} V / {player.stats.losses} D
            </span>
            <strong>
              {player.stats.games
                ? `${winrate(player.stats.wins, player.stats.losses).toFixed(1)}% WR`
                : "— WR"}
            </strong>
          </div>
          <PerformanceChart points={player.performance} demo={demo} />
        </section>
      </div>
      {view !== "5v5" && (
        <details className="disclosure disclosure-block lp-history-details">
          <summary>
            <DisclosureLabel
              icon={<ArrowLeftRight size={18} />}
              title={`Cambios de LP entre registros ${demo ? "ficticios" : "oficiales"}`}
              hint="Intervalos observados y su nivel de confianza; Riot no informa LP por partida"
            />
          </summary>
          <LpDeltaSummary observations={player.lpObservations} demo={demo} />
        </details>
      )}
      <MatchHistory
        demo={demo}
        key={`${id}-${view}`}
        rows={player.recent.map((m) => (
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
                  {m.killParticipation === null ? "—" : `${Math.round(m.killParticipation * 100)}%`}{" "}
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
        ))}
      />
      <p className="page-note">
        {demo
          ? "Las estadísticas de combate y campeones corresponden al historial ficticio de demo."
          : "Las estadísticas de combate y campeones corresponden al historial importado; pueden cubrir menos partidas que el registro ranked de la temporada."}{" "}
        Fechas en UTC.
      </p>
    </>
  );
}
