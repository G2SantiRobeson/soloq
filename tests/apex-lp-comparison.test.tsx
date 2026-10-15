import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { manualComparison, equivalentLpDistance } from "@/lib/manual-rival";
import { ManualDuel } from "@/components/manual-duel";
import type { RivalIdentity } from "@/lib/nearest-rival";
const player = (id: string, tier: string, lp: number, division = "I"): RivalIdentity => ({
  id,
  gameName: id,
  tagLine: "DEMO",
  platform: "LA2",
  profileIconId: null,
  observedAt: "2026-10-14T12:00:00Z",
  rank: { tier, division, leaguePoints: lp, wins: 20, losses: 10 },
});
it.each([
  ["MASTER", "GRANDMASTER"],
  ["MASTER", "CHALLENGER"],
  ["GRANDMASTER", "CHALLENGER"],
])("compares direct LP across %s and %s without offsets", (a, b) => {
  const first = player("demo-1", a, 250, ""),
    second = player("demo-2", b, 700);
  expect(manualComparison(first, second)).toEqual({ leaderId: second.id, gap: 450 });
  expect(manualComparison(second, first)).toEqual({ leaderId: second.id, gap: 450 });
  expect(equivalentLpDistance(first, second)).toBeNull();
});
it("supports zero, tied LP and large values while preserving the official category", () => {
  const master = player("demo-1", "MASTER", 2_000_000_000),
    challenger = player("demo-2", "CHALLENGER", 0);
  expect(manualComparison(master, challenger)).toEqual({
    leaderId: challenger.id,
    gap: 2_000_000_000,
  });
  expect(manualComparison(player("demo-1", "MASTER", 0), challenger)).toEqual({
    leaderId: challenger.id,
    gap: 0,
  });
  expect(
    manualComparison(player("demo-1", "MASTER", 700, ""), player("demo-2", "MASTER", 900)),
  ).toEqual({ leaderId: "demo-2", gap: 200 });
});
it("does not bridge Diamond into the apex scale or accept invalid/cross-platform LP", () => {
  const a = player("demo-1", "MASTER", 250),
    b = player("demo-2", "DIAMOND", 90);
  expect(manualComparison(a, b).gap).toBeNull();
  for (const lp of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(manualComparison(a, player("demo-2", "CHALLENGER", lp)).gap).toBeNull();
  }
  expect(
    manualComparison(a, { ...player("demo-2", "CHALLENGER", 700), platform: "EUW1" }).gap,
  ).toBeNull();
});
it("labels cross-tier LP as a difference and never invents promotion thresholds", () => {
  const html = renderToStaticMarkup(
    <ManualDuel
      players={[player("demo-1", "MASTER", 250), player("demo-2", "CHALLENGER", 700)]}
      view="soloq"
      version={null}
      demo
    />,
  );
  expect(html).toContain("450 LP");
  expect(html).toContain("Diferencia de LP");
  expect(html).toContain("Master");
  expect(html).toContain("Challenger");
  expect(html).toContain("por categoría");
  expect(html).not.toContain("450 LP equivalentes");
  expect(html).toContain("La diferencia no indica los LP necesarios");
});
