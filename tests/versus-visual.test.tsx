import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VersusComparison } from "@/components/versus-comparison";
import { RivalryLeadership } from "@/components/rivalry-leadership";
import { demoPlayers } from "@/server/demo";
import { versusMoment } from "@/lib/versus-comparison";
import { emptyTotals } from "@/lib/stats";
import type { PublicPlayer } from "@/lib/types";
const now = "2026-10-16T12:00:00Z";
const pair = (): [PublicPlayer, PublicPlayer] => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(now));
  const players = demoPlayers("soloq");
  return [players[3], players[4]];
};
const render = (players = pair()) =>
  renderToStaticMarkup(<VersusComparison players={players} view="soloq" champions={{}} demo />);
const scoreboard = (html: string) =>
  html.slice(html.indexOf('aria-label="Marcador comparativo"'), html.indexOf("<details"));
afterEach(() => vi.restoreAllMocks());
describe("VS 2.1 visual presentation without new competitive rules", () => {
  it("shows six facing rows instead of a statistical table, retaining all existing values", () => {
    const html = render(),
      board = scoreboard(html);
    expect(board).not.toContain("<table");
    const keys = [...board.matchAll(/data-metric="([^"]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(["winrate", "kda", "rank", "lp", "record", "weekly"]);
    expect(board.match(/<dl /g)).toHaveLength(12);
    for (const value of ["58,3 %", "59,7 %", "57 LP", "32 LP", "84 V / 60 D", "86 V / 58 D"])
      expect(board).toContain(value);
    expect(board).toContain("Sin datos compatibles");
  });
  it("draws only independent 0–100% winrate bars, without normalizing them to a common score", () => {
    const [a, b] = pair();
    a.stats = { ...emptyTotals(), games: 10, wins: 6, losses: 4 };
    b.stats = { ...emptyTotals(), games: 5, wins: 4, losses: 1 };
    const html = render([a, b]),
      board = scoreboard(html);
    expect([...board.matchAll(/style="width:([^"]+)"/g)].map((m) => m[1])).toEqual(["60%", "80%"]);
    expect(html).toContain("escala independiente de 0 a 100 % por jugador");
    expect(html).toContain("No suman una probabilidad conjunta");
    expect(html).toContain("10 partidas importadas");
    expect(html).toContain("5 partidas importadas");
  });
  it("preserves actual 0% and 100% without synthesizing values for missing samples", () => {
    const [a, b] = pair();
    a.stats = { ...emptyTotals(), games: 5, wins: 0, losses: 5 };
    b.stats = { ...emptyTotals(), games: 10, wins: 10, losses: 0 };
    expect(
      [...scoreboard(render([a, b])).matchAll(/style="width:([^"]+)"/g)].map((m) => m[1]),
    ).toEqual(["0%", "100%"]);
    a.stats = emptyTotals();
    expect(
      [...scoreboard(render([a, b])).matchAll(/style="width:([^"]+)"/g)].map((m) => m[1]),
    ).toEqual(["100%"]);
  });
  it("keeps coverage and all methodological limits in closed native details", () => {
    const html = render();
    expect(html).toContain("<summary>Fuentes, cobertura y metodología</summary>");
    expect(html).not.toMatch(/<details[^>]* open/);
    for (const text of [
      "exhaustividad no acreditada",
      "muestras pueden tener tamaños y cobertura distintos",
      "no determina quién es mejor",
      "máx(1, muertes)",
      "sin atribuir ventaja",
      "No define un ganador del VS",
    ])
      expect(html).toContain(text);
  });
  it("makes leadership inversion explicit without substituting current state for historical cuts", () => {
    const html = render();
    expect(html).toContain("Antes lideraba</span><strong>Demo Marea");
    expect(html).toContain("Después · corte observado</span><strong>Demo Ronin");
    expect(html).toContain("La ventaja actual se muestra arriba");
    expect(html).toContain("Ver evolución");
    expect(html).not.toContain("Ahora Demo Ronin tiene de hijo");
  });
  it("can omit only the existing historical introduction, retaining exact evidence and accessibility", () => {
    const players = pair(),
      m = versusMoment(players, "soloq");
    if (!m) throw new Error("fixture");
    const html = renderToStaticMarkup(
      <RivalryLeadership rivalry={m.rivalry} view="soloq" demo showSummary={false} />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('hidden=""');
    expect(html).toContain("25 LP");
    expect(html).toContain("50 LP");
    expect(html).toContain("57 LP");
    expect(html).toContain("32 LP");
    expect(html).not.toContain('class="leadership-banter"');
    expect(
      renderToStaticMarkup(<RivalryLeadership rivalry={m.rivalry} view="soloq" demo />),
    ).toContain('class="leadership-banter"');
  });
  it("keeps neutral missing-history states and the same five real fixture entries on each side", () => {
    const [a, b] = pair();
    a.rivalryHistory = [];
    b.rivalryHistory = [];
    const html = render([a, b]);
    expect(html).toContain('data-observed="false"');
    expect(html).toContain("No hay cortes históricos compatibles");
    expect(html).not.toContain("Cambio de liderazgo observado");
    expect(html.match(/role="listitem" class="recent-form-item"/g)).toHaveLength(10);
    expect(html).toContain("V: victoria · D: derrota · R: remake.");
  });
});
