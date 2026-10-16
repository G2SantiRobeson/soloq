import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MetricsPage from "@/app/metrics/page";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/env", () => ({ isDemo: () => true }));
vi.mock("@/server/riot/assets", () => ({
  getAssets: async () => ({ version: null, champions: {} }),
}));

const render = async (queue: string, period = "season") =>
  renderToStaticMarkup(await MetricsPage({ searchParams: Promise.resolve({ queue, period }) }));

describe("metrics page (Stage C)", () => {
  it("opens with the shared masthead: figures, context and no label above the title", async () => {
    const html = await render("soloq");
    expect(html).toContain('<section class="page-heading"><div class="page-title"><h1>Métricas');
    for (const label of ["Jugadores", "Participaciones", "Partidas únicas", "Clasificados"])
      expect(html).toContain(`<dt>${label}</dt>`);
    expect(html).toContain("Rendimiento de la comunidad");
    expect(html).not.toContain("eyebrow");
    expect(html).not.toContain("metrics-chips");
  });

  it("shows the shared tier distribution with its source, linking to the ladder strata", async () => {
    const html = await render("soloq");
    expect(html).toContain("Distribución por rango");
    expect(html).toContain("Rangos ficticios de los fixtures de demo");
    expect(html).toMatch(/href="\/\?queue=soloq#estrato-[a-z]+"/);
    expect(html).not.toContain("Distribución de rangos");
    expect(html).not.toContain("rank-bars");
  });

  it("groups leaders into one scoreboard, tinting only the ranked leader", async () => {
    const html = await render("soloq");
    const board = html.slice(
      html.indexOf('class="metrics-scoreboard"'),
      html.indexOf('class="metrics-pair"'),
    );
    for (const title of ["Líder ranked", "Mejor winrate", "Mejor KDA", "Más partidas"])
      expect(board).toContain(`aria-label="${title}"`);
    expect(board).toMatch(
      /metrics-leader" aria-label="Líder ranked" style="--rank-color:var\(--tier-[a-z]+\)"/,
    );
    expect(html.match(/class="metrics-pair"/g)).toHaveLength(3);
  });

  it("5v5 has no rank: no leader, no classified count, no distribution, no LP trend", async () => {
    const html = await render("5v5");
    expect(html).not.toContain("Líder ranked");
    expect(html).not.toContain("<dt>Clasificados</dt>");
    expect(html).not.toContain("Distribución por rango");
    expect(html).not.toContain("Tendencia de LP");
    expect(html).toContain("Forma reciente");
  });

  it("keeps every period link and the calculation notes", async () => {
    const html = await render("flex", "7d");
    expect(html).toContain('href="/metrics?queue=flex&amp;period=season"');
    expect(html).toContain('href="/metrics?queue=soloq&amp;period=7d"');
    expect(html.match(/Cómo se calcula:/g)!.length).toBeGreaterThanOrEqual(8);
  });
});
