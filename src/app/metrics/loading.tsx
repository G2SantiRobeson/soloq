const BLOCKS: [className: string, height: number][] = [
  ["span-hero", 132],
  ["span-hero", 132],
  ["span-hero", 132],
  ["span-hero", 132],
  ["span-community", 96],
  ["span-community", 96],
  ["span-community community-last", 96],
  ["span-half", 320],
  ["span-half", 320],
  ["span-form", 220],
  ["span-trend", 220],
];

export default function MetricsLoading() {
  return (
    <div className="metrics-page" role="status">
      <span className="sr-only">Cargando las métricas de la comunidad…</span>
      <div className="skeleton skeleton-line" aria-hidden="true" />
      <div className="bento" aria-hidden="true">
        {BLOCKS.map(([className, height], i) => (
          <div key={i} className={`skeleton ${className}`} style={{ height }} />
        ))}
      </div>
    </div>
  );
}
