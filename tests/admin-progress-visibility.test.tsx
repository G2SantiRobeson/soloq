import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  adminProgressForPlayers,
  createAdminProgressVisibility,
} from "@/lib/admin-progress-visibility";
import {
  clearFinishedAdminObservation,
  restoreAdminObservation,
} from "@/components/use-admin-progress";
import { AdminPanel } from "@/components/admin-panel";
import { AdminOperationFeedback } from "@/components/admin-operation-feedback";
import { useAdminProgress } from "@/components/use-admin-progress";
import { adminFixture } from "@/app/dev/admin/fixtures";
import {
  applyProgressEvent,
  finishRun,
  newRun,
  progressDto,
  type ProgressDto,
} from "@/lib/sync-progress";
import { watchAdminProgress } from "@/lib/admin-progress-polling";
import { createAutoBackfill } from "@/lib/auto-backfill";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/use-admin-progress", async (original) => ({
  ...(await original<typeof import("@/components/use-admin-progress")>()),
  useAdminProgress: vi.fn(),
}));

const player = { ...adminFixture(0, "running"), id: "00000000-0000-4000-8000-000000000001" };
const other = { ...adminFixture(1, "completed"), id: "00000000-0000-4000-8000-000000000002" };
const requestId = "00000000-0000-4000-8000-000000000003";
const owner = "00000000-0000-4000-8000-000000000004";
const time = new Date("2026-10-11T12:00:00Z");
const storageKey = "soloq-admin-sync-observation-v1";
function fixture(
  state: "running" | "completed" | "partial" | "failed" = "completed",
  global = false,
) {
  const run = newRun(
    {
      action: global ? "global" : "player_history",
      playerId: global ? undefined : player.id,
      requestId,
    },
    owner,
    owner,
    time.toISOString(),
    "2026",
  );
  applyProgressEvent(
    run,
    { type: "phase", phase: "history", playerId: player.id },
    time.toISOString(),
  );
  if (state !== "running") {
    applyProgressEvent(
      run,
      {
        type: "import",
        pass: "history",
        playerId: player.id,
        imported: 7,
        history: {
          season: "2026",
          mode: "season_backfill",
          processed: 112,
          discovered: 112,
          unavailable: 0,
          cursorPending: 0,
          scanExhausted: true,
          scanThrough: time.toISOString(),
        },
      },
      time.toISOString(),
    );
    applyProgressEvent(
      run,
      {
        type: "result",
        pass: "history",
        result: {
          playerId: player.id,
          status: state === "completed" ? "complete" : state === "failed" ? "error" : "partial",
          reason: state === "partial" ? "batch_limit" : undefined,
        },
      },
      time.toISOString(),
    );
    finishRun(run, time.toISOString(), false, "aborted");
  }
  return progressDto(
    {
      owner,
      expiresAt: state === "running" ? new Date(time.getTime() + 330000) : time,
      runProgress: { version: 1, latest: run, previous: null },
    },
    time,
  );
}
function storage(id = requestId) {
  let value: string | null = JSON.stringify({
    requestId: id,
    action: "player_history",
    startedAt: time.getTime(),
  });
  return {
    getItem: () => value,
    removeItem: vi.fn((key: string) => {
      expect(key).toBe(storageKey);
      value = null;
    }),
  };
}
function panel(dto: ProgressDto | null, roster = [player]) {
  vi.mocked(useAdminProgress).mockReturnValue({
    observation: dto,
    problem: null,
    correlated: true,
    begin: vi.fn(),
    cancel: vi.fn(),
    rejected: vi.fn(),
    refresh: vi.fn(),
    refreshManual: vi.fn(),
    manualRead: null,
    blocked: dto?.control.state !== "available" && dto !== null,
  });
  return renderToStaticMarkup(
    <AdminPanel players={roster} context={{ serverNow: time.toISOString(), leaseUntil: null }} />,
  );
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("administrative progress visibility lifecycle", () => {
  it("shows active backfill and its checkpoints after a reload", () => {
    const view = createAdminProgressVisibility().observe(fixture("running"));
    expect(view.terminal).toBe(false);
    expect(panel(view.progress)).toContain(`Historial · ${player.gameName}`);
  });
  it("keeps completion visible in the session that watched the execution", () => {
    const view = createAdminProgressVisibility();
    view.observe(fixture("running"));
    const html = panel(view.observe(fixture()).progress);
    expect(html).toContain("Historial disponible importado");
    expect(html).toContain("112 de 112");
    expect(html).toContain("7 participaciones nuevas");
  });
  it.each(["completed", "partial", "failed"] as const)(
    "hides old confirmed %s panels on reload, even on subsequent polling",
    (state) => {
      const view = createAdminProgressVisibility();
      const dto = fixture(state);
      for (let i = 0; i < 3; i++) {
        const result = view.observe(dto);
        expect(result.terminal).toBe(true);
        expect(result.progress.control).toEqual(dto.control);
        const html = panel(result.progress);
        expect(html).not.toContain("admin-run-feedback");
        expect(html).not.toContain("admin-backfill-progress");
        expect(html).toContain("Consultar estado");
      }
      expect(dto.run?.history?.imported).toBe(7);
    },
  );
  it("shows a final first checkpoint for a newly submitted operation", () => {
    expect(createAdminProgressVisibility(true).observe(fixture()).progress.run?.state).toBe(
      "completed",
    );
  });
  it("allows explicit read-only diagnosis of an old final result", () => {
    const view = createAdminProgressVisibility();
    expect(view.observe(fixture()).progress.run).toBeNull();
    view.reveal();
    expect(panel(view.observe(fixture()).progress)).toContain("Diagnóstico técnico");
  });
  it("preserves the visible cooldown and a single diagnostic query while hiding old results", () => {
    const dto = fixture();
    dto.control = { state: "cooldown", reason: "riot_retry_after", until: time.toISOString() };
    const html = panel(createAdminProgressVisibility().observe(dto).progress);
    expect(html).toContain("Lease ocupado o en espera hasta");
    expect(html.match(/Consultar estado/g)).toHaveLength(1);
    expect(html).not.toContain("admin-run-feedback");
    expect(html).not.toContain("admin-backfill-progress");
  });
  it("never displays missing players or assigns their progress to another player", () => {
    for (const dto of [fixture("running"), fixture()]) {
      const html = panel(dto, [other]);
      expect(html).not.toContain("admin-backfill-progress");
      expect(html).not.toContain("admin-run-feedback");
      expect(html).not.toContain("Jugador seleccionado");
      expect(adminProgressForPlayers(dto, [other.id])?.run).toBeNull();
    }
  });
  it("keeps confirmed removal hidden before roster refresh and after repeated polling", () => {
    const removedIds = new Set([player.id]);
    const ids = [player, other].filter((p) => !removedIds.has(p.id)).map((p) => p.id);
    for (let i = 0; i < 3; i++) {
      const dto = fixture();
      const visible = adminProgressForPlayers(dto, ids);
      expect(visible?.run).toBeNull();
      expect(visible?.control).toEqual(dto.control);
      expect(dto.run?.playerId).toBe(player.id);
    }
  });
  it("global feedback never becomes an individual history panel", () => {
    const dto = fixture("completed", true);
    expect(adminProgressForPlayers(dto, [])).toBe(dto);
    const html = panel(dto);
    expect(html).toContain("Actualización global");
    expect(html).not.toContain("admin-backfill-progress");
  });
  it("clears only the completed matching browser correlation, never stored checkpoints", () => {
    const saved = storage();
    const dto = fixture();
    clearFinishedAdminObservation(saved, dto);
    expect(restoreAdminObservation(saved)).toBeNull();
    expect(dto.run?.history?.imported).toBe(7);
    const newer = storage(owner);
    clearFinishedAdminObservation(newer, dto);
    expect(newer.removeItem).not.toHaveBeenCalled();
    expect(restoreAdminObservation(newer)?.requestId).toBe(owner);
  });
  it("preserves active, uncertain and absent correlations without inventing success", () => {
    const saved = storage();
    for (const state of ["running", "interrupted", "possibly_interrupted"] as const) {
      const dto = fixture("running");
      dto.run!.state = state;
      clearFinishedAdminObservation(saved, dto);
      expect(createAdminProgressVisibility().observe(dto).progress.run?.state).toBe(state);
    }
    clearFinishedAdminObservation(saved, { ...fixture(), run: null });
    expect(saved.removeItem).not.toHaveBeenCalled();
    expect(restoreAdminObservation(saved)?.requestId).toBe(requestId);
  });
  it("storage failures do not discard the visible diagnostic", () => {
    const dto = fixture("failed");
    expect(() =>
      clearFinishedAdminObservation(
        {
          getItem: () => {
            throw new Error("storage disabled");
          },
          removeItem: vi.fn(),
        },
        dto,
      ),
    ).not.toThrow();
    const html = renderToStaticMarkup(
      <AdminOperationFeedback
        work={null}
        notice={null}
        progress={createAdminProgressVisibility(true).observe(dto).progress}
        players={[player]}
        problem="No se pudo consultar el progreso"
      />,
    );
    expect(html).toContain("Finalizada con errores");
    expect(html).toContain("No se pudo consultar el progreso");
  });
  it("a fresh operation cannot inherit an earlier session's revealed result", () => {
    const old = createAdminProgressVisibility(true);
    expect(old.observe(fixture()).progress.run).not.toBeNull();
    expect(createAdminProgressVisibility().observe(fixture()).progress.run).toBeNull();
  });
  it("restored polling follows active work to completion without starting batch continuation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(time);
    const saved = storage();
    const view = createAdminProgressVisibility();
    const send = vi.fn();
    const auto = createAutoBackfill({
      begin: () => requestId,
      send,
      refresh: vi.fn(),
      onState: vi.fn(),
      visible: () => true,
      subscribe: () => () => {},
    });
    const result = vi.fn().mockResolvedValueOnce(fixture("running")).mockResolvedValue(fixture());
    let visible: ProgressDto | null = null;
    const watcher = watchAdminProgress({
      selector: { requestId: restoreAdminObservation(saved)!.requestId },
      request: result,
      visible: () => true,
      subscribe: () => () => {},
      onStatus(dto) {
        visible = view.observe(dto).progress;
        auto.observe(dto);
        clearFinishedAdminObservation(saved, dto);
      },
      onProblem: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(visible!.run?.state).toBe("running");
    expect(saved.removeItem).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15000);
    expect(visible!.run?.state).toBe("completed");
    expect(saved.removeItem).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    watcher.stop();
    auto.dispose();
  });
});
