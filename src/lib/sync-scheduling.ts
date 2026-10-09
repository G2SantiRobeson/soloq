// Application work limits, not Riot quotas. One serial client retains pacing across slots.
export const SYNC_RUN_MS = 230_000;
export const RECENT_PASS_MS = 180_000;
export const RECENT_PLAYER_MS = 30_000;
export const RECENT_PLAYER_REQUESTS = 12;
export const HISTORY_PLAYER_MS = 20_000;
export const HISTORY_PLAYER_REQUESTS = 6;

export const PENDING_LABELS = {
  time_budget: "Pendiente por presupuesto de tiempo del jugador",
  request_budget: "Pendiente por presupuesto de solicitudes del jugador",
  batch_limit: "Lote parcial guardado; puede continuar",
  execution_budget: "Sin turno por presupuesto de la ejecución",
  recent_error: "Histórico pendiente por error en rango o recientes",
  riot_backoff: "Sin turno por espera o error de autorización de Riot",
  window_not_ready: "La ventana de importación todavía no está disponible",
} as const;
export type PendingReason = keyof typeof PENDING_LABELS;
export type SyncPlayerResult = {
  playerId: string;
  status: "complete" | "partial" | "error" | "skipped";
  imported?: number;
  attempted?: boolean;
  reason?: PendingReason;
};
