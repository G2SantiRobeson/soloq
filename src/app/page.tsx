import { parseSharedRivalry } from "@/lib/shared-rivalry";
import { parseView } from "@/lib/queues";
import { parseLadderFilters, type LadderSearchParams } from "@/lib/ladder-filters";
import Link from "next/link";
import { ChartNoAxesCombined } from "lucide-react";
import { getLeaderboard } from "@/server/queries";
import { getAssets } from "@/server/riot/assets";
import { QueueTabs } from "@/components/queue-tabs";
import { Leaderboard } from "@/components/leaderboard";
import { getSyncStatus } from "@/server/sync/status";
import { isDemo } from "@/server/env";
import { weekStart } from "@/lib/time";
import { CURRENT_SEASON } from "@/lib/season";
import { PageHeading } from "@/components/page-heading";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<LadderSearchParams>;
}) {
  const params = await searchParams;
  const view = parseView(params.queue);
  const demo = isDemo();
  const weekStartedAt = weekStart().toISOString();
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
      <PageHeading
        title="La clasificación"
        meta={`Comunidad de League of Legends · ${CURRENT_SEASON.label}`}
        figures={[
          { label: "Jugadores", value: players.length.toLocaleString("es-CL") },
          {
            label: demo
              ? "Resultados ficticios"
              : view === "5v5"
                ? "Resultados importados"
                : "Resultados ranked",
            value: games.toLocaleString("es-CL"),
          },
        ]}
      />
      <div className="ladder-navigation">
        <QueueTabs view={view} />
        <Link className="button secondary ladder-metrics-button" href={`/metrics?queue=${view}`}>
          <ChartNoAxesCombined size={17} aria-hidden="true" />
          Ver métricas
        </Link>
      </div>
      <Leaderboard
        demo={demo}
        weekStartedAt={weekStartedAt}
        players={players}
        view={view}
        version={assets.version}
        champions={assets.champions}
        sync={sync}
        initialFilters={parseLadderFilters(view, params)}
        initialSharedRivalry={parseSharedRivalry(params, view)}
        key={view}
      />
      <aside className="data-note">
        <h2>Cómo leer el ranking</h2>
        <p>
          {demo
            ? "Clasificación de demostración con jugadores, rangos, LP y partidas ficticios. Las estadísticas y la forma reciente describen únicamente estos fixtures. "
            : view === "5v5"
              ? "5v5 reúne partidas PvP estándar de Summoner’s Rift, incluidas SoloQ, Flex y Clash. Sin rango combinado. El orden inicial es por winrate del historial importado."
              : "Orden inicial por tier, división y LP oficiales. V/D y winrate ranked corresponden a la temporada; KDA y forma reciente, al historial importado. Los jugadores sin rango muestran su registro importado."}{" "}
          {view !== "5v5" &&
            "Bajo los LP: variación neta verificable de las cinco partidas visibles. Δ semana y V/D usan el mismo intervalo entre observaciones, con referencia al lunes 00:00 de Santiago o un inicio parcial indicado. Una referencia anterior al lunes puede incluir actividad previa. Los valores no verificables no se estiman. "}
          La partida más reciente aparece a la izquierda. Los remakes se muestran con una flecha
          circular y se excluyen de las estadísticas{" "}
          {demo ? "de demostración" : "del historial importado"}.
        </p>
      </aside>
    </>
  );
}
