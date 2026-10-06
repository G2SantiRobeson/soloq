export const LADDER_SYNC_INTERVAL_MS = 10 * 60 * 1000;
export const SYNC_POLL_INTERVAL_MS = 15_000;
export const SYNC_LEASE_MS = 285_000;
export type SyncStatus = {
  lastSuccessfulSyncAt: string | null;
  nextExpectedSyncAt: string | null;
  updatedAt: string | null;
  status: "never" | "running" | "success" | "partial" | "failed";
  schedulerConfigured: boolean;
  serverNow: string;
};
export function nextExpectedSyncAt(last: string | null): string | null {
  return last ? new Date(Date.parse(last) + LADDER_SYNC_INTERVAL_MS).toISOString() : null;
}
export function countdown(status: SyncStatus, now: number) {
  if (status.status === "running") return "Actualizando…";
  if (!status.nextExpectedSyncAt) return "Sin sincronización registrada";
  const seconds = Math.max(0, Math.ceil((Date.parse(status.nextExpectedSyncAt) - now) / 1000));
  if (!seconds)
    return status.status === "failed" || status.status === "partial"
      ? "Actualización retrasada"
      : "Actualizando…";
  return `Actualización en ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function newerSuccessfulSync(before: string | null, after: string | null) {
  return !!after && (!before || Date.parse(after) > Date.parse(before));
}
