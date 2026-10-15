import { it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import { Rivalries } from "@/components/rivalries";
import { selectRivalries } from "@/lib/rivalries";
import { demoPlayers } from "@/server/demo";
afterEach(() => vi.restoreAllMocks());
it.each(["approaching", "separating", "long-names"] as const)(
  "renders an evidence-backed local visual fixture: %s",
  (kind) => {
    const asOf = "2026-10-14T12:00:00Z";
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(asOf));
    const rivalry = structuredClone(selectRivalries(demoPlayers("soloq"), "soloq")[0]);
    for (const [i, p] of rivalry.players.entries()) {
      const start = kind === "separating" ? [50, 65] : [40, 65],
        end = kind === "separating" ? [40, 65] : [50, 65];
      p.rivalryHistory = [
        {
          tier: "DIAMOND",
          division: "I",
          leaguePoints: start[i],
          wins: 20,
          losses: 10,
          queue: rivalry.queue,
          timestamp: "2026-10-14T10:00:00Z",
        },
        {
          tier: "DIAMOND",
          division: "I",
          leaguePoints: end[i],
          wins: 21,
          losses: 10,
          queue: rivalry.queue,
          timestamp: "2026-10-14T11:00:00Z",
        },
      ];
      p.rank = { ...p.rank, ...p.rivalryHistory.at(-1)! };
      p.observedAt = asOf;
      if (kind === "long-names") {
        p.gameName = "JugadorConNombreVisibleExtremadamenteLargoSinEspacios" + i;
        p.tagLine = "RiotTagExtremadamenteLargoParaComprobarOverflow";
      }
    }
    const html = renderToStaticMarkup(
      <Rivalries rivalries={[rivalry]} view="soloq" version={null} asOf={asOf} demo />,
    );
    expect(html).toContain(
      kind === "separating" ? "Separación observada" : "Acercamiento observado",
    );
    expect(html).toContain("Actividad reciente de esta rivalidad");
    expect(html).not.toContain("weekly-rivalry-badge");
    expect(html.match(/class="rivalry-row"/g)).toHaveLength(1);
    if (process.env.RIVALRY_VISUAL_QA === "true")
      writeFileSync("artifacts/f5-visual-" + kind + ".html", html);
  },
);
