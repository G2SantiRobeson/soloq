import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "@/app/rivalidad/[first]/[second]/page";
import Loading from "@/app/rivalidad/[first]/[second]/loading";
import { demoPlayers } from "@/server/demo";
import type { LadderSearchParams } from "@/lib/ladder-filters";
const calls = vi.hoisted(() => ({ query: vi.fn(), assets: vi.fn() }));
vi.mock("@/server/queries", () => ({ getLeaderboard: calls.query }));
vi.mock("@/server/riot/assets", () => ({ getAssets: calls.assets }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/server/env", () => ({ isDemo: () => true }));
beforeEach(() => {
  vi.clearAllMocks();
  calls.query.mockImplementation(async (view) => demoPlayers(view));
  calls.assets.mockResolvedValue({ version: "local-demo", champions: {} });
});
const page = (
  first = "demo-4",
  second = "demo-5",
  params: LadderSearchParams = { queue: "soloq" },
) => Page({ params: Promise.resolve({ first, second }), searchParams: Promise.resolve(params) });
describe("VS existing route", () => {
  it("loads public data once and renders per-queue metrics without new operational services", async () => {
    const html = renderToStaticMarkup(await page());
    expect(calls.query).toHaveBeenCalledExactlyOnceWith("soloq");
    expect(calls.assets).toHaveBeenCalledTimes(1);
    for (const text of [
      "Cara a cara",
      "Rivalidad compartida",
      "Compartir VS",
      "Winrate",
      "KDA",
      "Forma reciente",
      "Momento competitivo",
      "Ficticio · Demo",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain('class="leaderboard');
    expect(html).not.toContain("/api/player/");
  });
  it("allows distant manually chosen pairs, without assigning an automatic rivalry", async () => {
    const html = renderToStaticMarkup(
      await page("demo-1", "demo-4", { queue: "flex", tipo: "elegida" }),
    );
    expect(html).toContain("Comparación elegida");
    expect(html).toContain("Los números, frente a frente");
    expect(html).toContain("tipo=elegida");
    expect(html).toContain("queue=soloq");
    expect(html).toContain("queue=flex");
  });
  it("retains unavailable automatic pairs", async () => {
    expect(renderToStaticMarkup(await page("demo-1", "demo-4"))).toContain("ya no está disponible");
  });
  it("rejects missing players and different platforms without numeric comparisons", async () => {
    for (const data of [
      demoPlayers("soloq").filter((p) => p.id !== "demo-5"),
      demoPlayers("soloq").map((p) => (p.id === "demo-5" ? { ...p, platform: "EUW1" } : p)),
    ]) {
      calls.query.mockResolvedValue(data);
      const html = renderToStaticMarkup(
        await page("demo-4", "demo-5", { queue: "soloq", tipo: "elegida" }),
      );
      expect(html).toContain("ya no está disponible");
      expect(html).not.toContain("Los números, frente a frente");
    }
  });
  it.each([
    ["unsafe", "demo-5", { queue: "soloq" }],
    ["demo-4", "demo-4", { queue: "soloq" }],
    ["demo-4", "demo-5", { queue: "5v5" }],
    ["demo-4", "demo-5", { queue: "unsafe" }],
    ["demo-4", "demo-5", { queue: ["soloq", "flex"] }],
  ] as const)(
    "rejects invalid URLs before any data read: %s / %s",
    async (first, second, params) => {
      await expect(
        page(first, second, {
          ...params,
          queue: typeof params.queue === "string" ? params.queue : [...params.queue],
        }),
      ).rejects.toThrow("NOT_FOUND");
      expect(calls.query).not.toHaveBeenCalled();
      expect(calls.assets).not.toHaveBeenCalled();
    },
  );
  it("has an announced loading state without fabricated figures", () => {
    const html = renderToStaticMarkup(<Loading />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Cargando la comparación VS");
    expect(html).not.toContain("0 LP");
  });
});
