import { progressDtoSchema, type ProgressDto, type ProgressSelector } from "./sync-progress";
import { SYNC_LEASE_MS } from "./sync-status";
export class ProgressReadError extends Error {
  constructor(
    public status: number,
    public retryAfterMs = 0,
  ) {
    super("No se pudo observar la ejecución.");
  }
}
export async function readAdminProgress(
  selector: ProgressSelector,
  signal: AbortSignal,
): Promise<ProgressDto> {
  const query = new URLSearchParams(selector).toString();
  const response = await fetch(`/api/admin/sync/progress${query ? `?${query}` : ""}`, {
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (!response.ok) {
    const raw = response.headers.get("Retry-After");
    const seconds = raw === null ? 0 : Number(raw);
    const wait = Number.isFinite(seconds)
      ? seconds * 1000
      : Math.max(0, Date.parse(raw!) - Date.now());
    throw new ProgressReadError(response.status, wait);
  }
  return progressDtoSchema.parse(await response.json());
}
export function watchAdminProgress(options: {
  selector?: ProgressSelector;
  startedAt?: number;
  request?: typeof readAdminProgress;
  onStatus: (dto: ProgressDto) => void;
  onProblem: (message: string) => void;
  onFinished?: (dto: ProgressDto) => void;
  visible?: () => boolean;
  subscribe?: (changed: () => void) => () => void;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const visible = options.visible ?? (() => document.visibilityState !== "hidden");
  let selector = { ...options.selector };
  let disposed = false,
    busy = false,
    wakePending = false,
    finished = false;
  let failures = 0,
    revision = -1,
    observedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  const started = options.startedAt ?? now();
  function schedule(delay: number) {
    clearTimeout(timer);
    if (!disposed && visible()) timer = setTimeout(() => void poll(), delay);
  }
  async function poll() {
    if (disposed || !visible()) return;
    if (busy) {
      wakePending = true;
      return;
    }
    busy = true;
    const request = new AbortController();
    controller = request;
    let next: number | null = null;
    try {
      const dto = await (options.request ?? readAdminProgress)(selector, request.signal);
      if (disposed || request.signal.aborted || !visible()) return;
      const run = dto.run;
      if (
        run &&
        ((selector.runId && run.runId !== selector.runId) ||
          (selector.requestId && run.requestId !== selector.requestId))
      )
        throw new Error("Uncorrelated response");
      if (Date.parse(dto.serverNow) < observedAt || (run && run.revision < revision)) {
        next = 15_000;
        return;
      }
      observedAt = Date.parse(dto.serverNow);
      if (run) {
        selector = { runId: run.runId };
        revision = run.revision;
      }
      failures = 0;
      options.onStatus(dto);
      if (run?.state === "running") next = 15_000;
      else if (run) {
        if (!finished) {
          finished = true;
          options.onFinished?.(dto);
        }
        if (dto.control.until && dto.control.state !== "available")
          next = Math.max(1000, Date.parse(dto.control.until) - Date.parse(dto.serverNow) + 100);
      } else if (selector.requestId || selector.runId) {
        if (now() - started < SYNC_LEASE_MS) next = 15_000;
        else
          options.onProblem(
            "Sin ejecución correlacionada disponible. El resultado sigue siendo desconocido; consulta de nuevo antes de reintentar.",
          );
      } else if (dto.control.until)
        next = Math.max(1000, Date.parse(dto.control.until) - Date.parse(dto.serverNow) + 100);
    } catch (error) {
      if (disposed || request.signal.aborted) return;
      const denied = error instanceof ProgressReadError && [401, 503].includes(error.status);
      options.onProblem(
        error instanceof ProgressReadError && error.status === 401
          ? "La sesión expiró. Inicia sesión para consultar el progreso."
          : "No se pudo obtener el progreso. Se conserva el último checkpoint; esto no confirma que la ejecución haya fallado.",
      );
      if (!denied)
        next = Math.max(
          Math.min(60_000, 15_000 * 2 ** failures++),
          error instanceof ProgressReadError ? error.retryAfterMs : 0,
        );
    } finally {
      busy = false;
      controller = null;
      if (wakePending) {
        wakePending = false;
        if (!disposed && visible()) void poll();
      } else if (next !== null) schedule(next);
    }
  }
  function refresh() {
    clearTimeout(timer);
    void poll();
  }
  function visibilityChanged() {
    clearTimeout(timer);
    if (!visible()) controller?.abort();
    else refresh();
  }
  const unsubscribe = options.subscribe
    ? options.subscribe(visibilityChanged)
    : (() => {
        document.addEventListener("visibilitychange", visibilityChanged);
        return () => document.removeEventListener("visibilitychange", visibilityChanged);
      })();
  void poll();
  return {
    refresh,
    stop() {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      unsubscribe();
    },
  };
}
