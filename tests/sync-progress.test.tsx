import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  applyProgressEvent,
  finishRun,
  newRun,
  progressDto,
  type ProgressDto,
  type ProgressEnvelope,
} from "@/lib/sync-progress";
import {
  ProgressReadError,
  readAdminProgress,
  watchAdminProgress,
} from "@/lib/admin-progress-polling";
import { restoreAdminObservation } from "@/components/use-admin-progress";
import { AdminOperationFeedback } from "@/components/admin-operation-feedback";
import { AdminProgressQuery } from "@/components/admin-run-feedback";
import { requestAdmin, rejectedBeforeRun } from "@/lib/admin-operation";
import { AdminRequestError } from "@/lib/admin-errors";

const owner = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";
const now = new Date("2026-10-09T12:00:00Z");
function envelope(): ProgressEnvelope {
  return {
    version: 1,
    latest: newRun({ action: "global", requestId }, owner, runId, now.toISOString(), "2026"),
    previous: null,
  };
}
function dto(
  e = envelope(),
  time = now,
  expiresAt = new Date(now.getTime() + 330000),
): ProgressDto {
  return progressDto({ owner, expiresAt, runProgress: e }, time);
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("verified progress contracts", () => {
  it("distinguishes definitive rejection/demo from an acquired run or lost response", () => {
    expect(rejectedBeforeRun(new AdminRequestError(409, "lease ocupado"))).toBe(true);
    expect(rejectedBeforeRun(new AdminRequestError(503, "deshabilitado en demo"))).toBe(true);
    expect(rejectedBeforeRun(new AdminRequestError(409, "cuenta duplicada", runId))).toBe(false);
    expect(
      rejectedBeforeRun(new AdminRequestError(503, "Riot temporalmente indisponible", runId)),
    ).toBe(false);
    expect(rejectedBeforeRun(new AdminRequestError(0, null))).toBe(false);
  });
  it("keeps official rank, recent coverage and historical errors independent", () => {
    const e = envelope();
    const r = e.latest;
    applyProgressEvent(
      r,
      { type: "select", pass: "recent", ids: [id, requestId] },
      now.toISOString(),
    );
    applyProgressEvent(r, { type: "phase", phase: "rank", playerId: id }, now.toISOString());
    applyProgressEvent(
      r,
      { type: "rank", playerId: id, checkedAt: now.toISOString() },
      now.toISOString(),
    );
    applyProgressEvent(
      r,
      { type: "import", pass: "recent", playerId: id, imported: 2 },
      now.toISOString(),
    );
    applyProgressEvent(
      r,
      {
        type: "result",
        pass: "recent",
        result: { playerId: id, status: "complete" },
        coveredThrough: now.toISOString(),
      },
      now.toISOString(),
    );
    applyProgressEvent(
      r,
      {
        type: "result",
        pass: "recent",
        result: {
          playerId: requestId,
          status: "partial",
          attempted: false,
          reason: "execution_budget",
        },
      },
      now.toISOString(),
    );
    applyProgressEvent(r, { type: "phase", phase: "history", playerId: id }, now.toISOString());
    applyProgressEvent(
      r,
      {
        type: "result",
        pass: "history",
        result: { playerId: id, status: "error" },
        error: { code: 503, step: "history" },
      },
      now.toISOString(),
    );
    finishRun(r, now.toISOString(), false, "aborted");
    expect(r.status).toBe("failed");
    expect(r.recentOutcome).toBe("partial");
    expect(r.recent).toMatchObject({
      eligible: 2,
      visited: 1,
      complete: 1,
      unvisited: 1,
      imported: 2,
    });
    expect(r.players[0]).toMatchObject({
      rank: { checkedAt: now.toISOString() },
      recent: { status: "complete", coveredThrough: now.toISOString(), error: null },
      history: { error: { code: 503 } },
    });
  });
  it("derives interruptions without inventing a finish and strips private or unknown fields", () => {
    const e = envelope();
    Object.assign(e.latest, { puuid: "private", token: "private" });
    const expired = dto(e, new Date(now.getTime() + 330001));
    expect(expired.run).toMatchObject({
      state: "possibly_interrupted",
      finishedAt: null,
      activity: "lease_expired",
    });
    expect(expired.control.state).toBe("available");
    expect(JSON.stringify(expired)).not.toMatch(/leaseOwner|puuid|token|private/);
    expect(
      progressDto({ owner: id, expiresAt: new Date(now.getTime() + 330000), runProgress: e }, now)
        .run?.state,
    ).toBe("interrupted");
    finishRun(e.latest, now.toISOString(), false, "aborted");
    expect(dto(e).run?.state).toBe("completed");
    expect(dto(e).control.state).toBe("cooldown");
  });
  it("treats legacy/corrupt rows and absent selectors as unknown, never the latest result", () => {
    for (const runProgress of [null, { version: 99 }, {}])
      expect(
        progressDto({ owner, expiresAt: new Date(now.getTime() + 1000), runProgress }, now),
      ).toMatchObject({ run: null, control: { state: "busy_unknown" } });
    const row = { owner, expiresAt: new Date(now.getTime() + 1000), runProgress: envelope() };
    expect(progressDto(row, now, { requestId: id }).run).toBeNull();
    expect(progressDto(undefined, now)).toMatchObject({
      run: null,
      control: { state: "available" },
    });
  });
  it("does not display a spinner for terminal results and renders counters without fake percentages", () => {
    const e = envelope();
    applyProgressEvent(
      e.latest,
      { type: "phase", phase: "recent", playerId: id },
      now.toISOString(),
    );
    finishRun(e.latest, now.toISOString(), false, "execution_budget");
    const html = renderToStaticMarkup(
      <AdminOperationFeedback
        work={{ key: "sync", title: "Waiting", startedAt: 0 }}
        notice={null}
        progress={dto(e)}
        refresh={() => undefined}
      />,
    );
    expect(html).toContain("Finalizada con pendientes");
    expect(html).toContain("Último checkpoint");
    expect(html).toContain("Consultar estado");
    expect(html).not.toMatch(/sync-spinner|aria-valuenow|role="progressbar"|%|leaseOwner/);
  });
  it("restores only valid session correlation and POST carries it once without retries", async () => {
    expect(restoreAdminObservation({ getItem: () => "broken" })).toBeNull();
    expect(
      restoreAdminObservation({
        getItem: () => JSON.stringify({ requestId, action: "global", startedAt: now.getTime() }),
      }),
    ).toMatchObject({ requestId });
    const fetcher = vi.fn().mockRejectedValue(new Error("lost POST response"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      requestAdmin("/api/admin/sync", "POST", undefined, requestId),
    ).rejects.toMatchObject({ status: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].headers).toHaveProperty("X-SoloQ-Sync-Request-Id", requestId);
  });
});

describe("serial recoverable observation", () => {
  it("does not credit stale or foreign manual responses and drops callbacks after unmount", async () => {
    vi.useFakeTimers();
    const current = envelope();
    current.latest.revision = 2;
    const stale = envelope();
    stale.latest.revision = 1;
    const foreign = envelope();
    foreign.latest.runId = id;
    let resolve!: (value: ProgressDto) => void;
    const read = vi
      .fn<typeof readAdminProgress>()
      .mockResolvedValueOnce(dto(current))
      .mockResolvedValueOnce(dto(stale, new Date(now.getTime() + 1000)))
      .mockResolvedValueOnce(dto(foreign, new Date(now.getTime() + 2000)))
      .mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
    const opts = options(read);
    const onManualRead = vi.fn();
    const watcher = watchAdminProgress({ ...opts, onManualRead });
    await vi.advanceTimersByTimeAsync(0);
    watcher.refreshManual();
    await vi.advanceTimersByTimeAsync(0);
    expect(onManualRead.mock.lastCall?.[0].state).toBe("error");
    watcher.refreshManual();
    await vi.advanceTimersByTimeAsync(0);
    expect(onManualRead.mock.lastCall?.[0].state).toBe("error");
    expect(opts.onStatus).toHaveBeenCalledOnce();
    watcher.refreshManual();
    watcher.stop();
    const calls = onManualRead.mock.calls.length;
    resolve(dto(current));
    await vi.advanceTimersByTimeAsync(0);
    expect(onManualRead).toHaveBeenCalledTimes(calls);
    expect(opts.onStatus).toHaveBeenCalledOnce();
    expect(read.mock.calls[1][0]).toEqual({ runId });
  });
  it("renders manual loading, persistent results and separate local consultation time", () => {
    const render = (state: "loading" | "changed" | "unchanged" | "error") =>
      renderToStaticMarkup(
        <AdminProgressQuery
          refresh={() => undefined}
          result={{ state, lastSuccessfulAt: now.getTime() }}
        />,
      );
    expect(render("loading")).toContain("Consultando…");
    expect(render("loading")).toContain('disabled=""');
    expect(render("loading")).toContain("Obteniendo el estado actualizado del servidor…");
    expect(render("changed")).toContain("Estado actualizado");
    expect(render("unchanged")).toContain(
      "Consulta completada. Sin cambios desde la última consulta",
    );
    expect(render("error")).toContain("No se pudo consultar el estado");
    expect(render("error")).not.toContain('disabled=""');
    expect(render("changed")).toContain("Última consulta exitosa (hora local)");
    expect(render("changed")).toContain('role="status"');
  });
  it("queues a single manual read behind polling, ignores serverNow and preserves polling cadence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let resolve!: (v: ProgressDto) => void;
    const read = vi
      .fn<typeof readAdminProgress>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue(dto(undefined, new Date(now.getTime() + 1000)));
    const onManualRead = vi.fn();
    const watcher = watchAdminProgress({ ...options(read), onManualRead });
    watcher.refreshManual();
    watcher.refreshManual();
    expect(onManualRead).toHaveBeenCalledExactlyOnceWith({
      state: "loading",
      lastSuccessfulAt: null,
    });
    expect(read).toHaveBeenCalledOnce();
    resolve(dto());
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    expect(onManualRead.mock.lastCall?.[0]).toMatchObject({
      state: "unchanged",
      lastSuccessfulAt: now.getTime(),
    });
    const feedbackCount = onManualRead.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(onManualRead).toHaveBeenCalledTimes(feedbackCount);
    const changed = envelope();
    changed.latest.revision++;
    read.mockResolvedValue(dto(changed, new Date(now.getTime() + 16000)));
    watcher.refreshManual();
    await vi.advanceTimersByTimeAsync(0);
    expect(onManualRead.mock.lastCall?.[0].state).toBe("changed");
    watcher.stop();
  });
  it.each([new ProgressReadError(500), new Error("network")])(
    "ends manual loading on errors without replacing known data",
    async (error) => {
      vi.useFakeTimers();
      const read = vi
        .fn<typeof readAdminProgress>()
        .mockResolvedValueOnce(dto())
        .mockRejectedValue(error);
      const opts = options(read);
      const onManualRead = vi.fn();
      const watcher = watchAdminProgress({ ...opts, onManualRead });
      await vi.advanceTimersByTimeAsync(0);
      watcher.refreshManual();
      await vi.advanceTimersByTimeAsync(0);
      expect(onManualRead.mock.lastCall?.[0]).toMatchObject({ state: "error" });
      expect(opts.onStatus).toHaveBeenCalledOnce();
      watcher.refreshManual();
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(3);
      watcher.stop();
    },
  );
  it("clears manual loading when hidden and ignores results after stop", async () => {
    vi.useFakeTimers();
    let visible = true;
    let changed: () => void = () => undefined;
    let resolve!: (v: ProgressDto) => void;
    const read = vi
      .fn<typeof readAdminProgress>()
      .mockResolvedValueOnce(dto())
      .mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
    const opts = options(read);
    const onManualRead = vi.fn();
    const watcher = watchAdminProgress({
      ...opts,
      onManualRead,
      visible: () => visible,
      subscribe(fn) {
        changed = fn;
        return () => undefined;
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    watcher.refreshManual();
    visible = false;
    changed();
    expect(onManualRead.mock.lastCall?.[0]).toBeNull();
    watcher.stop();
    const calls = onManualRead.mock.calls.length;
    resolve(dto());
    await vi.advanceTimersByTimeAsync(0);
    expect(onManualRead).toHaveBeenCalledTimes(calls);
    expect(opts.onStatus).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("requests no-store with cancellation and parses GET Retry-After without retrying a mutation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "limited" }, { status: 429, headers: { "Retry-After": "45" } }),
      )
      .mockResolvedValueOnce(Response.json(dto()));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await expect(readAdminProgress({ requestId }, signal)).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 45000,
    });
    expect(await readAdminProgress({ runId }, signal)).toMatchObject({ run: { runId } });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(
      fetcher.mock.calls.every(([url]) => String(url).startsWith("/api/admin/sync/progress?")),
    ).toBe(true);
  });
  function options(request: typeof readAdminProgress) {
    return {
      request,
      selector: { requestId },
      startedAt: now.getTime(),
      now: Date.now,
      visible: () => true,
      subscribe: () => () => undefined,
      onStatus: vi.fn(),
      onProblem: vi.fn(),
      onFinished: vi.fn(),
    };
  }
  it("recovers a lost POST/reload by correlation, polls every 15s, ends and cleans up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const e = envelope();
    const read = vi
      .fn<typeof readAdminProgress>()
      .mockResolvedValueOnce(progressDto(undefined, now, { requestId }))
      .mockResolvedValueOnce(dto(e));
    const opts = options(read);
    const watcher = watchAdminProgress(opts);
    await vi.advanceTimersByTimeAsync(0);
    expect(opts.onStatus).toHaveBeenCalledWith(expect.objectContaining({ run: null }));
    await vi.advanceTimersByTimeAsync(15000);
    expect(read.mock.calls[1][0]).toEqual({ requestId });
    finishRun(e.latest, new Date(now.getTime() + 30000).toISOString(), false, "aborted");
    read.mockResolvedValue(dto(e, new Date(now.getTime() + 30000), new Date(0)));
    await vi.advanceTimersByTimeAsync(15000);
    expect(read.mock.calls[2][0]).toEqual({ runId });
    expect(opts.onFinished).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(read).toHaveBeenCalledTimes(3);
    watcher.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never overlaps reads, pauses hidden, aborts pending GET and resumes without POST", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let visible = true;
    let changed: () => void = () => undefined;
    let resolve!: (v: ProgressDto) => void;
    const read = vi
      .fn<typeof readAdminProgress>()
      .mockImplementationOnce(
        (_selector, signal) =>
          new Promise((done) => {
            resolve = done;
            expect(signal.aborted).toBe(false);
          }),
      )
      .mockResolvedValue(dto());
    const unsubscribe = vi.fn();
    const opts = options(read);
    const watcher = watchAdminProgress({
      ...opts,
      visible: () => visible,
      subscribe(fn) {
        changed = fn;
        return unsubscribe;
      },
    });
    watcher.refresh();
    watcher.refresh();
    await vi.advanceTimersByTimeAsync(30000);
    expect(read).toHaveBeenCalledTimes(1);
    visible = false;
    changed();
    expect(read.mock.calls[0][1].aborted).toBe(true);
    resolve(dto());
    await vi.advanceTimersByTimeAsync(0);
    expect(opts.onStatus).not.toHaveBeenCalled();
    visible = true;
    changed();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    watcher.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("rejects foreign and stale responses, accepts expiry with the same revision", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const e = envelope();
    e.latest.revision = 2;
    const old = envelope();
    old.latest.revision = 1;
    const foreign = envelope();
    foreign.latest.requestId = id;
    const read = vi
      .fn<typeof readAdminProgress>()
      .mockResolvedValueOnce(dto(foreign))
      .mockResolvedValueOnce(dto(e))
      .mockResolvedValueOnce(dto(old, new Date(now.getTime() + 1000)))
      .mockResolvedValueOnce(dto(e, new Date(now.getTime() + 330001)));
    const opts = options(read);
    const watcher = watchAdminProgress(opts);
    await vi.advanceTimersByTimeAsync(0);
    expect(opts.onStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15000);
    expect(opts.onStatus).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15000);
    expect(opts.onStatus).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15000);
    expect(opts.onStatus.mock.calls[1][0].run?.state).toBe("possibly_interrupted");
    watcher.stop();
  });
  it.each([401, 503])("stops automatic retries after HTTP %i", async (status) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const read = vi.fn<typeof readAdminProgress>().mockRejectedValue(new ProgressReadError(status));
    const opts = options(read);
    const watcher = watchAdminProgress(opts);
    await vi.advanceTimersByTimeAsync(180000);
    expect(read).toHaveBeenCalledOnce();
    expect(opts.onProblem).toHaveBeenCalledOnce();
    watcher.stop();
  });
  it("honors 429 Retry-After, bounds network backoff and ignores an unmounted response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const read = vi
      .fn<typeof readAdminProgress>()
      .mockRejectedValueOnce(new ProgressReadError(429, 45000))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(dto());
    const opts = options(read);
    const watcher = watchAdminProgress(opts);
    await vi.advanceTimersByTimeAsync(44999);
    expect(read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29999);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(3);
    watcher.stop();
    let resolve!: (v: ProgressDto) => void;
    const pending = vi.fn<typeof readAdminProgress>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const nextOpts = options(pending);
    const next = watchAdminProgress(nextOpts);
    next.stop();
    resolve(dto());
    await vi.advanceTimersByTimeAsync(0);
    expect(nextOpts.onStatus).not.toHaveBeenCalled();
  });
  it("ends unknown correlation after the bounded observation window without attributing another run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const read = vi
      .fn<typeof readAdminProgress>()
      .mockResolvedValue(progressDto(undefined, now, { requestId }));
    const opts = options(read);
    const watcher = watchAdminProgress(opts);
    await vi.advanceTimersByTimeAsync(345000);
    const calls = read.mock.calls.length;
    expect(opts.onProblem).toHaveBeenCalledWith(expect.stringContaining("desconocido"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(read).toHaveBeenCalledTimes(calls);
    watcher.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(calls + 1);
    watcher.stop();
  });
});
