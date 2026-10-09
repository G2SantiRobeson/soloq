import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminOperationFeedback } from "@/components/admin-operation-feedback";
import {
  actionTitle,
  createAdminActionRunner,
  elapsedLabel,
  failureNotice,
  requestAdmin,
  resultNotice,
  waitingMessage,
  watchAdminClock,
} from "@/lib/admin-operation";
import { AdminRequestError } from "@/lib/admin-errors";
import type { IndividualSyncResult } from "@/lib/admin-sync";
import { adminFixture } from "@/app/dev/admin/fixtures";

afterEach(() => vi.unstubAllGlobals());
describe("admin action lifecycle", () => {
  it("ticks elapsed time once per second and stops after finishing or unmounting", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const tick = vi.fn();
      const stop = watchAdminClock(tick);
      vi.advanceTimersByTime(3000);
      expect(tick.mock.calls.map(([now]) => now)).toEqual([1000, 2000, 3000]);
      stop();
      vi.advanceTimersByTime(60000);
      expect(tick).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it("provides immediate feedback, rejects duplicate activation and finishes once", async () => {
    let release!: (value: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const run = createAdminActionRunner();
    const start = vi.fn();
    const finish = vi.fn();
    const first = run(start, () => requestAdmin("/api/admin/sync", "POST"), finish);
    expect(start).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await run(start, () => requestAdmin("/api/admin/sync", "POST"), finish)).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(Response.json({ outcome: "partial", message: "Pendientes" }));
    expect(await first).toMatchObject({ outcome: "partial" });
    expect(finish).toHaveBeenCalledTimes(1);
    const next = run(start, () => requestAdmin("/api/admin/sync", "POST"), finish);
    release(Response.json({ outcome: "success" }));
    await next;
    expect(start).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledTimes(2);
  });
  it("releases the duplicate guard after a connection failure and never retries automatically", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    const run = createAdminActionRunner();
    const finish = vi.fn();
    await expect(
      run(vi.fn(), () => requestAdmin("/api/admin/sync", "POST"), finish),
    ).rejects.toMatchObject({ status: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(Response.json({ message: "Done" }));
    await run(vi.fn(), () => requestAdmin("/api/admin/sync", "POST"), finish);
    expect(finish).toHaveBeenCalledTimes(2);
  });
  it("does not claim completion after a lost or non-JSON successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("proxy page")));
    await expect(requestAdmin("/api/admin/sync", "POST")).rejects.toMatchObject({ status: 0 });
    const notice = failureNotice(new AdminRequestError(0, null), "sync");
    expect(notice.kind).toBe("uncertain");
    expect(notice.message).toMatch(/pudo llegar a ejecutarse/);
    expect(notice.message).toMatch(/diagnósticos antes de reintentar/);
  });
  it.each([429, 409, 503])(
    "distinguishes cooldown HTTP %i from ordinary errors",
    async (status) => {
      const message =
        status === 409
          ? "Ya hay una sincronización en curso o Riot está en espera."
          : "Riot ha limitado las solicitudes.";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ error: message }, { status })),
      );
      try {
        await requestAdmin("/api/admin/sync", "POST");
        throw new Error("Expected rejection");
      } catch (error) {
        expect(failureNotice(error, "sync").kind).toBe("cooldown");
      }
      expect(failureNotice(new AdminRequestError(500, null), "sync").kind).toBe("error");
    },
  );
  it("distinguishes complete, partial, historical pending, skipped and real failures", () => {
    const individual = (status: IndividualSyncResult["status"]): IndividualSyncResult => ({
      playerId: "x",
      status,
      syncState: adminFixture(0, "completed").syncState,
    });
    expect(resultNotice({ result: individual("complete") }, "OK").kind).toBe("success");
    expect(resultNotice({ result: individual("partial") }, "Partial").kind).toBe("partial");
    expect(resultNotice({ result: individual("skipped") }, "Skipped").kind).toBe("partial");
    expect(resultNotice({ result: individual("error") }, "Error").kind).toBe("error");
    expect(
      resultNotice(
        { outcome: "success", backfill: { pending: 13, errors: 0, results: [] } },
        "19/19 recientes",
      ).kind,
    ).toBe("partial");
    expect(resultNotice({ outcome: "failed" }, "Failed").kind).toBe("error");
    expect(
      resultNotice(
        { outcome: "success", backfill: { pending: 1, errors: 1, results: [] } },
        "19/19 recientes",
      ),
    ).toMatchObject({ kind: "error", title: "Recientes completados · histórico con errores" });
  });
  it("names the three sync operations and formats elapsed time without inventing estimates", () => {
    expect(actionTitle("sync", "sync")).toMatch(/todos/);
    expect(actionTitle("player-sync:x", "sync", "Example#LAS")).toMatch(
      /rango y recientes · Example#LAS/,
    );
    expect(actionTitle("backfill:x", "backfill", "Example#LAS")).toMatch(/historial · Example#LAS/);
    expect(elapsedLabel(65)).toBe("1:05");
    expect(elapsedLabel(-1)).toBe("0:00");
    expect(waitingMessage(0)).toMatch(/porcentaje.*verificable/);
    expect(waitingMessage(60)).toMatch(/conserva el progreso/);
    expect(waitingMessage(180)).toMatch(/puede continuar en el servidor/);
  });
});
describe("accessible indeterminate feedback", () => {
  it("renders immediate named activity, animation and a quiet timer without percentages", () => {
    const html = renderToStaticMarkup(
      <AdminOperationFeedback
        work={{ key: "sync", title: "Actualizando todos", startedAt: 1000 }}
        notice={null}
      />,
    );
    expect(html).toContain("Actualizando todos");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuetext="Progreso indeterminado');
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain('role="timer" aria-live="off"');
    expect(html).toContain("0:00");
    expect(html).toContain("sync-spinner");
  });
  it("removes the indicator after completion and separates polite outcomes from errors", () => {
    for (const kind of ["success", "partial", "cooldown", "uncertain", "error"] as const) {
      const html = renderToStaticMarkup(
        <AdminOperationFeedback
          work={null}
          notice={{ kind, title: `Outcome ${kind}`, message: "Result" }}
        />,
      );
      expect(html).not.toContain('role="progressbar"');
      expect(html).not.toContain('role="timer"');
      expect(html).toContain(`Outcome ${kind}`);
      if (kind === "error") expect(html).toMatch(/role="alert".*Outcome error/);
      else expect(html).toMatch(/role="status".*Outcome/);
    }
  });
});
