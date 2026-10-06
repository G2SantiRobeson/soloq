import { CURRENT_SEASON, HISTORY_LABELS, type HistoryStatus } from "@/lib/season";
export function HistoryStatusLabel({ history }: { history?: HistoryStatus }) {
  const status = history?.status ?? "not_started";
  return (
    <div className={`history-status history-${status}`}>
      <strong>
        {CURRENT_SEASON.label} · {HISTORY_LABELS[status]}
      </strong>
      <span>
        {history
          ? `${history.processed} / ${history.discovered} IDs descubiertos procesados. `
          : ""}
        {status === "completed"
          ? "Cobertura disponible en Riot; no garantiza recuperar partidas que la API ya no conserve."
          : "Estadísticas parciales mientras se importa el historial; continúa desde Administración o mediante el cron."}
        {!!history?.unavailable &&
          ` ${history.unavailable} partidas sin detalle disponible en Riot.`}
      </span>
    </div>
  );
}
