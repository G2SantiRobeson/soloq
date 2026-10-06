import { afterEach, describe, expect, it, vi } from "vitest";
import {
  countdown,
  nextExpectedSyncAt,
  newerSuccessfulSync,
  LADDER_SYNC_INTERVAL_MS,
  type SyncStatus,
} from "@/lib/sync-status";
import { watchSync } from "@/lib/sync-polling";
const last = "2026-10-06T18:00:00Z";
const status: SyncStatus = {
  lastSuccessfulSyncAt: last,
  nextExpectedSyncAt: nextExpectedSyncAt(last),
  updatedAt: last,
  status: "success",
  schedulerConfigured: false,
  serverNow: last,
};
afterEach(() => vi.useRealTimers());
describe("global sync countdown", () => {
  it("uses precisely ten minutes from the recorded success", () => {
    expect(LADDER_SYNC_INTERVAL_MS).toBe(600_000);
    expect(status.nextExpectedSyncAt).toBe("2026-10-06T18:10:00.000Z");
    expect(countdown(status, Date.parse(last))).toBe("Actualización en 10:00");
    expect(countdown(status, Date.parse(last) + 1000)).toBe("Actualización en 09:59");
    expect(countdown(status, Date.parse(last) + 599_000)).toBe("Actualización en 00:01");
    expect(countdown(status, Date.parse(last) + 600_000)).toBe("Actualizando…");
    expect(countdown(status, Date.parse(last) + 900_000)).toBe("Actualizando…");
  });
  it("never claims an unrecorded success or resets on partial/failure", () => {
    expect(nextExpectedSyncAt(null)).toBeNull();
    expect(
      countdown({ ...status, nextExpectedSyncAt: null, status: "never" }, Date.parse(last)),
    ).toBe("Sin sincronización registrada");
    expect(countdown({ ...status, status: "running" }, Date.parse(last))).toBe("Actualizando…");
    for (const state of ["failed", "partial"] as const)
      expect(countdown({ ...status, status: state }, Date.parse(last) + 600_000)).toBe(
        "Actualización retrasada",
      );
    expect(newerSuccessfulSync(last, last)).toBe(false);
    expect(newerSuccessfulSync(last, null)).toBe(false);
    expect(newerSuccessfulSync(null, last)).toBe(true);
    const next = {
      ...status,
      lastSuccessfulSyncAt: "2026-10-06T18:11:00Z",
      nextExpectedSyncAt: nextExpectedSyncAt("2026-10-06T18:11:00Z"),
    };
    expect(countdown(next, Date.parse(next.lastSuccessfulSyncAt))).toBe("Actualización en 10:00");
  });
  it("polls metadata every 15s, refreshes only once on a newer success and recovers from a failure", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(status)
      .mockResolvedValue({ ...status, lastSuccessfulSyncAt: "2026-10-06T18:11:00Z" });
    const refresh = vi.fn();
    const stop = watchSync({ baseline: last, request, onStatus: vi.fn(), onRefresh: refresh });
    await vi.advanceTimersByTimeAsync(0);
    for (let n = 0; n < 14; n++) await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(request).toHaveBeenCalledTimes(3);
    stop();
  });
  it("does not overlap requests and aborts on unmount", async () => {
    vi.useFakeTimers();
    let resolve!: (value: SyncStatus) => void;
    const request = vi.fn((signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      return new Promise<SyncStatus>((r) => {
        resolve = r;
      });
    });
    const onStatus = vi.fn();
    const stop = watchSync({ baseline: last, request, onStatus, onRefresh: vi.fn() });
    await vi.advanceTimersByTimeAsync(60000);
    expect(request).toHaveBeenCalledTimes(1);
    stop();
    resolve(status);
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatus).not.toHaveBeenCalled();
  });
  it("skips polling while the tab is hidden", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValue(status);
    const stop = watchSync({
      baseline: last,
      request,
      onStatus: vi.fn(),
      onRefresh: vi.fn(),
      visible: () => false,
    });
    await vi.advanceTimersByTimeAsync(45000);
    expect(request).not.toHaveBeenCalled();
    stop();
  });
});
