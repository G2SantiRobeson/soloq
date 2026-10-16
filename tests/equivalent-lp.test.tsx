import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { equivalentLpDistance } from "@/lib/manual-rival";
import { ManualRival } from "@/components/manual-rival";
import { demoPlayers } from "@/server/demo";
import type { RivalIdentity } from "@/lib/nearest-rival";
const base = demoPlayers("soloq")[3];
function p(id: string, tier: string, division: string, lp: number): RivalIdentity {
  return { ...base, id, rank: { tier, division, leaguePoints: lp, wins: 10, losses: 10 } };
}
it("uses a declared nominal scale between regular tiers", () => {
  expect(
    equivalentLpDistance(p("demo-1", "GOLD", "IV", 50), p("demo-2", "PLATINUM", "IV", 50)),
  ).toBe(400);
  expect(
    equivalentLpDistance(p("demo-2", "PLATINUM", "IV", 50), p("demo-1", "GOLD", "IV", 50)),
  ).toBe(400);
});
it("handles a division boundary without inventing a loss of 75 LP", () => {
  expect(equivalentLpDistance(p("demo-1", "GOLD", "I", 80), p("demo-2", "PLATINUM", "IV", 5))).toBe(
    25,
  );
});
it("does not merge apex categories, fabricate unranked data or replace directly comparable LP", () => {
  expect(
    equivalentLpDistance(p("demo-1", "MASTER", "I", 20), p("demo-2", "GRANDMASTER", "I", 20)),
  ).toBeNull();
  expect(
    equivalentLpDistance(p("demo-1", "DIAMOND", "I", 90), p("demo-2", "MASTER", "I", 20)),
  ).toBeNull();
  expect(
    equivalentLpDistance(p("demo-1", "GOLD", "IV", 50), p("demo-2", "GOLD", "IV", 25)),
  ).toBeNull();
  expect(equivalentLpDistance(base, { ...base, rank: null })).toBeNull();
  expect(equivalentLpDistance(base, { ...base, platform: "EUW1" })).toBeNull();
});
it("renders the selected avatar, local tier emblem/colors and an explicit estimate", () => {
  const a = p("demo-1", "GOLD", "IV", 50),
    b = p("demo-2", "PLATINUM", "IV", 50);
  const html = renderToStaticMarkup(
    <ManualRival
      player={a}
      view="soloq"
      version="test"
      initial={{ available: true, demo: true, selectedId: b.id, candidates: [b] }}
    />,
  );
  expect(html).not.toContain("/img/profileicon/");
  expect(html).not.toContain("Platinum IV");
  expect(html).toContain("Tu rival elegido en este navegador");
  expect(html).not.toContain("LP equivalentes");
  expect(html).not.toContain("distancia orientativa");
  expect(html).toContain("Esta selección es local");
  expect(html).not.toContain("Escala de 100 por división");
});
