export default function MetricsLoading() {
  return (
    <div className="loading-state" role="status">
      <span className="sr-only">Cargando las métricas de la comunidad…</span>
      <div className="skeleton skeleton-line" aria-hidden="true" />
      <div className="skeleton skeleton-title" aria-hidden="true" />
      <div className="skeleton skeleton-tabs" aria-hidden="true" />
      <div className="skeleton-highlights" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <div className="skeleton skeleton-highlight" key={i} />
        ))}
      </div>
      <div className="skeleton skeleton-panel" aria-hidden="true" />
    </div>
  );
}
