/** Mirrors the page: masthead, controls, tier distribution, the leaders scoreboard and one pair. */
const SCOREBOARD: [className: string, height: number][] = [
  ["span-hero", 132],
  ["span-hero", 132],
  ["span-hero", 132],
  ["span-hero", 132],
  ["span-community", 96],
  ["span-community", 96],
  ["span-community community-last", 96],
];

export default function MetricsLoading() {
  return (
    <div className="metrics-page" role="status">
      <span className="sr-only">Cargando las métricas de la comunidad…</span>
      <div className="skeleton skeleton-title" aria-hidden="true" />
      <div className="skeleton skeleton-tabs" aria-hidden="true" />
      <div className="skeleton" style={{ height: 40 }} aria-hidden="true" />
      <div className="metrics-scoreboard" aria-hidden="true">
        {SCOREBOARD.map(([className, height], i) => (
          <div key={i} className={`skeleton ${className}`} style={{ height }} />
        ))}
      </div>
      <div className="metrics-pair" aria-hidden="true">
        <div className="skeleton" style={{ height: 320 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    </div>
  );
}
