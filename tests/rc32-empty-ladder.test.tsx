import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { Leaderboard } from "@/components/leaderboard";
import { demoPlayers } from "@/server/demo";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("RC3.2 empty ladder accessibility", () => {
  it.each(["soloq", "5v5"] as const)(
    "%s hides the empty table while retaining recovery and the visible count",
    (view) => {
      const html = renderToStaticMarkup(
        <Leaderboard players={[]} view={view} version={null} champions={{}} demo />,
      );
      expect(html).toContain('class="leaderboard" role="table" hidden=""');
      expect(html).toContain("La clasificación aún está vacía.");
      expect(html).toContain('href="/admin"');
      expect(html).toContain("0 de 0 jugadores");
    },
  );

  it("hides a filtered-empty table but keeps the reset action", () => {
    const html = renderToStaticMarkup(
      <Leaderboard
        players={demoPlayers("soloq")}
        view="soloq"
        version={null}
        champions={{}}
        demo
        initialFilters={{
          search: "sin-coincidencia",
          region: "all",
          sort: "rank",
          ascending: false,
        }}
      />,
    );
    expect(html).toContain('role="table" hidden=""');
    expect(html).toContain("Ningún jugador coincide.");
    expect(html).toContain("Restablecer filtros");
  });

  it("keeps a populated table exposed, including all original columns", () => {
    const html = renderToStaticMarkup(
      <Leaderboard
        players={demoPlayers("soloq")}
        view="soloq"
        version={null}
        champions={{}}
        demo
      />,
    );
    expect(html).toContain('class="leaderboard" role="table">');
    expect(html).toContain("Jugador / Riot ID");
    expect(html).toContain("Winrate");
    expect(html).toContain("Forma");
  });

  it("honors native hidden even when mobile CSS changes the table display", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css.match(/\.leaderboard\[hidden\] \{([^}]+)\}/)?.[1]).toContain("display: none");
  });
});
