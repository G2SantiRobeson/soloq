import type { SignatureMetric } from "@/lib/signature";

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
  communityBaseline,
}: {
  name: string;
  tier: string | null;
  featured: SignatureMetric[];
  others: SignatureMetric[];
  communityBaseline: boolean;
}) {
  return (
    <section
      className={`signature rank-${tier?.toLowerCase() ?? "unranked"}`}
      aria-labelledby="signature-heading"
    >
      <div className="section-heading">
        <h2 id="signature-heading">Firma de {name}</h2>
        <span>
          {communityBaseline ? "VS. PROMEDIO DE LA COMUNIDAD" : "VS. VALORES DE REFERENCIA"}
        </span>
      </div>
      {featured.length ? (
        <>
          <p className="signature-lead">
            Las métricas que más separan a {name} del promedio, calculadas con sus partidas.
          </p>
          <div className="signature-cards">
            {featured.map((metric) => (
              <article className="signature-card" key={metric.id}>
                <p className="signature-label">{metric.label}</p>
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
