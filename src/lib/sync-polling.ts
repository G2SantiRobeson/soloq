import { newerSuccessfulSync, SYNC_POLL_INTERVAL_MS, type SyncStatus } from "./sync-status";

export function watchSync(options: {
  baseline: string | null;
  request: (signal: AbortSignal) => Promise<SyncStatus>;
  onStatus: (status: SyncStatus) => void;
  onRefresh: () => void;
  visible?: () => boolean;
}) {
  const controller = new AbortController();
  let busy = false,
    confirmed = false;
  const poll = async () => {
    if (busy || confirmed || controller.signal.aborted || options.visible?.() === false) return;
    busy = true;
    try {
      const status = await options.request(controller.signal);
      if (controller.signal.aborted) return;
      options.onStatus(status);
      if (newerSuccessfulSync(options.baseline, status.lastSuccessfulSyncAt)) {
        confirmed = true;
        options.onRefresh();
      }
    } catch {
      /* Keep the last confirmed timestamp; retry at the next polling interval. */
    } finally {
      busy = false;
    }
  };
  void poll();
  const timer = setInterval(() => void poll(), SYNC_POLL_INTERVAL_MS);
  return () => {
    controller.abort();
    clearInterval(timer);
  };
}
