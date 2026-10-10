import { CURRENT_SEASON, type HistoryStatus } from "@/lib/season";

const COVERAGE = {
  completed: {
    label: "Recuperación histórica completada",
    note: "Las estadísticas reflejan las partidas recuperadas. No garantiza disponer de todas las partidas de temporada ni recuperar las que Riot ya no conserve.",
  },
  running: {
    label: "Historial parcial · puede continuar",
    note: "Las estadísticas reflejan las partidas recuperadas hasta ahora. La recuperación puede continuar en futuras sincronizaciones; este estado guardado no indica una ejecución activa.",
  },
  not_started: {
    label: "Recuperación histórica pendiente",
    note: "La recuperación histórica no se ha iniciado. Las estadísticas reflejan las partidas importadas disponibles; la recuperación puede iniciarse en futuras sincronizaciones.",
  },
  failed: {
    label: "Recuperación con error · reintentable",
    note: "La recuperación histórica encontró un error. Las estadísticas reflejan las partidas recuperadas; este estado no implica pérdida del progreso y puede reintentarse en futuras sincronizaciones.",
  },
  unknown: {
    label: "Cobertura histórica desconocida",
    note: "Las estadísticas reflejan las partidas importadas disponibles. No hay un estado registrado que permita verificar la cobertura histórica.",
  },
} as const;

export function HistoryStatusLabel({
  history,
  demo = false,
  compact = false,
}: {
  history?: HistoryStatus;
  demo?: boolean;
  compact?: boolean;
}) {
  const status = history?.status ?? "unknown";
  const className = `history-status history-${status}${compact ? " history-status-compact" : ""}`;
  if (demo)
    return (
      <div className={className} role="note" aria-label="Cobertura del historial de demostración">
        <strong>{CURRENT_SEASON.label} · Historial ficticio de demo</strong>
        <span>
          La cobertura y los estados de importación son simulados; no se consulta el historial de
          Riot.
        </span>
      </div>
    );
  return (
    <div className={className} role="note" aria-label="Cobertura del historial importado">
      <strong>
        {CURRENT_SEASON.label} · {COVERAGE[status].label}
      </strong>
      <span>
        {compact
          ? "Métricas y campeones de partidas importadas; consulta el detalle de cobertura en Rendimiento de temporada."
          : COVERAGE[status].note}
        {!compact &&
          history &&
          ` ${history.processed} IDs procesados de ${history.discovered} descubiertos; no es un porcentaje de cobertura de temporada.`}
        {!compact &&
          !!history?.unavailable &&
          ` ${history.unavailable} partidas sin detalle disponible en Riot.`}
      </span>
    </div>
  );
}
