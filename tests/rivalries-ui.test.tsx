import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Rivalries } from "@/components/rivalries";
import { Leaderboard } from "@/components/leaderboard";
import { selectRivalries } from "@/lib/rivalries";
import { demoPlayers } from "@/server/demo";
import { getLeaderboard } from "@/server/queries";
import { parseLadderFilters } from "@/lib/ladder-filters";
import type { View } from "@/lib/queues";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("postgres", () => ({
  default: vi.fn(() => {
    throw Error("FORBIDDEN_POSTGRES");
  }),
}));
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-14T03:00:00Z"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const ladder = (view: View, params = {}) =>
  renderToStaticMarkup(
    <Leaderboard
      players={demoPlayers(view)}
      view={view}
      demo
      version="26.1.1"
      champions={{}}
      initialFilters={parseLadderFilters(view, params)}
    />,
  );
const hub = (view: View, params = {}) => {
  const filters = parseLadderFilters(view, params);
  const pool = demoPlayers(view).filter(
    (p) =>
      (filters.region === "all" || p.platform === filters.region) &&
      (p.gameName + "#" + p.tagLine).toLowerCase().includes(filters.search.toLowerCase()),
  );
  return renderToStaticMarkup(
    <Rivalries
      rivalries={selectRivalries(pool, view)}
      view={view}
      demo
      version="26.1.1"
      rankingHref={"/?queue=" + view + "#clasificacion"}
    />,
  );
};
const section = (markup: string) =>
  markup.match(/<section class="rivalries"[\s\S]*?<\/section>/)?.[0] ?? "";

describe("compact rivalries and demo navigation", () => {
  it.each(["soloq", "flex"] as const)(
    "shows a coherent fictional rivalry in %s without database or Riot",
    async (view) => {
      vi.stubEnv("DEMO_MODE", "true");
      const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("NO_NETWORK"));
      const players = await getLeaderboard(view);
      const rivalries = selectRivalries(players, view);
      expect(rivalries.length).toBeGreaterThan(0);
      const markup = section(hub(view));
      expect(markup).toContain("Rivalidades de clasificación");
      expect(markup).toContain("Rangos ficticios de demo");
      expect(markup).toContain('href="/player/demo-4?queue=' + view + '"');
      expect(markup).toContain('href="/player/demo-5?queue=' + view + '"');
      expect(markup).toContain("/rank-icons/diamond.png");
      expect(markup).toContain("/img/profileicon/");
      expect(markup).toContain(view === "soloq" ? "25 LP" : "1 LP");
      expect(fetch).not.toHaveBeenCalled();
      for (const player of players.filter((p) => p.id === "demo-4" || p.id === "demo-5")) {
        const latest = demoPlayers(view, "season", player.id)[0].history.at(-1)!;
        expect(latest).toMatchObject(player.rank!);
        const single = demoPlayers(view, "season", player.id)[0];
        expect(single.rank).toEqual(player.rank);
      }
    },
  );
  it("does not show ranked rivalries in 5v5", () => {
    expect(ladder("5v5")).not.toContain('class="rivalries"');
  });
  it("hides the section when no eligible pair exists", () => {
    expect(renderToStaticMarkup(<Rivalries rivalries={[]} view="soloq" version={null} />)).toBe("");
  });
  it("rejects a rivalry supplied for a different queue", () => {
    const rivalries = selectRivalries(demoPlayers("soloq"), "soloq");
    expect(
      renderToStaticMarkup(<Rivalries rivalries={rivalries} view="flex" version={null} />),
    ).toBe("");
    expect(
      renderToStaticMarkup(<Rivalries rivalries={rivalries} view="5v5" version={null} />),
    ).toBe("");
  });
  it("uses region and search filters, even when no pair remains", () => {
    expect(section(hub("soloq", { region: "NA1" }))).toBe("");
    expect(section(hub("soloq", { q: "Demo Ronin" }))).toBe("");
    expect(section(hub("soloq", { region: "LA2" }))).toContain("Demo Marea");
  });
  it("retains the same rivalry when the table changes its sort", () => {
    expect(section(hub("soloq", { sort: "winrate", dir: "asc" }))).toBe(section(hub("soloq")));
  });
  it("shows both official ranks, LP and profile links, with a classification-only explanation", () => {
    const players = demoPlayers("soloq").filter((p) => p.id === "demo-4" || p.id === "demo-5");
    const rivalries = selectRivalries(players, "soloq");
    const markup = renderToStaticMarkup(
      <Rivalries rivalries={rivalries} view="soloq" version={null} />,
    );
    expect(markup).toContain("Rangos oficiales actuales");
    expect(markup.match(/class="rank-display rank-diamond"/g)).toHaveLength(2);
    expect(markup).toContain("57 LP");
    expect(markup).toContain("32 LP");
    expect(markup).toContain("No representa partidas entre ambos jugadores");
    expect(markup.match(/href="\/player\//g)).toHaveLength(2);
  });
  it("never displays an LP difference for adjacent divisions", () => {
    const players = demoPlayers("soloq").filter((p) => p.id === "demo-4" || p.id === "demo-5");
    players[0].rank = { ...players[0].rank!, division: "II", leaguePoints: 90 };
    players[1].rank = { ...players[1].rank!, division: "I", leaguePoints: 5 };
    const markup = renderToStaticMarkup(
      <Rivalries rivalries={selectRivalries(players, "soloq")} view="soloq" version={null} />,
    );
    expect(markup).toContain("Divisiones contiguas");
    expect(markup).not.toContain("85 LP");
    expect(markup).toContain("Sin ventaja de LP comparable");
  });
});

describe("ranking navigation to the dedicated rivalry page", () => {
  it.each(["soloq", "flex"] as const)(
    "links above the %s table without duplicating the rivalries at its end",
    (view) => {
      const markup = ladder(view);
      expect(markup).toContain('href="/rivalidades?queue=' + view + '"');
      expect(markup.indexOf('href="/rivalidades?queue=')).toBeLessThan(markup.indexOf("<table"));
      expect(markup).toContain('<h2 id="clasificacion" tabindex="-1">');
      expect(markup).not.toContain('class="rivalries"');
      expect(hub(view)).toContain('href="/?queue=' + view + '#clasificacion"');
      expect(markup).toContain("Ver rivalidades");
      expect(hub(view)).toContain("Volver al ranking");
    },
  );
  it.each([
    { view: "5v5" as const, params: {} },
    { view: "soloq" as const, params: { region: "NA1" } },
    { view: "soloq" as const, params: { q: "Demo Ronin" } },
  ])("hides access when the filtered ladder has no rivalry: %j", ({ view, params }) => {
    expect(ladder(view, params)).not.toContain("Ver rivalidades");
    expect(ladder(view, params)).not.toContain('class="rivalries"');
  });
});
