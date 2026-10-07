export default function ProfileLoading() {
  return (
    <div className="loading-state" role="status">
      <span className="sr-only">Cargando el perfil del jugador…</span>
      <div className="skeleton skeleton-line" aria-hidden="true" />
      <div className="skeleton-profile-header" aria-hidden="true">
        <div className="skeleton skeleton-avatar" />
        <div className="skeleton-stack">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-title" />
        </div>
      </div>
      <div className="skeleton skeleton-tabs" aria-hidden="true" />
      <div className="skeleton-profile-grid" aria-hidden="true">
        <div className="skeleton skeleton-panel" />
        <div className="skeleton skeleton-panel" />
      </div>
    </div>
  );
}
