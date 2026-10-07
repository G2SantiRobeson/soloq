export default function Loading() {
  return (
    <div className="loading-state" role="status">
      <span className="sr-only">Cargando la clasificación…</span>
      <div className="skeleton skeleton-title" aria-hidden="true" />
      <div className="skeleton skeleton-tabs" aria-hidden="true" />
      {[1, 2, 3, 4, 5].map((i) => (
        <div className="skeleton skeleton-row" aria-hidden="true" key={i} />
      ))}
    </div>
  );
}
