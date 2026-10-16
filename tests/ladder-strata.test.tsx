import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { strata, tierDistribution, tierKey, tierName } from "@/lib/ladder-strata";
import { Leaderboard } from "@/components/leaderboard";
import { emptyTotals } from "@/lib/stats";
import type { Rank } from "@/lib/ranking";
import type { PublicPlayer } from "@/lib/types";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const rank = (tier: string, division = "I", leaguePoints = 50): Rank => ({
  tier,
  division,
  leaguePoints,
  wins: 10,
  losses: 8,
});
const player = (id: string, gameName: string, r: Rank | null): PublicPlayer => ({
  id,
  gameName,
  tagLine: "LAS",
  platform: "LA2",
  profileIconId: null,
  lastSyncedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  observedAt: "2026-10-10T18:00:00Z",
  rank: r,
  stats: emptyTotals(),
  recent: [],
  momentum: null,
});
const ladder = [
  player("a", "Alfa", rank("GOLD", "II", 40)),
  player("b", "Bravo", rank("CHALLENGER", "I", 1987)),
  player("c", "Charlie", null),
  player("d", "Delta", rank("GOLD", "I", 10)),
  player("e", "Eco", rank("UNRANKED", "", 0)),
];

describe("tier strata", () => {
  it("never invents a tier: missing, unranked or unknown tiers are 'Sin clasificar'", () => {
    expect(tierKey(null)).toBe("UNRANKED");
    expect(tierKey(rank("UNRANKED"))).toBe("UNRANKED");
    expect(tierKey(rank("WOOD"))).toBe("UNRANKED");
    expect(tierName(tierKey(rank("GRANDMASTER")))).toBe("Grandmaster");
    expect(tierName("UNRANKED")).toBe("Sin clasificar");
  });

  it("groups consecutive rows without reordering them", () => {
    const rows = ["GOLD", "GOLD", "SILVER", "GOLD"].map((tier, i) => ({ i, r: rank(tier) }));
    const groups = strata(rows, (row) => row.r);
    expect(groups.map((g) => [g.key, g.rows.map((row) => row.i)])).toEqual([
      ["GOLD", [0, 1]],
      ["SILVER", [2]],
      ["GOLD", [3]],
    ]);
  });

  it("counts players per tier from the highest tier down, unranked last", () => {
    expect(tierDistribution(ladder, (p) => p.rank)).toEqual([
      { key: "CHALLENGER", count: 1 },
      { key: "GOLD", count: 2 },
      { key: "UNRANKED", count: 2 },
    ]);
  });
});

describe("stratified ladder", () => {
  const html = renderToStaticMarkup(
    <Leaderboard players={ladder} view="soloq" version={null} champions={{}} />,
  );

  it("renders one labelled rowgroup per tier in the official order", () => {
    const bands = [...html.matchAll(/class="tier-break-name">([^<]+)</g)].map((m) => m[1]);
    expect(bands).toEqual(["Challenger", "Gold", "Sin clasificar"]);
    expect(html.match(/<tbody role="rowgroup"/g)).toHaveLength(3);
    expect(html).toContain('id="estrato-gold"');
    expect(html).toContain("2 jugadores");
  });

  it("keeps every player row and the official ladder positions", () => {
    expect(html.match(/class="ladder-row/g)).toHaveLength(ladder.length);
    expect(html.indexOf("Bravo")).toBeLessThan(html.indexOf("Delta"));
    expect(html.indexOf("Delta")).toBeLessThan(html.indexOf("Alfa"));
    expect(html).toContain("1.987");
  });

  it("links the distribution segments to their strata and pluralises counts", () => {
    expect(html).toContain('href="#estrato-challenger"');
    expect(html).toContain("Challenger: 1 jugador");
    expect(html).toContain("5 de 5 jugadores");
  });

  it("5v5 has no rank, so it shows neither strata nor a tier distribution", () => {
    const fiveVsFive = renderToStaticMarkup(
      <Leaderboard players={ladder} view="5v5" version={null} champions={{}} />,
    );
    expect(fiveVsFive).not.toContain("tier-break");
    expect(fiveVsFive).not.toContain("tier-distribution");
    expect(fiveVsFive.match(/<tbody role="rowgroup"/g)).toHaveLength(1);
  });

  it("an empty ladder renders its empty state and no distribution", () => {
    const empty = renderToStaticMarkup(
      <Leaderboard players={[]} view="soloq" version={null} champions={{}} />,
    );
    expect(empty).toContain("La clasificación aún está vacía.");
    expect(empty).not.toContain("tier-distribution");
    expect(empty).toContain("0 de 0 jugadores");
  });
});
