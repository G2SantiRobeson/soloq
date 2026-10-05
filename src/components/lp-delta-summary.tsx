import { signedLp, LP_WINDOW, type LpMetrics } from "@/lib/lp-metrics";
export function LpDeltaSummary({ metrics }: { metrics: LpMetrics | null }) {
  if (!metrics) return null;
  const show = (n: number | null) => (n === null ? "—" : signedLp(n, 1));
  const date = (s: string) =>
    new Date(s).toLocaleString("es-CL", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return (
    <section className="lp-summary" aria-labelledby="lp-summary-heading">
      <div className="section-heading">
        <h2 id="lp-summary-heading">Balance de LP</h2>
        <span>ESTIMADO ENTRE REGISTROS</span>
      </div>
      <dl className="lp-metrics">
        <div>
          <dt>Cambio neto</dt>
          <dd className={metrics.net !== null && metrics.net < 0 ? "negative" : "positive"}>
            {metrics.net === null ? "—" : signedLp(metrics.net)}
            <small> LP</small>
          </dd>
          <span>{metrics.intervals} intervalos</span>
        </div>
        <div>
          <dt>LP / victoria</dt>
          <dd>{show(metrics.perWin)}</dd>
          <span>{metrics.winsSample} victorias aisladas</span>
        </div>
        <div>
          <dt>LP / derrota</dt>
          <dd>{show(metrics.perLoss)}</dd>
          <span>{metrics.lossesSample} derrotas aisladas</span>
        </div>
        <div>
          <dt>Neto / partida</dt>
          <dd>{show(metrics.perGame)}</dd>
          <span>{metrics.games} partidas observadas</span>
        </div>
      </dl>
      <p className="metric-note">
        {metrics.from && metrics.to
          ? `${date(metrics.from)} → ${date(metrics.to)} UTC. `
          : "Faltan al menos dos registros ranked comparables. "}
        Hasta {LP_WINDOW} registros consecutivos. LP por victoria/derrota usa solo intervalos con
        una partida; neto/partida incluye intervalos con varias. Los guiones indican muestra
        insuficiente.
      </p>
      <details className="metric-method">
        <summary>Cómo se estima</summary>
        <p>
          Se comparan rango, división, LP y contadores V/D entre sincronizaciones. No es el LP
          exacto de una partida identificada: puede incluir ajustes ocurridos entre consultas. Los
          reinicios de contadores y pasos por Unranked cortan la serie. Los cambios sin partidas (
          {signedLp(metrics.adjustments)} LP) cuentan en el balance, pero se excluyen del promedio
          por partida. Las muestras de victoria/derrota también excluyen cambios con signo
          incompatible.
        </p>
      </details>
    </section>
  );
}
