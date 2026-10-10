import type { Platform } from "./routing";
import type { PlayerSyncError, PlayerSyncState } from "./player-sync-state";
import type { HistoryStatus } from "./season";
import { SYNC_LEASE_MS } from "./sync-status";
import type { ProgressDto } from "./sync-progress";

export type AdminPlayer = {
  id: string;
  gameName: string;
  tagLine: string;
  platform: Platform;
  enabled: boolean;
  lastSyncedAt: string | null;
  syncError: string | null;
  backfillSeason: string | null;
  backfillStatus: HistoryStatus["status"];
  backfillDiscovered: number;
  backfillProcessed: number;
  backfillUnavailable: number;
  syncState: PlayerSyncState;
  legacyError: string | null;
  // Only recognized, safe legacy information; arbitrary persisted text is never exposed.
  legacyNotice?: string | null;
};
export type AdminSyncContext = {
  serverNow: string;
  leaseUntil: string | null;
  progress?: ProgressDto;
};
export type IndividualSyncResult = {
  playerId: string;
  status: "complete" | "partial" | "skipped" | "error";
  imported?: number;
  syncState: PlayerSyncState;
};

export const LEGACY_PARTIAL_SYNC_MESSAGE =
  "Sincronización parcial guardada; continuará en la siguiente ejecución.";

export function classifyLegacySyncMessage(
  message: string | null,
  phaseErrors: readonly (PlayerSyncError | null)[],
): "none" | "partial" | "unknown_error" {
  if (!message) return "none";
  // Exact allowlist: variants or messages with appended errors remain warnings.
  if (message === LEGACY_PARTIAL_SYNC_MESSAGE) return "partial";
  if (phaseErrors.some((error) => error?.message === message)) return "none";
  return "unknown_error";
}

// Persisted messages can come from legacy writers. Never send arbitrary text to the browser.
export function safeSyncError(error: PlayerSyncError): PlayerSyncError {
  const message =
    error.code === "deadline"
      ? "Se agotó el tiempo; el progreso guardado permite continuar."
      : error.code === 429
        ? "Riot ha limitado las solicitudes. Respeta el tiempo de espera."
        : error.code === 401 || error.code === 403
          ? "La clave de Riot no es válida o ha expirado."
          : error.code === 404
            ? "Riot no encontró la cuenta o partida en la región indicada."
            : error.code === "internal"
              ? "Error de sincronización; consulta el registro del servidor."
              : "Riot no está disponible temporalmente.";
  return { occurredAt: error.occurredAt, code: error.code, step: error.step, message };
}

export function attemptActivity(state: PlayerSyncState, context: AdminSyncContext): string {
  const attempt = state.lastAttempt;
  if (!attempt) return "Desconocido";
  if (attempt.outcome !== "running") return "Finalizado";
  const now = Date.parse(context.serverNow);
  if (now >= Date.parse(attempt.startedAt) + SYNC_LEASE_MS)
    return "Posiblemente interrumpido; sin finalización registrada";
  if (context.leaseUntil && Date.parse(context.leaseUntil) > now)
    return "Lease compartido ocupado o en cooldown; no confirma este intento activo";
  return "Inicio registrado; sin ejecución activa confirmada";
}
