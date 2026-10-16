import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { rivalComparisonLabel } from "@/lib/rival-comparison-label";
import { demoPlayers } from "@/server/demo";
import { ManualDuel } from "@/components/manual-duel";
const base = demoPlayers("soloq")[3];
const p = (id: string, tier: string, division: string, lp: number) => ({
  ...base,
  id,
  gameName: id,
  rank: { tier, division, leaguePoints: lp, wins: 10, losses: 10 },
});
it("uses a real LP difference in one division and a direction for different divisions", () => {
  expect(
    rivalComparisonLabel(p("a", "DIAMOND", "I", 57), p("b", "DIAMOND", "I", 32)).text,
  ).toContain("25 LP por debajo de");
  const value = rivalComparisonLabel(p("a", "DIAMOND", "I", 57), p("b", "DIAMOND", "II", 32));
  expect(value.kind).toBe("division");
  expect(value.text).toContain("otra división");
  expect(value.text).not.toContain("LP");
});
it("never presents an internal rank coordinate as LP between regular tiers", () => {
  const a = p("demo-1", "DIAMOND", "I", 57),
    b = p("demo-2", "SILVER", "II", 99);
  expect(rivalComparisonLabel(a, b).text).toBe("Rangos diferentes · distancia en LP no comparable");
  const html = renderToStaticMarkup(
    <ManualDuel players={[a, b]} view="soloq" version={null} demo />,
  );
  expect(html).not.toContain("LP equivalentes");
  expect(html).not.toContain("1658");
  expect(html).toContain("57 LP");
  expect(html).toContain("99 LP");
});
it("preserves the explicitly approved direct apex LP exception", () => {
  expect(
    rivalComparisonLabel(p("a", "MASTER", "", 250), p("b", "CHALLENGER", "I", 700)),
  ).toMatchObject({ kind: "lp", crossApex: true });
});
it.each([null, { tier: "GOLD", division: "I", leaguePoints: -1, wins: 10, losses: 10 }])(
  "shows insufficient data for invalid rank %j",
  (rank) => {
    expect(rivalComparisonLabel({ ...base, rank }, base).text).toBe(
      "No hay datos suficientes para comparar",
    );
  },
);
