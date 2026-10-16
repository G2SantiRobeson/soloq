import Link from "next/link";
import { profileIconAsset } from "@/lib/profile-icon";
import { sharedRivalryPath } from "@/lib/shared-rivalry";
import { parseLadderFilters } from "@/lib/ladder-filters";
import { Crosshair } from "lucide-react";
import { Avatar } from "./avatar";
import { RankDisplay } from "./rank-display";
import type { ProfileRivalResult } from "@/server/profile-rival";
import type { View } from "@/lib/queues";
import { rankedQueue } from "@/lib/queues";
export function ProfileRival({
  result,
  view,
  version,
  demo,
}: {
  result: ProfileRivalResult;
  view: View;
  version: string | null;
  demo: boolean;
}) {
  if (!rankedQueue(view)) return null;
  return (
    <section className="profile-rival" aria-label="Rival en la mira">
      <h2>
        <Crosshair size={16} aria-hidden="true" />
        Rival en la mira {demo && <span className="leadership-demo-badge">Ficticio · Demo</span>}
      </h2>
      {result.status === "ready" ? (
        (() => {
          const { rival, pair, relation } = result.selection;
          return (
            <div className="profile-rival-content">
              <Link
                className="profile-rival-identity"
                href={"/player/" + rival.id + "?queue=" + view}
              >
                <Avatar
                  name={rival.gameName}
                  decorative
                  size={36}
                  src={profileIconAsset(version, rival.profileIconId)}
                />
                <span>
                  <strong>{rival.gameName}</strong>
                  <span className="tagline">#{rival.tagLine}</span>
                </span>
                <RankDisplay rank={rival.rank} size={24} />
                <strong className="numeric">{rival.rank.leaguePoints} LP</strong>
              </Link>
              <p>
                {pair.lpDifference === null
                  ? "Está " +
                    (relation === "ahead" ? "por delante" : "por detrás") +
                    " por división; no hay diferencia de LP comparable."
                  : relation === "tied"
                    ? "Mismo rango y LP registrados."
                    : "Está " +
                      pair.lpDifference +
                      " LP " +
                      (relation === "ahead" ? "por delante" : "por detrás") +
                      " respecto a " +
                      result.selection.player.gameName +
                      ", según el estado registrado."}
              </p>
              <Link
                href={
                  sharedRivalryPath(
                    view,
                    [result.selection.player.id, rival.id],
                    parseLadderFilters(view, { region: rival.platform }),
                  ) ?? "/?queue=" + view + "&region=" + rival.platform + "#clasificacion"
                }
              >
                Ver enfrentamiento
              </Link>
            </div>
          );
        })()
      ) : (
        <p className="profile-rival-empty">
          {result.status === "incomplete"
            ? "No hay una lectura completa y compatible para asignar un rival."
            : result.status === "changed"
              ? "El rango cambió entre lecturas. Recarga el perfil para comparar."
              : "No hay un rival cercano elegible en esta modalidad y región."}
        </p>
      )}
    </section>
  );
}
