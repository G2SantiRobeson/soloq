import type { SignatureMetric } from "@/lib/signature";
import { QUEUE_LABELS, type View } from "@/lib/queues";
import { InfoTip } from "./info-tip";

function Reference({ metric, demo }: { metric: SignatureMetric; demo: boolean }) {
  return (
    <p className="signature-reference">
      Referencia:{" "}
      {metric.referenceSource === "community"
        ? demo
          ? "comunidad simulada"
          : "comunidad"
        : "valores del sistema"}
    </p>
  );
}

function Value({ metric }: { metric: SignatureMetric }) {
  return (
    <>
      {metric.num}
      {metric.unit && <small>{metric.unit}</small>}
    </>
  );
}

export function PlayerSignature({
  name,
  tier,
  featured,
  others,
  view,
  demo = false,
}: {
  name: string;
  tier: string | null;
  featured: SignatureMetric[];
  others: SignatureMetric[];
  view: View;
  demo?: boolean;
}) {
  const sources = new Set([...featured, ...others].map((metric) => metric.referenceSource));
  const referenceLabel =
    sources.size > 1
      ? "REFERENCIAS MIXTAS"
      : sources.has("community")
        ? demo
          ? "COMUNIDAD SIMULADA"
          : "REFERENCIA COMUNITARIA"
        : sources.has("default")
          ? "VALORES DEL SISTEMA"
          : "REFERENCIAS ESTADÍSTICAS";
  return (
    <section
      className={`signature rank-${tier?.toLowerCase() ?? "unranked"}`}
      aria-labelledby="signature-heading"
    >
      <div className="section-heading">
        <h2 id="signature-heading">Firma de {name}</h2>
        <span>
          {QUEUE_LABELS[view]} · {referenceLabel}
        </span>
      </div>
      {featured.length ? (
        <>
          <p className="signature-lead">
            Lecturas de {name} que más se apartan de la referencia indicada en cada métrica. Son
            interpretaciones estadísticas, no logros desbloqueados ni un diagnóstico definitivo.
          </p>
          <InfoTip label="Fuentes y muestras de la Firma competitiva" align="start">
            {demo ? "Datos ficticios de demo. " : ""}
            Las referencias comunitarias corresponden a esta modalidad y pueden usar historiales
            parciales. Los valores del sistema son referencias predeterminadas, no promedios
            empíricos de SoloQ. Se combinan el registro{" "}
            {view === "5v5" ? "importado" : demo ? "ranked simulado" : "ranked oficial"}, el pool de
            temporada, el winrate móvil y hasta 40 partidas recientes importadas sin remakes; las
            muestras no forman una única ventana. Las métricas sin datos suficientes se omiten.
          </InfoTip>
          <div className="signature-cards">
            {featured.map((metric) => (
              <article className="signature-card" key={metric.id}>
                <p className="signature-label">{metric.label}</p>
                <Reference metric={metric} demo={demo} />
                <p className="signature-num">
                  <Value metric={metric} />
                </p>
                <h3>{metric.title}</h3>
                <p className="signature-text">{metric.text}</p>
              </article>
            ))}
          </div>
          {others.length > 0 && (
            <>
              <h3 className="signature-subhead">Otras lecturas</h3>
              <ul className="signature-others">
                {others.map((metric) => (
                  <li key={metric.id}>
                    <p className="signature-label">{metric.label}</p>
                    <Reference metric={metric} demo={demo} />
                    <p className="signature-mini">
                      <Value metric={metric} />
                    </p>
                    <p className="signature-text">
                      <strong>{metric.title}.</strong> {metric.text}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="signature-text">
          Todavía no hay partidas suficientes en esta cola para calcular la firma.
        </p>
      )}
    </section>
  );
}
