import { afterEach, describe, expect, it, vi } from "vitest";
import { watchWeekChange } from "@/lib/weekly-refresh";

afterEach(() => vi.useRealTimers());
describe("open-page weekly rollover", () => {
  it("checks locally, refreshes at rollover, and retries at most once a minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T02:59:59Z"));
    const onChange = vi.fn();
    const watcher = watchWeekChange({ weekStartedAt: "2026-10-05T03:00:00.000Z", onChange });
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    watcher.check();
    expect(onChange).toHaveBeenCalledWith("2026-10-12T03:00:00.000Z");
    watcher.check();
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    watcher.check();
    expect(onChange).toHaveBeenCalledTimes(2);
    watcher.stop();
    vi.advanceTimersByTime(120_000);
    watcher.check();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
  it("pauses while hidden and checks immediately on return without refreshing an up-to-date week", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T03:00:00Z"));
    let visible = false;
    const onChange = vi.fn();
    const watcher = watchWeekChange({
      weekStartedAt: "2026-10-05T03:00:00.000Z",
      onChange,
      visible: () => visible,
    });
    vi.advanceTimersByTime(120_000);
    expect(onChange).not.toHaveBeenCalled();
    visible = true;
    watcher.check();
    expect(onChange).toHaveBeenCalledTimes(1);
    watcher.stop();
    const fresh = watchWeekChange({ weekStartedAt: "2026-10-12T03:00:00.000Z", onChange });
    vi.advanceTimersByTime(120_000);
    expect(onChange).toHaveBeenCalledTimes(1);
    fresh.stop();
  });
});
