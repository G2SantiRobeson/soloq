import { parseView } from "@/lib/queues";
import Link from "next/link";
import { getLeaderboard } from "@/server/queries";
import { getAssets } from "@/server/riot/assets";
import { QueueTabs } from "@/components/queue-tabs";
import { Leaderboard } from "@/components/leaderboard";
import { getSyncStatus } from "@/server/sync/status";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string }>;
}) {
  const view = parseView((await searchParams).queue);
  const [players, assets, sync] = await Promise.all([
    getLeaderboard(view),
    getAssets(),
    getSyncStatus(),
  ]);
  const games = players.reduce(
    (total, p) => total + (view !== "5v5" && p.rank ? p.rank.wins + p.rank.losses : p.stats.games),
    0,
  );
  return (
    <>
      <section className="ladder-heading">
        <div>
          <div className="eyebrow">LEAGUE OF LEGENDS / COMMUNITY LADDER</div>
          <h1>
            La clasificación<span className="heading-dot">.</span>
          </h1>
        </div>
        <dl className="ladder-summary">
          <div>
            <dt>JUGADORES</dt>
            <dd>{String(players.length).padStart(2, "0")}</dd>
          </div>
          <div>
            <dt>{view === "5v5" ? "RESULTADOS IMPORTADOS" : "RESULTADOS RANKED"}</dt>
            <dd>{games.toLocaleString("es-CL")}</dd>
          </div>
        </dl>
      </section>
      <QueueTabs view={view} />
      <Leaderboard
        players={players}
        view={view}
        version={assets.version}
        champions={assets.champions}
        sync={sync}
        key={view}
      />
      <Link className="metrics-link" href={`/metrics?queue=${view}`}>
        Ver métricas de la comunidad →
      </Link>
      <aside className="data-note">
        <span>LECTURA DEL RANKING</span>
        <p>
          {view === "5v5"
            ? "5v5 reúne partidas PvP estándar de Summoner’s Rift, incluidas SoloQ, Flex y Clash. Sin rango combinado. El orden inicial es por winrate del historial importado."
            : "Orden inicial por tier, división y LP oficiales. V/D y winrate ranked corresponden a la temporada; KDA y forma reciente, al historial importado. Los jugadores sin rango muestran su registro importado."}{" "}
          La partida más reciente aparece a la izquierda. Los remakes se muestran con una flecha
          circular y se excluyen de las estadísticas del historial importado.
        </p>
      </aside>
    </>
  );
}
