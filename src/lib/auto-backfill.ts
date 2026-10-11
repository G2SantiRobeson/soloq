import type { ProgressDto } from "./sync-progress";
import { AdminRequestError } from "./admin-errors";

export type AutoBackfillState = {
  playerId: string;
  season: string;
  active: boolean;
  status: "processing" | "preparing" | "waiting" | "paused" | "completed" | "error" | "uncertain";
  message: string;
  batches: number;
  retryAt: string | null;
  requestId: string | null;
  progress: ProgressDto | null;
};

/** Browser orchestration only: one POST, then a matching durable result, then the next batch. */
export function createAutoBackfill(options: {
  begin: () => string;
  send: (playerId: string, season: string, requestId: string) => Promise<unknown>;
  refresh: () => void;
  onState: (state: AutoBackfillState) => void;
  visible?: () => boolean;
  subscribe?: (changed: () => void) => () => void;
  now?: () => number;
  random?: () => number;
}) {
  const now = options.now ?? Date.now;
  const visible = options.visible ?? (() => document.visibilityState !== "hidden");
  let state: AutoBackfillState | null = null;
  let busy = false,
    disposed = false,
    settled = false;
  let retries = 0,
    stalled = 0,
    previousProcessed: number | null = null;
  let startedAt = 0;
  let countedRun: string | null = null;
  let requestStartedAt = 0;
  let continuationAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let limit: ReturnType<typeof setTimeout> | undefined;
  const publish = () => {
    if (state && !disposed) options.onState({ ...state });
  };
  function stop(
    message = "Detenido por el usuario. El lote en curso puede terminar; su checkpoint se conserva.",
    status: AutoBackfillState["status"] = "paused",
  ) {
    clearTimeout(timer);
    clearTimeout(limit);
    if (state) {
      state.active = false;
      state.status = status;
      state.message = message;
      publish();
    }
  }
  function schedule(delay: number) {
    clearTimeout(timer);
    if (state?.active && visible() && !disposed) timer = setTimeout(() => void dispatch(), delay);
  }
  async function dispatch() {
    if (!state?.active || disposed || busy || !visible()) return;
    if (state.batches >= 100 || now() - startedAt >= 3600_000) {
      stop(
        "Límite de sesión alcanzado (100 lotes o una hora). Revisa el progreso antes de continuar.",
      );
      return;
    }
    busy = true;
    settled = false;
    state.batches++;
    state.retryAt = null;
    state.requestId = options.begin();
    requestStartedAt = now();
    state.status = "processing";
    state.message = "Procesando un lote histórico; solo los checkpoints confirman avance.";
    publish();
    try {
      await options.send(state.playerId, state.season, state.requestId);
    } catch (error) {
      if (disposed || !state.active) return;
      if (
        error instanceof AdminRequestError &&
        error.status === 503 &&
        !error.runId &&
        /demo/i.test(error.serverMessage ?? "")
      ) {
        stop("La continuación está deshabilitada en modo Demo.", "error");
        return;
      }
      if (
        error instanceof AdminRequestError &&
        [400, 401, 403, 404, 409, 413, 415, 422].includes(error.status) &&
        !error.runId
      ) {
        stop(
          error.status === 409
            ? "Lease ocupado o jugador pausado. Revisa el estado y vuelve a activar la continuación."
            : "Solicitud rechazada. Revisa sesión, jugador y temporada.",
          "error",
        );
        return;
      }
      state.status = "uncertain";
      state.message =
        "Respuesta no confirmada. Solo se continuará si el GET acredita el resultado de esta ejecución.";
      publish();
    } finally {
      busy = false;
      settled = true;
      if (!disposed && state?.active) {
        options.refresh();
        consider();
      }
    }
  }
  function consider() {
    if (!state?.active || !settled || busy || disposed) return;
    const dto = state.progress;
    const run = dto?.run;
    if (!dto || !run || run.requestId !== state.requestId || run.state === "running") return;
    if (["interrupted", "possibly_interrupted"].includes(run.state)) {
      stop(
        "Ejecución posiblemente interrumpida. Revisa los checkpoints antes de continuar.",
        "uncertain",
      );
      return;
    }
    const work = run.players.find((p) => p.playerId === state!.playerId)?.history;
    if (!work) {
      stop("Sin resultado histórico verificable para esta ejecución.", "uncertain");
      return;
    }
    if (work.status === "complete") {
      stop(
        "Historial disponible importado según el cursor. No garantiza exhaustividad de Riot.",
        "completed",
      );
      return;
    }
    if (work.status === "skipped") {
      stop("Jugador no elegible; continuación detenida.");
      return;
    }
    const code = work.error?.code;
    const deadlinePartial = work.status === "partial" && code === "deadline";
    const newResult = countedRun !== run.runId;
    if ((work.status === "error" || work.error) && !deadlinePartial) {
      if (code === 401 || code === 403) {
        stop("La clave de Riot no es válida o ha expirado. Continuación detenida.", "error");
        return;
      }
      if (code === 429) {
        const until =
          run.riotRetryAt ??
          state.retryAt ??
          (dto.control.reason === "riot_retry_after" ? dto.control.until : null);
        if (
          !until ||
          !Number.isFinite(Date.parse(until)) ||
          (dto.control.state === "available" && Date.parse(dto.serverNow) < Date.parse(until))
        ) {
          stop(
            "Riot limitó solicitudes; no hay un plazo de espera verificable. Revisa el estado.",
            "uncertain",
          );
          return;
        }
      } else if (typeof code !== "number" || code < 500 || (newResult && retries >= 3)) {
        stop("Error histórico persistente. Revisa el diagnóstico antes de reintentar.", "error");
        return;
      } else if (newResult) retries++;
    } else if (
      !deadlinePartial &&
      (work.status !== "partial" ||
        !work.reason ||
        !["batch_limit", "time_budget", "request_budget", "execution_budget"].includes(work.reason))
    ) {
      stop(
        "Trabajo parcial sin continuación automática segura. Revisa el diagnóstico.",
        "uncertain",
      );
      return;
    }
    const processed = work.history?.processed;
    if (newResult && (!work.error || deadlinePartial) && processed != null) {
      stalled = processed === previousProcessed ? stalled + 1 : 0;
      previousProcessed = processed;
      if (stalled >= 3) {
        stop("Tres lotes sin avance confirmado. Revisa el diagnóstico.", "uncertain");
        return;
      }
      retries = 0;
    }
    countedRun = run.runId;
    if (newResult) {
      continuationAt =
        now() +
        Math.max(
          5000,
          retries
            ? 15_000 * 2 ** (retries - 1) + Math.floor((options.random ?? Math.random)() * 1000)
            : 0,
        );
    }
    const wait =
      dto.control.state === "available"
        ? 0
        : dto.control.until
          ? Math.max(0, Date.parse(dto.control.until) - Date.parse(dto.serverNow))
          : NaN;
    if (!Number.isFinite(wait)) {
      stop("Lease ocupado sin plazo verificable.", "uncertain");
      return;
    }
    state.retryAt = wait > 0 ? dto.control.until : null;
    state.status = wait > 0 ? "waiting" : "preparing";
    state.message =
      wait > 0
        ? "Esperando el cooldown compartido; el avance permanece confirmado."
        : "Preparando continuación";
    publish();
    schedule(Math.max(0, continuationAt - now(), wait > 0 ? wait + 250 : 0));
  }
  function visibilityChanged() {
    clearTimeout(timer);
    if (visible() && state?.active) {
      if (!state.requestId) void dispatch();
      else options.refresh();
    }
  }
  const unsubscribe = options.subscribe
    ? options.subscribe(visibilityChanged)
    : (() => {
        document.addEventListener("visibilitychange", visibilityChanged);
        return () => document.removeEventListener("visibilitychange", visibilityChanged);
      })();
  return {
    start(playerId: string, season: string) {
      if (disposed || busy || state?.active) return false;
      retries = stalled = 0;
      countedRun = null;
      previousProcessed = null;
      startedAt = now();
      state = {
        playerId,
        season,
        active: true,
        status: "preparing",
        message: "Preparando continuación",
        batches: 0,
        retryAt: null,
        requestId: null,
        progress: null,
      };
      limit = setTimeout(
        () => stop("Límite de una hora alcanzado. El checkpoint se conserva."),
        3600_000,
      );
      publish();
      void dispatch();
      return true;
    },
    observe(dto: ProgressDto) {
      const run = dto.run;
      if (!run && state?.active && state.requestId && now() - requestStartedAt >= 330_000) {
        stop(
          "No hay resultado correlacionado disponible. Revisa el estado antes de reintentar.",
          "uncertain",
        );
        return;
      }
      if (
        !state ||
        !run ||
        run.requestId !== state.requestId ||
        run.playerId !== state.playerId ||
        run.action !== "player_history" ||
        run.season !== state.season
      )
        return;
      if (
        state.progress &&
        (Date.parse(dto.serverNow) < Date.parse(state.progress.serverNow) ||
          (run.runId === state.progress.run?.runId && run.revision < state.progress.run.revision))
      )
        return;
      state.progress = dto;
      publish();
      consider();
    },
    stop,
    isActive: () => !!state?.active,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(limit);
      unsubscribe();
    },
  };
}
