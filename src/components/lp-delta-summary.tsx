import { signedLp } from "@/lib/lp-metrics";
import type { LpObservation } from "@/lib/history";
export function LpDeltaSummary({
  observations,
  demo = false,
}: {
  observations: LpObservation[];
  demo?: boolean;
}) {
  return (
    <section className="lp-summary" aria-labelledby="lp-summary-heading">
      <div className="section-heading">
        <h2 id="lp-summary-heading">Cambios de LP observados</h2>
        <span>{demo ? "ENTRE REGISTROS FICTICIOS" : "ENTRE REGISTROS REALES"}</span>
      </div>
      {!observations.length ? (
        <p className="metric-note">
          Hacen falta dos registros de rango comparables. Riot no informa los LP ganados o perdidos
          en cada partida.
        </p>
      ) : (
        <div className="lp-observations">
          {observations.toReversed().map((o) => (
            <article key={`${o.from}-${o.to}`}>
              <time dateTime={o.to}>
                {new Date(o.to).toLocaleString("es-CL", {
                  timeZone: "UTC",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}{" "}
                UTC
              </time>
              <strong className={o.delta !== null ? (o.delta >= 0 ? "positive" : "negative") : ""}>
                {o.delta === null ? o.label : `${signedLp(o.delta)} LP`}
              </strong>
              <span>{o.confidence === "unknown" ? "LP indeterminados" : o.label}</span>
              {o.matchId && <small>Partida {o.matchId}</small>}
            </article>
          ))}
        </div>
      )}
      <p className="metric-note">
        Confianza alta: una partida coincide temporalmente con el intervalo y con los contadores
        {demo ? "simulados" : "oficiales"}, sin cambio de rango. Agregado: varias partidas; no se
        reparte el cambio entre ellas. Ascensos, descensos o datos incompletos: indeterminado.
        Incluso una observación aislada puede incluir ajustes externos; no es la cantidad de LP que
        Riot asignó a esa partida.
      </p>
    </section>
  );
}
