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
    ? "Pendiente de actualización"
    : elapsed < 3600_000
      ? `hace ${Math.max(1, Math.floor(elapsed / 60000))} min`
      : elapsed < 86400_000
        ? `hace ${Math.floor(elapsed / 3600_000)} h`
        : `hace ${Math.floor(elapsed / 86400_000)} días`;
  return (
    <span className={`freshness ${stale ? "stale" : ""}`}>
      <span className="status-dot" aria-hidden="true" />
      {!compact && "Actualizado "}
      {timestamp ? <time dateTime={timestamp}>{text}</time> : text}
      {stale && timestamp && " · desactualizado"}
      {!compact && timestamp && (
        <span className="freshness-exact">
          {" · "}
          {new Date(timestamp).toLocaleString("es-CL", {
            timeZone: "UTC",
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}{" "}
          UTC
        </span>
      )}
    </span>
  );
}
