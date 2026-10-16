import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { normalizedRivalIds, resolveSharedRivalry } from "@/lib/shared-rivalry";
import { ladderQuery, parseLadderFilters, type LadderSearchParams } from "@/lib/ladder-filters";
import { parseView, QUEUE_LABELS } from "@/lib/queues";
import { getLeaderboard } from "@/server/queries";
import { getAssets } from "@/server/riot/assets";
import { isDemo } from "@/server/env";
import { ManualDuel } from "@/components/manual-duel";
import { VersusComparison } from "@/components/versus-comparison";
import { ShareRivalry } from "@/components/share-rivalry";
import { PageHeading } from "@/components/page-heading";
import { QueueTabs } from "@/components/queue-tabs";
import type { PublicPlayer } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Comparación VS",
  description:
    "Compara rango, forma y estadísticas importadas de dos jugadores de SoloQ, sin un ganador global.",
};
type Props = {
  params: Promise<{ first: string; second: string }>;
  searchParams: Promise<LadderSearchParams>;
};
export default async function SharedDuelPage({ params, searchParams }: Props) {
  const { first, second } = await params;
  const ids = normalizedRivalIds([first, second]);
  const input = await searchParams;
  const view = parseView(input.queue);
  if (!ids || view === "5v5" || (input.queue !== undefined && input.queue !== view)) notFound();
  const filters = parseLadderFilters(view, input);
  const rankingHref = "/" + ladderQuery(view, filters) + "#clasificacion";
  const [players, assets] = await Promise.all([getLeaderboard(view), getAssets()]);
  const manual = input.tipo === "elegida";
  const pair = ids.map((id) => players.find((p) => p.id.toLowerCase() === id));
  const result = resolveSharedRivalry(players, view, { status: "requested", ids });
  const available =
    pair[0] &&
    pair[1] &&
    pair[0].platform === pair[1].platform &&
    (manual || result.status === "ready");
  const demo = isDemo();
  return (
    <>
      <Link className="back-link" href={rankingHref}>
        ← Volver a la clasificación
      </Link>
      <PageHeading
        dot={false}
        title={available ? "Cara a cara" : "Comparación no disponible"}
        lead="Rango, forma y rendimiento. Sin marcador global."
        meta={
          available
            ? pair.map((p) => p!.gameName).join(" vs ") + " · " + QUEUE_LABELS[view]
            : QUEUE_LABELS[view]
        }
        aside={
          available ? (
            <ShareRivalry
              ids={ids}
              view={view}
              filters={filters}
              manual={manual}
              label="Compartir VS"
            />
          ) : undefined
        }
      />
      <QueueTabs
        view={view}
        views={["soloq", "flex"]}
        label="Modalidad del VS"
        hrefFor={(q) =>
          "/rivalidad/" +
          ids.join("/") +
          ladderQuery(q, parseLadderFilters(q, input)) +
          (manual ? "&tipo=elegida" : "")
        }
      />
      {available ? (
        <>
          <ManualDuel
            players={pair as [PublicPlayer, PublicPlayer]}
            view={view}
            version={assets.version}
            demo={demo}
            automatic={!manual}
          />
          <VersusComparison
            players={pair as [PublicPlayer, PublicPlayer]}
            view={view}
            champions={assets.champions}
            demo={demo}
          />
        </>
      ) : (
        <p className="data-note">
          Este enfrentamiento ya no está disponible con los rangos actuales o sus jugadores no
          pertenecen a la misma región. Puedes volver a la clasificación para encontrar otros
          rivales.
        </p>
      )}
      <p className="page-note">
        Comparación de los registros actuales; el enlace no congela los LP ni acredita una partida
        entre ambos jugadores. No se almacena esta comparación.
      </p>
    </>
  );
}
