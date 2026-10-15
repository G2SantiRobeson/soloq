import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { normalizedRivalIds, resolveSharedRivalry } from "@/lib/shared-rivalry";
import { ladderQuery, parseLadderFilters, type LadderSearchParams } from "@/lib/ladder-filters";
import { parseView, QUEUE_LABELS } from "@/lib/queues";
import { getLeaderboard } from "@/server/queries";
import { getAssets } from "@/server/riot/assets";
import { isDemo } from "@/server/env";
import { Rivalries } from "@/components/rivalries";
import { rivalryKey } from "@/lib/weekly-rivalry";
import { ManualDuel } from "@/components/manual-duel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Enfrentamiento compartido | SoloQ" };
type Props = {
  params: Promise<{ first: string; second: string }>;
  searchParams: Promise<LadderSearchParams>;
};
export default async function SharedDuelPage({ params, searchParams }: Props) {
  const { first, second } = await params;
  const ids = normalizedRivalIds([first, second]);
  const filtersInput = await searchParams;
  const view = parseView(filtersInput.queue);
  if (!ids || view === "5v5") notFound();
  const filters = parseLadderFilters(view, filtersInput);
  const rankingHref = "/" + ladderQuery(view, filters) + "#clasificacion";
  const [players, assets] = await Promise.all([getLeaderboard(view), getAssets()]);
  // Identify the duel independently of search; keep filters for the return link.
  const result = resolveSharedRivalry(players, view, { status: "requested", ids });
  const manual = filtersInput.tipo === "elegida";
  const pair = ids.map((id) => players.find((p) => p.id.toLowerCase() === id));
  return (
    <>
      <Link className="back-link" href={rankingHref}>
        ← Volver a la clasificación
      </Link>
      <section className="ladder-heading">
        <div>
          <div className="eyebrow">ENFRENTAMIENTO COMPARTIDO · {QUEUE_LABELS[view]}</div>
          <h1>
            {pair.every(Boolean)
              ? pair.map((p) => p!.gameName).join(" vs ")
              : "Rivalidad no disponible"}
          </h1>
        </div>
      </section>
      {manual && pair[0] && pair[1] && pair[0].platform === pair[1].platform ? (
        <ManualDuel
          players={[pair[0], pair[1]]}
          view={view}
          version={assets.version}
          demo={isDemo()}
        />
      ) : !manual && result.status === "ready" ? (
        <Rivalries
          rivalries={[result.rivalry]}
          view={view}
          version={assets.version}
          demo={isDemo()}
          weeklyEnabled={false}
          filters={filters}
          sharedPairKey={rivalryKey(result.rivalry)}
          rankingHref={rankingHref}
        />
      ) : (
        <p className="data-note">
          Este enfrentamiento ya no está disponible con los rangos actuales. Puedes volver a la
          clasificación para encontrar otros rivales.
        </p>
      )}
      <p className="page-note">
        Comparación de los registros actuales; el enlace no congela los LP ni acredita una partida
        entre ambos jugadores.
      </p>
    </>
  );
}
