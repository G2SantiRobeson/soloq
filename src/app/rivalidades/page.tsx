import type { Metadata } from "next";
import { getLeaderboard } from "@/server/queries";
import { getAssets } from "@/server/riot/assets";
import { isDemo } from "@/server/env";
import { parseView } from "@/lib/queues";
import { parseLadderFilters, ladderQuery, type LadderSearchParams } from "@/lib/ladder-filters";
import { PLATFORMS, PLATFORM_LABELS } from "@/lib/routing";
import { selectRivalries } from "@/lib/rivalries";
import { weekStart } from "@/lib/time";
import { RivalriesSummary } from "@/components/rivalries-summary";
import { PageHeading } from "@/components/page-heading";
import { QueueTabs } from "@/components/queue-tabs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Rivalidades",
  description:
    "Los duelos automáticos de la comunidad, sus rangos actuales y cambios de liderazgo observados.",
};
export default async function RivalriesPage({
  searchParams,
}: {
  searchParams: Promise<LadderSearchParams>;
}) {
  const params = await searchParams,
    view = parseView(params.queue),
    filters = parseLadderFilters(view, params);
  const [players, assets] = await Promise.all([
    view === "5v5" ? Promise.resolve([]) : getLeaderboard(view),
    getAssets(),
  ]);
  const pool = players.filter(
    (p) =>
      (filters.region === "all" || p.platform === filters.region) &&
      (p.gameName + "#" + p.tagLine).toLowerCase().includes(filters.search.toLowerCase()),
  );
  const rivalries = selectRivalries(pool, view);
  return (
    <>
      <PageHeading
        title="Rivalidades"
        lead="Quién va por delante, quién se acerca y quién le quitó el trono al otro."
        meta="Duelos de clasificación automáticos entre vecinos del ranking de la misma región"
        figures={[
          {
            label: rivalries.length === 1 ? "Duelo" : "Duelos",
            value: rivalries.length.toLocaleString("es-CL"),
          },
        ]}
      />
      <div className="rivalries-toolbar">
        <QueueTabs
          view={view}
          views={["soloq", "flex"]}
          label="Modalidad de rivalidades"
          hrefFor={(q) => "/rivalidades" + ladderQuery(q, filters)}
        />
        <form className="rivalries-filters" action="/rivalidades" method="get">
          <input type="hidden" name="queue" value={view} />
          <input type="hidden" name="sort" value={filters.sort} />
          <input type="hidden" name="dir" value={filters.ascending ? "asc" : "desc"} />
          <div className="rivalries-filter-field">
            <label htmlFor="rivalries-region">Región</label>
            <select id="rivalries-region" name="region" defaultValue={filters.region}>
              <option value="all">Todas las regiones</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="rivalries-filter-field">
            <label htmlFor="rivalries-search">Jugador</label>
            <input
              id="rivalries-search"
              name="q"
              defaultValue={filters.search}
              maxLength={40}
              placeholder="Nombre#TAG"
            />
          </div>
          <button className="button secondary" type="submit">
            Filtrar
          </button>
        </form>
      </div>
      {view === "5v5" ? (
        <p className="data-note">5v5 no tiene rivalidades ranked. Elige SoloQ o Flex.</p>
      ) : rivalries.length ? (
        <RivalriesSummary
          rivalries={rivalries}
          view={view}
          version={assets.version}
          demo={isDemo()}
          filters={filters}
          weekStartedAt={weekStart().toISOString()}
        />
      ) : (
        <p className="data-note" role="status">
          No hay rivalidades automáticas con estos filtros. Prueba otra región o elimina la
          búsqueda.
        </p>
      )}
      <p className="page-note">
        Hasta tres enfrentamientos destacados, sin jugadores repetidos. Se comparan rangos de la
        misma plataforma; las elecciones manuales permanecen en los perfiles.
      </p>
    </>
  );
}
