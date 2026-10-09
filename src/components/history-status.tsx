import { CURRENT_SEASON, HISTORY_LABELS, type HistoryStatus } from "@/lib/season";
export function HistoryStatusLabel({
  history,
  demo = false,
}: {
  history?: HistoryStatus;
  demo?: boolean;
}) {
  const status = history?.status ?? "not_started";
  if (demo)
    return (
      <div className={`history-status history-${status}`}>
        <strong>{CURRENT_SEASON.label} · Historial ficticio de demo</strong>
        <span>
          La cobertura y los estados de importación son simulados; no se consulta el historial de
          Riot.
        </span>
      </div>
    );
  return (
    <div className={`history-status history-${status}`}>
      <strong>
        {CURRENT_SEASON.label} · {HISTORY_LABELS[status]}
      </strong>
      <span>
        {history ? `${history.processed} / ${history.discovered} partidas procesadas. ` : ""}
        {status === "completed"
          ? "Cobertura disponible en Riot; no garantiza recuperar partidas que la API ya no conserve."
          : "Estadísticas parciales mientras se importa el historial; se completará en las próximas actualizaciones."}
        {!!history?.unavailable &&
          ` ${history.unavailable} partidas sin detalle disponible en Riot.`}
      </span>
    </div>
  );
}
