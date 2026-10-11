import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createAutoBackfill, type AutoBackfillState } from "@/lib/auto-backfill";
import { AdminBackfillProgress } from "@/components/admin-backfill-progress";
import { AdminPanel } from "@/components/admin-panel";
import { adminFixture } from "@/app/dev/admin/fixtures";
import { AdminRequestError } from "@/lib/admin-errors";
import { watchAdminProgress, ProgressReadError } from "@/lib/admin-progress-polling";
import {
  applyProgressEvent,
  finishRun,
  newRun,
  progressDto,
  type ProgressDto,
} from "@/lib/sync-progress";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const playerId = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const stamp = () => new Date().toISOString();
function result(
  requestId: string,
  options: {
    status?: "partial" | "complete" | "error" | "skipped";
    processed?: number | null;
    discovered?: number | null;
    exhausted?: boolean;
    code?: number | "deadline";
    wait?: number;
    active?: boolean;
    lastId?: string;
  } = {},
): ProgressDto {
  const run = newRun(
    { action: "player_history", playerId, requestId },
    owner,
    requestId,
    stamp(),
    "2026",
  );
  applyProgressEvent(run, { type: "phase", phase: "history", playerId }, stamp());
  applyProgressEvent(
    run,
    {
      type: "import",
      pass: "history",
      playerId,
      imported: 0,
      confirmedMatchId: options.lastId,
      history: {
        season: "2026",
        mode: "season_backfill",
        processed: options.processed === undefined ? 25 : options.processed,
        discovered: options.discovered === undefined ? 100 : options.discovered,
        unavailable: 2,
        cursorPending: 75,
        scanExhausted: options.exhausted ?? true,
        scanThrough: stamp(),
      },
    },
    stamp(),
  );
  if (options.code === 429)
    applyProgressEvent(
      run,
      { type: "riot_wait", until: new Date(Date.now() + (options.wait ?? 60000)).toISOString() },
      stamp(),
    );
  if (!options.active) {
    applyProgressEvent(
      run,
      {
        type: "result",
        pass: "history",
        result: { playerId, status: options.status ?? "partial", reason: "batch_limit" },
        ...(options.code ? { error: { code: options.code, step: "history" as const } } : {}),
      },
      stamp(),
    );
    finishRun(run, stamp(), !!options.code, "aborted");
    run.cooldownReason = options.code === 429 ? "riot_retry_after" : "pacing";
  }
  return progressDto(
    {
      owner,
      expiresAt: new Date(Date.now() + (options.wait ?? (options.active ? 330000 : 1300))),
      runProgress: { version: 1, latest: run, previous: null },
    },
    new Date(),
  );
}
function harness(send?: () => Promise<unknown>) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
  let n = 10,
    visible = true,
    changed = () => {};
  const states: AutoBackfillState[] = [];
  const begin = vi.fn(() => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`);
  const request = vi.fn(send ?? (async () => ({})));
  const refresh = vi.fn();
  const controller = createAutoBackfill({
    begin,
    send: request,
    refresh,
    onState: (s) => states.push(s),
    visible: () => visible,
    random: () => 0,
    subscribe: (cb) => {
      changed = cb;
      return () => {};
    },
  });
  return {
    controller,
    request,
    refresh,
    states,
    id: () => begin.mock.results.at(-1)!.value as string,
    visibility: (value: boolean) => {
      visible = value;
      changed();
    },
    state: () => states.at(-1)!,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("browser continuation with verified results", () => {
  it.each([401, 403, 503])(
    "stops automatic work when the progress endpoint rejects access (%i)",
    async (status) => {
      const h = harness();
      h.controller.start(playerId, "2026");
      await vi.advanceTimersByTimeAsync(0);
      const watcher = watchAdminProgress({
        request: async () => {
          throw new ProgressReadError(status);
        },
        visible: () => true,
        subscribe: () => () => {},
        onStatus: (dto) => h.controller.observe(dto),
        onProblem: () => {},
        onUnavailable: () => h.controller.stop("Acceso no disponible", "error"),
      });
      await vi.advanceTimersByTimeAsync(60000);
      expect(h.state()).toMatchObject({ active: false, status: "error" });
      expect(h.request).toHaveBeenCalledTimes(1);
      watcher.stop();
      h.controller.dispose();
    },
  );
  it("dispatches only history, serializes duplicate activation and waits for correlated GET", async () => {
    const h = harness();
    expect(h.controller.start(playerId, "2026")).toBe(true);
    expect(h.controller.start(owner, "2026")).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.request).toHaveBeenCalledWith(playerId, "2026", h.id());
    h.controller.observe(result(owner));
    await vi.advanceTimersByTimeAsync(20000);
    expect(h.request).toHaveBeenCalledTimes(1);
    h.controller.observe(result(h.id()));
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.request).toHaveBeenCalledTimes(2);
    h.controller.dispose();
  });
  it("does not send the next batch while the previous POST is still unresolved", async () => {
    let done!: () => void;
    const h = harness(
      () =>
        new Promise<void>((resolve) => {
          done = resolve;
        }),
    );
    h.controller.start(playerId, "2026");
    h.controller.observe(result(h.id()));
    await vi.advanceTimersByTimeAsync(15000);
    expect(h.request).toHaveBeenCalledTimes(1);
    done();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.request).toHaveBeenCalledTimes(2);
    h.controller.dispose();
    done();
  });
  it("stops at completion without starting incremental repair", async () => {
    const h = harness();
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(0);
    h.controller.observe(result(h.id(), { status: "complete", processed: 100 }));
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.state()).toMatchObject({ active: false, status: "completed" });
    expect(h.request).toHaveBeenCalledTimes(1);
    h.controller.dispose();
  });
  it("continues a persisted partial caused by the execution deadline", async () => {
    const h = harness();
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(0);
    h.controller.observe(result(h.id(), { status: "partial", code: "deadline" }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.request).toHaveBeenCalledTimes(2);
    h.controller.dispose();
  });
  it("keeps confirmed progress during 429 and resumes only after shared Retry-After", async () => {
    const h = harness();
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(0);
    const dto = result(h.id(), { status: "error", code: 429, wait: 60000 });
    h.controller.observe(dto);
    expect(h.state().status).toBe("waiting");
    await vi.advanceTimersByTimeAsync(59999);
    expect(h.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(251);
    expect(h.request).toHaveBeenCalledTimes(2);
    h.controller.dispose();
  });
  it("accepts a fresh GET at cooldown expiry without treating the previous 429 as permanent", async () => {
    const h = harness();
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(0);
    const dto = result(h.id(), { status: "error", code: 429 });
    h.controller.observe(dto);
    await vi.advanceTimersByTimeAsync(60000);
    h.controller.observe({
      ...dto,
      serverNow: stamp(),
      control: { state: "available", until: null, reason: null },
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.request).toHaveBeenCalledTimes(2);
    h.controller.dispose();
  });
  it.each([401, 403, 404])("stops permanent Riot error %i", async (code) => {
    const h = harness();
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(0);
    h.controller.observe(result(h.id(), { status: "error", code }));
    expect(h.state().active).toBe(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.request).toHaveBeenCalledTimes(1);
    h.controller.dispose();
  });
  it("bounds 5xx retries and does not count repeated GETs as new failures", async () => {
    const h = harness();
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 4; i++) {
      const dto = result(h.id(), { status: "error", code: 503 });
      h.controller.observe(dto);
      h.controller.observe(dto);
      if (i < 3) await vi.advanceTimersByTimeAsync(15_000 * 2 ** i);
    }
    expect(h.request).toHaveBeenCalledTimes(4);
    expect(h.state().status).toBe("error");
    h.controller.dispose();
  });
  it("lost response is not a reason to resend an unconfirmed mutation", async () => {
    const h = harness(async () => {
      throw new AdminRequestError(0, null);
    });
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(100000);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.state().status).toBe("uncertain");
    h.controller.observe(result(h.id(), { status: "complete" }));
    expect(h.state().status).toBe("completed");
    h.controller.dispose();
  });
  it("fresh polling does not postpone the 5xx backoff deadline", async () => {
    const h = harness();
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(0);
    h.controller.observe(result(h.id(), { status: "error", code: 503 }));
    await vi.advanceTimersByTimeAsync(15000);
    const dto = result(h.id(), { status: "error", code: 503 });
    h.controller.observe(dto);
    await vi.advanceTimersByTimeAsync(15000);
    h.controller.observe({
      ...dto,
      serverNow: stamp(),
      control: { state: "available", until: null, reason: null },
    });
    await vi.advanceTimersByTimeAsync(15000);
    expect(h.request).toHaveBeenCalledTimes(3);
    h.controller.dispose();
  });
  it("stops when a lost POST has no durable correlated result after the lease interval", async () => {
    const h = harness(async () => {
      throw new AdminRequestError(0, null);
    });
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(330000);
    h.controller.observe({ ...result(owner), run: null });
    expect(h.state()).toMatchObject({ active: false, status: "uncertain" });
    expect(h.request).toHaveBeenCalledTimes(1);
    h.controller.dispose();
  });
  it("cannot execute in Demo and does not keep retrying its rejection", async () => {
    const h = harness(async () => {
      throw new AdminRequestError(503, "Demo: sincronización deshabilitada");
    });
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.state()).toMatchObject({ active: false, status: "error" });
    expect(h.request).toHaveBeenCalledTimes(1);
    h.controller.dispose();
  });
  it("caps a progressing session at exactly 100 batches", async () => {
    const h = harness();
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 100; i++) {
      h.controller.observe(result(h.id(), { processed: i + 1, discovered: 200 }));
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(h.state().active).toBe(false);
    expect(h.request).toHaveBeenCalledTimes(100);
    h.controller.dispose();
  });
  it("stop, hidden tab and unmount cannot launch another batch", async () => {
    const h = harness();
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(0);
    h.controller.observe(result(h.id()));
    h.visibility(false);
    await vi.advanceTimersByTimeAsync(20000);
    expect(h.request).toHaveBeenCalledTimes(1);
    h.visibility(true);
    expect(h.refresh).toHaveBeenCalled();
    h.controller.observe({ ...result(h.id()), serverNow: stamp() });
    h.controller.stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.state().status).toBe("paused");
    h.controller.dispose();
    expect(h.controller.start(playerId, "2026")).toBe(false);
  });
  it.each(["interrupted", "possibly_interrupted"] as const)(
    "does not retry %s automatically",
    async (state) => {
      const h = harness();
      h.controller.start(playerId, "2026");
      await vi.advanceTimersByTimeAsync(0);
      const dto = result(h.id());
      dto.run!.state = state;
      h.controller.observe(dto);
      expect(h.state()).toMatchObject({ active: false, status: "uncertain" });
      h.controller.dispose();
    },
  );
  it("pauses after three batches without verified advance and caps session duration", async () => {
    const h = harness();
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 4; i++) {
      h.controller.observe(result(h.id()));
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(h.state().active).toBe(false);
    expect(h.request).toHaveBeenCalledTimes(4);
    h.controller.start(playerId, "2026");
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(h.state().active).toBe(false);
    h.controller.dispose();
  });
});

describe("honest historical progress", () => {
  it("shows opt-in only for incomplete history and keeps paused players disabled", () => {
    const running = adminFixture(0, "running");
    const render = (p = running) =>
      renderToStaticMarkup(
        <AdminPanel players={[p]} context={{ serverNow: stamp(), leaseUntil: null }} />,
      );
    expect(render()).toContain("Continuar historial automáticamente");
    expect(render(adminFixture(0, "completed"))).not.toContain(
      "Continuar historial automáticamente",
    );
    expect(render(adminFixture(0, "running", false))).toMatch(
      /disabled=""[^>]*>Continuar historial automáticamente/,
    );
  });
  it("keeps the same real progress while waiting for Riot", () => {
    const dto = result(owner, { status: "error", code: 429, processed: 183, discovered: 320 });
    const html = renderToStaticMarkup(
      <AdminBackfillProgress dto={dto} playerId={playerId} name="Ficticio" />,
    );
    expect(html).toContain('value="183"');
    expect(html).toContain('max="320"');
    expect(html).toContain("57,2 %");
    expect(html).toContain("Esperando por Riot");
  });
  it("labels retained checkpoints as belonging to the previous batch", () => {
    const dto = result(owner);
    const html = renderToStaticMarkup(
      <AdminBackfillProgress
        dto={dto}
        playerId={playerId}
        name="Ficticio"
        automatic={{
          playerId,
          season: "2026",
          active: true,
          status: "processing",
          message: "Procesando",
          batches: 2,
          retryAt: null,
          requestId: playerId,
          progress: dto,
        }}
      />,
    );
    expect(html).toContain("checkpoint del lote anterior");
    expect(html).toContain('value="25"');
  });
  it.each([
    [0, 100],
    [25, 100],
    [100, 100],
    [25, 200],
  ])("renders %i/%i discovered IDs, not season coverage", (processed, discovered) => {
    const html = renderToStaticMarkup(
      <AdminBackfillProgress
        dto={result(owner, { processed, discovered, lastId: "LA2_123" })}
        playerId={playerId}
        name="Ficticio"
      />,
    );
    expect(html).toContain(`value="${processed}"`);
    expect(html).toContain(`max="${discovered}"`);
    expect(html).toContain("de los IDs descubiertos");
    expect(html).toContain("LA2_123");
    expect(html).toContain("Match ID en curso: desconocido");
    expect(html).toContain("No representa el total de Riot");
  });
  it.each([
    { processed: null },
    { discovered: null },
    { discovered: 0, processed: 0 },
    { exhausted: false },
  ])("uses indeterminate progress without a finished discovery denominator: %o", (options) => {
    const html = renderToStaticMarkup(
      <AdminBackfillProgress dto={result(owner, options)} playerId={playerId} name="Ficticio" />,
    );
    expect(html).not.toMatch(/<progress[^>]*value=/);
    expect(html).not.toContain("% de los IDs descubiertos");
    expect(html).toContain("Progreso indeterminado");
  });
  it("shows checkpoint, unavailable and an unknown current/last ID without inventing an index", () => {
    const html = renderToStaticMarkup(
      <AdminBackfillProgress dto={result(owner)} playerId={playerId} name="Ficticio" />,
    );
    expect(html).toContain("2 no disponibles (404)");
    expect(html).toContain("Sin ID registrado");
    expect(html).toContain("Último checkpoint");
    expect(html).not.toContain("Procesando ID 26");
  });
  it("ignores progress from another player and arbitrary private IDs", () => {
    const dto = result(owner, { lastId: "private-puuid" });
    const html = renderToStaticMarkup(
      <AdminBackfillProgress dto={dto} playerId={owner} name="Ficticio" />,
    );
    expect(html).not.toContain("private-puuid");
    expect(html).not.toMatch(/<progress[^>]*value=/);
  });
  it("renders isolated fictional administrative states (optional visual export)", () => {
    const target = process.env.BACKFILL_VISUAL_DIR;
    const partial = result(owner, { processed: 183, discovered: 320, lastId: "LA2_123456789" });
    const automatic: AutoBackfillState = {
      playerId,
      season: "2026",
      active: true,
      status: "preparing",
      message: "Preparando continuación",
      batches: 4,
      retryAt: null,
      requestId: owner,
      progress: partial,
    };
    const markup = renderToStaticMarkup(
      <main className="container">
        <h1>SoloQ · QA local ficticio</h1>
        <AdminPanel
          players={[
            adminFixture(0, "running"),
            adminFixture(1, "completed"),
            adminFixture(2, "running", false),
          ]}
          context={{ serverNow: stamp(), leaseUntil: null }}
        />
        <AdminBackfillProgress
          dto={partial}
          playerId={playerId}
          name="Jugador con nombre extenso#DEMO"
          automatic={automatic}
          stop={() => {}}
        />
        <AdminBackfillProgress
          dto={result(owner, { exhausted: false })}
          playerId={playerId}
          name="Descubriendo"
        />
        <AdminBackfillProgress
          dto={result(owner, { status: "error", code: 429, processed: 183, discovered: 320 })}
          playerId={playerId}
          name="Espera por Riot"
        />
        <AdminBackfillProgress
          dto={result(owner, { status: "complete", processed: 320, discovered: 320 })}
          playerId={playerId}
          name="Completado"
        />
      </main>,
    );
    expect(markup).toContain('aria-label="IDs descubiertos procesados"');
    expect(markup).toContain("Detener continuación automática");
    if (!target) return;
    mkdirSync(target, { recursive: true });
    const css = readFileSync("src/app/globals.css", "utf8");
    const axe = existsSync("node_modules/axe-core/axe.min.js");
    if (axe)
      writeFileSync(join(target, "axe.min.js"), readFileSync("node_modules/axe-core/axe.min.js"));
    writeFileSync(
      join(target, "backfill.html"),
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SoloQ · QA ficticio de backfill</title><style>${css}</style>${axe ? '<script src="axe.min.js"></script>' : ""}</head><body>${markup}${axe ? '<pre id="qa-audit" style="white-space:pre-wrap;overflow-wrap:anywhere">Evaluando…</pre><script>axe.run(document.querySelector("main"),{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}}).then(r=>{document.getElementById("qa-audit").textContent=JSON.stringify({violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})),passes:r.passes.length,incomplete:r.incomplete.map(v=>v.id)})})</script>' : ""}</body></html>`,
    );
  });
});
