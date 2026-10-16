import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "@/app/rivalidad/[first]/[second]/page";
import { demoPlayers } from "@/server/demo";
vi.mock("@/server/queries", () => ({
  getLeaderboard: async (view: "soloq" | "flex") => demoPlayers(view),
}));
vi.mock("@/server/env", () => ({ isDemo: () => true }));
vi.mock("@/server/riot/assets", () => ({
  getAssets: async () => ({ version: null, champions: {} }),
}));
it("opens the shared duel without the full leaderboard; preserves return filters", async () => {
  const html = renderToStaticMarkup(
    await Page({
      params: Promise.resolve({ first: "demo-4", second: "demo-5" }),
      searchParams: Promise.resolve({
        queue: "soloq",
        q: "Ronin",
        region: "LA2",
        sort: "winrate",
        dir: "asc",
      }),
    }),
  );
  expect(html).toContain("Demo Ronin vs Demo Marea");
  expect(html).toContain("Rivalidad compartida");
  expect(html).not.toContain('class="leaderboard');
  expect(html).toContain("q=Ronin");
  expect(html).toContain("region=LA2");
  expect(html).toContain("sort=winrate");
  expect(html).toContain("dir=asc");
  expect(html).not.toContain('href="#clasificacion"');
});
it("keeps manual comparisons distinct from automatic proximity", async () => {
  const html = renderToStaticMarkup(
    await Page({
      params: Promise.resolve({ first: "demo-1", second: "demo-4" }),
      searchParams: Promise.resolve({ queue: "soloq", tipo: "elegida" }),
    }),
  );
  expect(html).toContain("Comparación elegida");
  expect(html).not.toContain("Editable por la comunidad");
  expect(html).not.toContain("Cambio de liderazgo observado");
  expect(html).not.toContain("LP de ventaja");
});
it("does not invent an automatic duel for a distant pair", async () => {
  const html = renderToStaticMarkup(
    await Page({
      params: Promise.resolve({ first: "demo-1", second: "demo-4" }),
      searchParams: Promise.resolve({ queue: "soloq" }),
    }),
  );
  expect(html).toContain("ya no está disponible");
  expect(html).not.toContain('class="rivalry-row');
});
