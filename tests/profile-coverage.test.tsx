import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryStatusLabel } from "@/components/history-status";
import { CURRENT_SEASON, type HistoryStatus } from "@/lib/season";
import type { PlayerProfile } from "@/lib/types";
import { emptyTotals } from "@/lib/stats";
import PlayerPage from "@/app/player/[id]/page";

const state = vi.hoisted(() => ({ profile: null as PlayerProfile | null, demo: false }));
vi.mock("@/server/queries", () => ({ getProfile: vi.fn(async () => state.profile) }));
vi.mock("@/server/env", () => ({ isDemo: () => state.demo }));
vi.mock("@/server/riot/assets", () => ({
  getAssets: async () => ({ version: "test", champions: {} }),
  profileIconUrl: () => null,
}));
vi.mock("@/components/player-signature-section", () => ({
  PlayerSignatureSection: () => null,
  PlayerSignatureSkeleton: () => null,
}));

function history(status: HistoryStatus["status"]): HistoryStatus {
  return {
    season: CURRENT_SEASON.id,
    status,
    processed: 7,
    discovered: 12,
    unavailable: 2,
    completedAt: null,
  };
}
function render(status?: HistoryStatus["status"], compact = false, demo = false) {
  return renderToStaticMarkup(
    <HistoryStatusLabel
      history={status ? history(status) : undefined}
      compact={compact}
      demo={demo}
    />,
  );
}

afterEach(() => {
  state.profile = null;
  state.demo = false;
});

describe("honest season coverage", () => {
  it.each([
    ["completed", "Recuperación histórica completada", "No garantiza disponer de todas"],
    ["running", "Historial parcial · puede continuar", "no indica una ejecución activa"],
    ["not_started", "Recuperación histórica pendiente", "no se ha iniciado"],
    ["failed", "Recuperación con error · reintentable", "no implica pérdida del progreso"],
  ] as const)(
    "explains saved %s state without promising completion",
    (status, label, explanation) => {
      const html = render(status);
      expect(html).toContain(label);
      expect(html).toContain(explanation);
      expect(html).toContain("7 IDs procesados de 12 descubiertos");
      expect(html).toContain("no es un porcentaje de cobertura de temporada");
      expect(html).toContain("2 partidas sin detalle disponible en Riot");
      expect(html).not.toMatch(/se completará|Importación en curso|\d+%/);
    },
  );
  it("does not equate missing evidence with a pending import", () => {
    const html = render();
    expect(html).toContain("Cobertura histórica desconocida");
    expect(html).not.toMatch(/Recuperación histórica pendiente|IDs procesados|0%/);
  });
  it.each(["completed", "running", "not_started", "failed"] as const)(
    "keeps %s summary compact and accessible",
    (status) => {
      const html = render(status, true);
      expect(html).toContain('aria-label="Cobertura del historial importado"');
    expect(html).toContain('role="note"');
      expect(html).toContain("history-status-compact");
      expect(html).toContain("Métricas y campeones de partidas importadas");
      expect(html).toContain("Rendimiento de temporada");
      expect(html).not.toMatch(/IDs procesados|partidas sin detalle|\d+%/);
    },
  );
  it.each([false, true])("keeps demo coverage explicitly simulated (compact=%s)", (compact) => {
    const html = render("completed", compact, true);
    expect(html).toContain("Historial ficticio de demo");
    expect(html).toContain("estados de importación son simulados");
    expect(html).not.toMatch(/IDs procesados|Recuperación histórica completada|se completará/);
  });
  it.each(["soloq", "flex", "5v5"] as const)(
    "places coverage before metrics without changing %s records",
    async (queue) => {
      state.profile = {
        id: "test",
        gameName: "Tester",
        tagLine: "LAS",
        platform: "LA2",
        profileIconId: null,
        lastSyncedAt: null,
        observedAt: "2026-10-10T12:00:00Z",
        createdAt: "2026-10-01T12:00:00Z",
        rank: { tier: "GOLD", division: "I", leaguePoints: 40, wins: 80, losses: 50 },
        stats: { ...emptyTotals(), games: 3, wins: 2, losses: 1 },
        recent: [],
        champions: [],
        history: [],
        performance: [],
        trackingSince: null,
        momentum: null,
        lpObservations: [],
        seasonHistory: history("running"),
      };
      const html = renderToStaticMarkup(
        await PlayerPage({
          params: Promise.resolve({ id: "test" }),
          searchParams: Promise.resolve({ queue }),
        }),
      );
      expect(html.indexOf("Historial parcial · puede continuar")).toBeLessThan(
        html.indexOf('aria-label="Estadísticas del historial importado"'),
      );
      expect(html).toContain("PARTIDAS IMPORTADAS");
      expect(html).toContain("3 partidas");
      if (queue !== "5v5") {
        expect(html).toContain("80 V");
        expect(html).toContain("130 partidas");
        expect(html).toContain("en el estado ranked actual");
      } else {
        expect(html).toContain("REGISTRO 5V5");
        expect(html).not.toContain("80 V");
      }
    },
  );
});
