export default function Loading() {
  return (
    <div className="loading-state" role="status" aria-label="Cargando estadísticas">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-subtitle" />
      {[1, 2, 3, 4, 5].map((i) => (
        <div className="skeleton skeleton-row" key={i} />
      ))}
      <span className="sr-only">Cargando estadísticas…</span>
    </div>
  );
}
