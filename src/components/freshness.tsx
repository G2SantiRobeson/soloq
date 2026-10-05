export function Freshness({
  timestamp,
  observedAt,
  compact = false,
}: {
  timestamp: string | null;
  observedAt: string;
  compact?: boolean;
}) {
  const elapsed = timestamp
    ? Math.max(0, Date.parse(observedAt) - Date.parse(timestamp))
    : Infinity;
  const stale = elapsed > 36 * 3600_000;
  const text = !timestamp
    ? "Pendiente de sincronización"
    : elapsed < 3600_000
      ? `hace ${Math.max(1, Math.floor(elapsed / 60000))} min`
      : elapsed < 86400_000
        ? `hace ${Math.floor(elapsed / 3600_000)} h`
        : `hace ${Math.floor(elapsed / 86400_000)} días`;
  return (
    <span
      className={`freshness ${stale ? "stale" : ""}`}
      title={timestamp ? new Date(timestamp).toUTCString() : text}
    >
      <span className="status-dot" />
      {!compact && "Actualizado "}
      {text}
      {stale && timestamp && " · desactualizado"}
    </span>
  );
}
