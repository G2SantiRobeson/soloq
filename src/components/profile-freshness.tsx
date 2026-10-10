import type { View } from "@/lib/queues";
import { InfoTip } from "./info-tip";

function Timestamp({ timestamp, observedAt }: { timestamp: string | null; observedAt: string }) {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp)))
    return <span>Sin cobertura registrada</span>;
  const elapsed = Math.max(0, Date.parse(observedAt) - Date.parse(timestamp));
  const relative =
    elapsed < 3600_000
      ? `hace ${Math.max(1, Math.floor(elapsed / 60000))} min`
      : elapsed < 86400_000
        ? `hace ${Math.floor(elapsed / 3600_000)} h`
        : `hace ${Math.floor(elapsed / 86400_000)} días`;
  return (
    <time dateTime={timestamp}>
      {relative}
      <span className="sr-only"> · {exactDate(timestamp)}</span>
    </time>
  );
}

function exactDate(timestamp: string) {
  return `${new Date(timestamp).toLocaleString("es-CL", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })} UTC`;
}

/** Read-only evidence: neither timestamp implies that all profile data is complete. */
export function ProfileFreshness({
  rankCheckedAt,
  lastSyncedAt,
  observedAt,
  view,
  demo = false,
}: {
  rankCheckedAt: string | null;
  lastSyncedAt: string | null;
  observedAt: string;
  view: View;
  demo?: boolean;
}) {
  const rankKnown = rankCheckedAt !== null && Number.isFinite(Date.parse(rankCheckedAt));
  const recentKnown = lastSyncedAt !== null && Number.isFinite(Date.parse(lastSyncedAt));
  return (
    <dl className="profile-freshness" aria-label="Actualización del perfil">
      {view !== "5v5" && (
        <div>
          <dt>{demo ? "Rangos de demo:" : "Rangos verificados:"}</dt>
          <dd>
            <InfoTip
              term={
                demo ? (
                  "Simulados"
                ) : rankKnown ? (
                  <Timestamp timestamp={rankCheckedAt} observedAt={observedAt} />
                ) : (
                  "Sin verificación registrada"
                )
              }
              align="start"
            >
              {demo
                ? "Rangos ficticios de demo; no se verifican en Riot."
                : `${rankKnown ? `${exactDate(rankCheckedAt!)}. ` : "Fecha desconocida. "}Última consulta satisfactoria de los rangos del jugador a Riot. Es una verificación compartida, no exclusiva de esta cola; también puede confirmar que el jugador está Unranked. No implica importar partidas.`}
            </InfoTip>
          </dd>
        </div>
      )}
      <div>
        <dt>{demo ? "Cobertura simulada:" : "Cobertura reciente:"}</dt>
        <dd>
          <InfoTip
            term={<Timestamp timestamp={lastSyncedAt} observedAt={observedAt} />}
            align="start"
          >
            {demo
              ? `${recentKnown ? `${exactDate(lastSyncedAt!)}. ` : ""}Referencia ficticia de demo; no se importan partidas de Riot.`
              : `${recentKnown ? `Cubiertas hasta ${exactDate(lastSyncedAt!)}. ` : "Fecha desconocida. "}Límite de cobertura completa de la importación incremental reciente del jugador, no la fecha de su última partida. No garantiza que todo el historial de temporada ni todas las partidas estén disponibles; no indica cuándo se verificó el rango.`}
          </InfoTip>
        </dd>
      </div>
    </dl>
  );
}
