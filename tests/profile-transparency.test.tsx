import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerSignature } from "@/components/player-signature";
import { PlayerMomentum, LastFiveMomentum } from "@/components/player-momentum";
import { MatchHistory } from "@/components/match-history";
import { PerformanceChart } from "@/components/performance-chart";
import { computeSignature, toSignaturePlayer } from "@/lib/signature";
import { demoPlayers } from "@/server/demo";
import { summarizeLp, LP_WINDOW, type RankSnapshot } from "@/lib/lp-metrics";
import { matchPage } from "@/lib/match-pagination";

describe("signature reference presentation", () => {
  it.each(["soloq", "flex", "5v5"] as const)(
    "identifies the mode and each reference in %s",
    (view) => {
      const input = toSignaturePlayer(demoPlayers(view)[0], view);
      const metrics = computeSignature(input, { balance: { mean: 0, sd: 1 } });
      const community = metrics.all.find((m) => m.id === "balance")!;
      const defaults = metrics.all.filter((m) => m.referenceSource === "default").slice(0, 2);
      const html = renderToStaticMarkup(
        <PlayerSignature
          name="Tester"
          tier={null}
          view={view}
          featured={[community]}
          others={defaults}
        />,
      );
      expect(html).toContain("REFERENCIAS MIXTAS");
      expect(html).toContain("Referencia: comunidad");
      expect(html).toContain("Referencia: valores del sistema");
      expect(html).toContain("no logros desbloqueados");
      expect(html).toContain('aria-label="Fuentes y muestras de la Firma competitiva"');
      expect(html).not.toContain("VS. PROMEDIO DE LA COMUNIDAD");
    },
  );
  it("never calls a non-null empty baseline a community average", () => {
    const { featured, others } = computeSignature(
      toSignaturePlayer(demoPlayers("soloq")[0], "soloq"),
      {},
    );
    const html = renderToStaticMarkup(
      <PlayerSignature name="Tester" tier={null} view="soloq" {...{ featured, others }} />,
    );
    expect(html).toContain("VALORES DEL SISTEMA");
    expect(html).not.toContain("Referencia: comunidad");
  });
  it("labels community demo baselines as simulated", () => {
    const metrics = computeSignature(toSignaturePlayer(demoPlayers("flex")[0], "flex"), {
      balance: { mean: 0, sd: 1 },
    });
    const html = renderToStaticMarkup(
      <PlayerSignature
        name="Demo"
        tier={null}
        view="flex"
        demo
        featured={metrics.all.filter((m) => m.id === "balance")}
        others={[]}
      />,
    );
    expect(html).toContain("COMUNIDAD SIMULADA");
    expect(html).toContain("Referencia: comunidad simulada");
  });
  it("keeps insufficient data neutral and named", () => {
    const html = renderToStaticMarkup(
      <PlayerSignature name="Tester" tier={null} view="5v5" featured={[]} others={[]} />,
    );
    expect(html).toContain("Todavía no hay partidas suficientes");
    expect(html).toContain('aria-labelledby="signature-heading"');
    expect(html).not.toContain("REFERENCIA COMUNITARIA");
  });
});

describe("observed LP and loaded match windows", () => {
  it.each([false, true])("describes the actual performance sampling in demo=%s", (demo) => {
    const points = [
      { timestamp: "2026-10-10T10:00:00Z", winrate: 100, sample: 1 },
      { timestamp: "2026-10-10T11:00:00Z", winrate: 50, sample: 2 },
    ];
    const html = renderToStaticMarkup(<PerformanceChart points={points} demo={demo} />);
    expect(html).toContain("100.0% · 1 partidas");
    expect(html).toContain("50.0% · 2 partidas");
    expect(html).toContain(demo ? "por partida ficticia (UTC)" : "por día (UTC)");
    expect(html).toContain(
      demo ? "varias del mismo día UTC" : "Última observación de cada día UTC",
    );
    if (demo) expect(html).not.toContain("Última observación de cada día UTC");
    expect(points).toEqual([
      { timestamp: "2026-10-10T10:00:00Z", winrate: 100, sample: 1 },
      { timestamp: "2026-10-10T11:00:00Z", winrate: 50, sample: 2 },
    ]);
  });
  const history: RankSnapshot[] = Array.from({ length: 40 }, (_, i) => ({
    tier: "GOLD",
    division: "I",
    leaguePoints: i,
    wins: i,
    losses: 0,
    timestamp: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
  }));
  it("keeps the 30-observation segment and exposes its actual dates", () => {
    const metrics = summarizeLp(history);
    expect(LP_WINDOW).toBe(30);
    expect(metrics).toMatchObject({
      net: 29,
      intervals: 29,
      from: history[10].timestamp,
      to: history[39].timestamp,
    });
    const html = renderToStaticMarkup(<PlayerMomentum metrics={metrics} detailed />);
    expect(html).toContain("ΔLP observado");
    expect(html).toContain("29 intervalos observados");
    expect(html).toContain("UTC");
    expect(html).toContain('aria-label="Cómo se calcula el ΔLP observado"');
    expect(html).not.toMatch(/LP recientes|\/ 5 partidas/);
    const five = renderToStaticMarkup(
      <LastFiveMomentum metrics={{ net: null, from: null, to: null, reason: "Sin evidencia" }} />,
    );
    expect(five).toContain("Últ. 5:");
    expect(five).not.toContain("ΔLP observado");
  });
  it("keeps missing or isolated observations without a trend", () => {
    for (const metrics of [null, summarizeLp([]), summarizeLp(history.slice(0, 1))])
      expect(renderToStaticMarkup(<PlayerMomentum metrics={metrics} detailed />)).toContain(
        "Sin tendencia",
      );
  });
  it.each([0, 1, 5, 10, 40])("explains %i loaded games without changing pagination", (count) => {
    const rows = Array.from({ length: count }, (_, i) => <article key={i}>Partida {i}</article>);
    const html = renderToStaticMarkup(<MatchHistory rows={rows} />);
    expect(html).toContain(`${count} PARTIDAS RECIENTES CARGADAS`);
    expect(html).toContain("hasta 40 partidas recientes");
    expect(html).toContain("no es todo el");
    expect(html).toContain("contadores ranked son los oficiales de Riot");
    expect((html.match(/<article>/g) ?? []).length).toBe(Math.min(count, 5));
    if (count > 0) {
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('tabindex="-1"');
    }
    const pages = Array.from(
      { length: Math.ceil(count / 10) },
      (_, page) => matchPage(rows, true, page).items,
    );
    expect(pages.flat()).toEqual(rows);
    expect(matchPage(rows, false, 3).items).toEqual(rows.slice(0, 5));
  });
  it("keeps the history window explicitly fictional in demo", () => {
    const html = renderToStaticMarkup(<MatchHistory rows={[]} demo />);
    expect(html).toContain("· DEMO");
    expect(html).toContain("ficticias");
    expect(html).toContain("contadores ranked son ficticios");
  });
});
