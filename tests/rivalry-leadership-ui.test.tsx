import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Rivalries } from "@/components/rivalries";
import { RivalryLeadership } from "@/components/rivalry-leadership";
import { selectRivalries } from "@/lib/rivalries";
import { detectLeadershipChange } from "@/lib/rivalry-leadership";
import { demoPlayers } from "@/server/demo";
import { getLeaderboard } from "@/server/queries";
vi.mock("postgres", () => ({
  default: vi.fn(() => {
    throw Error("NO_POSTGRES");
  }),
}));
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-14T12:00:00Z"));
  vi.stubEnv("DEMO_MODE", "true");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("observed leadership UI and fictional demo", () => {
  it.each(["soloq", "flex"] as const)(
    "shows coherent Ronin/Marea reversal in %s without network",
    async (view) => {
      const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("NO_NETWORK"));
      const players = await getLeaderboard(view);
      const rivalry = selectRivalries(players, view)[0];
      expect(rivalry.players.map((p) => p.id).sort()).toEqual(["demo-4", "demo-5"]);
      const [first, second] = rivalry.players;
      const change = detectLeadershipChange(first, second, view, { asOf: first.observedAt })!;
      expect(change.before.leaderId).toBe(view === "soloq" ? "demo-5" : "demo-4");
      expect(change.after.leaderId).toBe(view === "soloq" ? "demo-4" : "demo-5");
      for (const player of rivalry.players) {
        const last = player.rivalryHistory!.at(-1)!;
        expect(last).toMatchObject(player.rank!);
        const profile = demoPlayers(view, "season", player.id)[0];
        expect(profile.history.at(-1)).toMatchObject(player.rank!);
        expect(profile.rivalryHistory).toEqual(player.rivalryHistory);
        const points = player.rivalryHistory!;
        expect(
          points.every(
            (p, i) => i === 0 || Date.parse(p.timestamp) > Date.parse(points[i - 1].timestamp),
          ),
        ).toBe(true);
      }
      const markup = renderToStaticMarkup(
        <Rivalries rivalries={[rivalry]} view={view} demo version={null} />,
      );
      expect(markup).toContain("Cambio de liderazgo observado");
      expect(markup).toContain("Ficticio · Demo");
      expect(markup).toContain("Primer corte");
      expect(markup).toContain("Último corte observado");
      for (const p of [...change.before.observations, ...change.after.observations]) {
        expect(markup).toContain(`${p.leaguePoints} LP`);
        expect(markup).toContain(`dateTime="${p.timestamp}"`);
      }
      expect(markup).toContain("Cortes históricos");
      expect(markup).toContain("No indica el momento exacto");
      expect(markup).toContain("UTC");
      expect(markup).toContain('href="#clasificacion"');
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("shows no event or alert without adequate evidence", () => {
    const rivalry = selectRivalries(demoPlayers("soloq"), "soloq")[0];
    for (const p of rivalry.players) p.rivalryHistory = undefined;
    expect(renderToStaticMarkup(<RivalryLeadership rivalry={rivalry} view="soloq" demo />)).toBe(
      "",
    );
    expect(
      renderToStaticMarkup(<Rivalries rivalries={[rivalry]} view="soloq" demo version={null} />),
    ).not.toContain("Cambio de liderazgo");
  });
  it("rejects invalid as-of dates and does not produce a 5v5 event", () => {
    const rivalry = selectRivalries(demoPlayers("soloq"), "soloq")[0];
    rivalry.players[0].observedAt = "invalid";
    expect(renderToStaticMarkup(<RivalryLeadership rivalry={rivalry} view="soloq" demo />)).toBe(
      "",
    );
    expect(renderToStaticMarkup(<RivalryLeadership rivalry={rivalry} view="5v5" demo />)).toBe("");
  });
  it("keeps non-rival demo fixtures unchanged in shape and history", () => {
    for (const view of ["soloq", "flex"] as const)
      for (const player of demoPlayers(view).filter((p) => !["demo-4", "demo-5"].includes(p.id)))
        expect(player.rivalryHistory).toEqual([]);
  });
});

describe("rivalry-first presentation and evidence-gated banter", () => {
  it("keeps the original cuts in a collapsed accessible comparison table", () => {
    const rivalry = selectRivalries(demoPlayers("soloq"), "soloq")[0];
    const markup = renderToStaticMarkup(<RivalryLeadership rivalry={rivalry} view="soloq" demo />);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("aria-controls=");
    expect(markup).toContain('class="rivalry-evolution-content" hidden=""');
    expect(markup.match(/class="rivalry-evolution-content"/g)).toHaveLength(1);
    expect(markup).toContain("Ver evolución");
    expect(markup).toContain('<th scope="col">Antes');
    expect(markup).toContain('<th scope="col">Último corte observado');
    expect(markup).toContain('<th scope="row">Demo Ronin');
    expect(markup).toContain("leadership-cell-leader was-leading");
    expect(markup).toContain("leadership-cell-leader is-leading");
    expect(markup).not.toContain("leadership-cut-before");
    expect(markup).toContain("Ahora Demo Ronin tiene de hijo a Demo Marea");
    expect(markup).toContain(
      "Antes lideraba Demo Marea; en un corte posterior comparable, Demo Ronin pasó a liderar",
    );
    expect(markup).toContain("Intervalo observado");
    expect(markup).toContain("Último corte observado");
    expect(markup).toContain("Nota interpretativa");
  });
  it("distinguishes a historical reversal from a different current leader", () => {
    const rivalry = structuredClone(selectRivalries(demoPlayers("soloq"), "soloq")[0]);
    const marea = rivalry.players.find((p) => p.id === "demo-5")!;
    const last = marea.rivalryHistory!.at(-1)!;
    const later = {
      ...last,
      leaguePoints: 80,
      wins: last.wins + 1,
      timestamp: "2026-10-14T11:50:00Z",
    };
    marea.rivalryHistory = [...marea.rivalryHistory!, later];
    marea.rank = { ...marea.rank, leaguePoints: 80, wins: later.wins };
    const markup = renderToStaticMarkup(
      <Rivalries rivalries={[rivalry]} view="soloq" demo version={null} />,
    );
    expect(markup).toContain("23 LP");
    expect(markup).toContain("Demo Marea lidera ahora");
    expect(markup).toContain("En ese corte, Demo Ronin le quitó el trono a Demo Marea");
    expect(markup).not.toContain("Ahora Demo Ronin tiene de hijo");
    expect(markup).toContain("El último corte observado es histórico");
  });
  it("retains a current duel without producing banter when evidence is absent", () => {
    const rivalry = structuredClone(selectRivalries(demoPlayers("soloq"), "soloq")[0]);
    for (const player of rivalry.players) player.rivalryHistory = undefined;
    const markup = renderToStaticMarkup(
      <Rivalries rivalries={[rivalry]} view="soloq" demo version={null} />,
    );
    expect(markup).toContain("25 LP");
    expect(markup).toContain("Va liderando");
    expect(markup).not.toContain("tiene de hijo");
    expect(markup).not.toContain("Ver evolución");
  });
});

describe("compact historical timestamps", () => {
  it.each([0, 120_000])("preserves simultaneous or distinct observed dates: %i", (offset) => {
    const rivalry = structuredClone(selectRivalries(demoPlayers("soloq"), "soloq")[0]);
    const [first, second] = rivalry.players;
    second.rivalryHistory = second.rivalryHistory!.map((point, index) => ({
      ...point,
      timestamp: new Date(
        Date.parse(first.rivalryHistory![index].timestamp) + offset,
      ).toISOString(),
    }));
    const markup = renderToStaticMarkup(<RivalryLeadership rivalry={rivalry} view="soloq" demo />);
    const dates = markup.split('<dl class="leadership-dates">')[1].split("</dl>")[0];
    expect(dates.match(/<time /g)).toHaveLength(offset === 0 ? 2 : 4);
    expect(markup).toContain("Último corte observado");
    expect(markup).not.toContain('<th scope="col">Ahora');
    expect(markup).not.toContain("Ventaja actual");
    if (offset === 0) expect(markup).toContain("Ambos jugadores:");
    else {
      expect(markup).toContain("Demo Ronin:");
      expect(markup).toContain("Demo Marea:");
    }
  });
});
