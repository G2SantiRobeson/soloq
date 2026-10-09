import type { IndividualSyncResult } from "./admin-sync";
import { AdminRequestError, describeAdminError, type AdminAction } from "./admin-errors";
import type { SyncPlayerResult } from "./sync-scheduling";

export type AdminResponse = {
  message?: string;
  results?: SyncPlayerResult[];
  backfill?: { results: SyncPlayerResult[]; pending: number; errors: number };
  outcome?: "success" | "partial" | "failed";
  result?: IndividualSyncResult;
};
export type AdminNotice = {
  kind: "success" | "partial" | "error" | "cooldown" | "uncertain";
  title: string;
  message: string;
};

export async function requestAdmin(
  path: string,
  method: string,
  data?: unknown,
): Promise<AdminResponse> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new AdminRequestError(0, null);
  }
  let result: (AdminResponse & { error?: string }) | null;
  try {
    result = await response.json();
  } catch {
    if (response.ok) throw new AdminRequestError(0, null);
    result = null;
  }
  if (!response.ok) throw new AdminRequestError(response.status, result?.error ?? null);
  if (!result) throw new AdminRequestError(0, null);
  return result;
}

// A synchronous gate: a second activation before React renders cannot dispatch another request.
export function createAdminActionRunner() {
  let busy = false;
  return async function run<T>(
    start: () => void,
    work: () => Promise<T>,
    finish: () => void,
  ): Promise<T | undefined> {
    if (busy) return undefined;
    busy = true;
    try {
      start();
      return await work();
    } finally {
      busy = false;
      finish();
    }
  };
}

export function resultNotice(result: AdminResponse, fallback: string): AdminNotice {
  const historyErrors = (result.backfill?.errors ?? 0) > 0;
  const failed = result.outcome === "failed" || result.result?.status === "error" || historyErrors;
  const partial =
    result.outcome === "partial" ||
    result.result?.status === "partial" ||
    result.result?.status === "skipped" ||
    (result.backfill?.pending ?? 0) > 0;
  const summary = result.results
    ? `${result.results.filter((r) => r.status === "complete").length} completos, ${result.results.filter((r) => r.status === "partial").length} parciales, ${result.results.filter((r) => r.status === "error").length} con error.`
    : fallback;
  return {
    kind: failed ? "error" : partial ? "partial" : "success",
    title:
      historyErrors && result.outcome === "success"
        ? "Recientes completados · histórico con errores"
        : failed
          ? "Finalizada con errores"
          : partial
            ? "Finalizada con pendientes"
            : "Acción completada",
    message: result.message ?? summary,
  };
}
export function failureNotice(error: unknown, action: AdminAction): AdminNotice {
  const uncertain = error instanceof AdminRequestError && error.status === 0;
  const cooldown =
    error instanceof AdminRequestError &&
    (error.status === 429 ||
      (error.status === 409 &&
        /sincroniz|curso|espera|cooldown/i.test(error.serverMessage ?? "")) ||
      (error.status === 503 && /limitado|espera/i.test(error.serverMessage ?? "")));
  return {
    kind: uncertain ? "uncertain" : cooldown ? "cooldown" : "error",
    title: uncertain
      ? "Resultado sin confirmar"
      : cooldown
        ? "En espera · no reintentar todavía"
        : "No se pudo completar",
    message: describeAdminError(error, action).message,
  };
}
export function actionTitle(key: string, action: AdminAction, playerName?: string) {
  if (key === "sync") return "Actualizando todos · rango y recientes, después histórico";
  if (action === "sync") return `Actualizando rango y recientes · ${playerName ?? "jugador"}`;
  if (action === "backfill") return `Continuando historial · ${playerName ?? "jugador"}`;
  return {
    login: "Verificando acceso",
    add: "Añadiendo jugador y consultando Riot",
    toggle: "Guardando seguimiento",
    delete: "Eliminando jugador",
    logout: "Cerrando sesión",
  }[action];
}
export function elapsedLabel(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
export function watchAdminClock(tick: (now: number) => void) {
  const timer = setInterval(() => tick(Date.now()), 1000);
  return () => clearInterval(timer);
}
export function waitingMessage(seconds: number) {
  if (seconds >= 180)
    return "La espera es prolongada. Si se pierde la respuesta, revisa los diagnósticos antes de reintentar; la operación puede continuar en el servidor.";
  if (seconds >= 60)
    return "La sincronización puede tardar varios minutos. El servidor conserva el progreso importado; todavía no ha confirmado el resultado.";
  return "Esperando la respuesta del servidor. No cierres esta página ni inicies otra acción. No hay un porcentaje o tiempo restante verificable.";
}
