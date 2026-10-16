import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "@/app/logros/page";
import { readAchievementCenter } from "@/server/achievements/center";
import { demoPlayers } from "@/server/demo";
import { ACHIEVEMENTS } from "@/lib/achievements/catalog";
import { AchievementCatalog } from "@/components/achievements/achievement-catalog";
vi.mock("postgres", () => ({
  default: vi.fn(() => {
    throw Error("FORBIDDEN_DATABASE");
  }),
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("VERCEL_TARGET_ENV", undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each(["soloq", "flex"] as const)(
  "evaluates coherent public Demo cases in %s without network or grants",
  async (view) => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("FORBIDDEN_NETWORK"));
    const many = await readAchievementCenter("demo-5", view, new Date().toISOString());
    const few = await readAchievementCenter("demo-4", view, new Date().toISOString());
    const empty = await readAchievementCenter("demo-8", view, new Date().toISOString());
    for (const selection of [many, few, empty]) {
      expect(selection.presentation?.status).toBe("available");
      if (selection.presentation?.status === "available") {
        expect(selection.presentation.demo).toBe(true);
        expect(
          selection.presentation.items.every(
            (i) => i.grantAuthorized === false && i.certification === "not_established",
          ),
        ).toBe(true);
      }
    }
    if (
      many.presentation?.status !== "available" ||
      few.presentation?.status !== "available" ||
      empty.presentation?.status !== "available"
    )
      throw Error("DEMO_READ_FAILED");
    expect(
      many.presentation.items.filter((i) => i.status === "observed").length,
    ).toBeGreaterThanOrEqual(2);
    expect(few.presentation.items.filter((i) => i.status === "observed")).toHaveLength(1);
    expect(empty.presentation.items.every((i) => i.status === "insufficient_evidence")).toBe(true);
    const player = demoPlayers(view, "season", "demo-5")[0];
    const otp = many.presentation.items.find((i) => i.code === "otp-specialist")!;
    expect(otp.specialization?.sample).toBe(player.recent.length);
    const html = renderToStaticMarkup(
      <AchievementCatalog
        presentation={many.presentation}
        enabled
        selected
        view={view}
        playerId="demo-5"
      />,
    );
    for (const definition of ACHIEVEMENTS) expect(html).toContain(definition.ruleVersion);
    expect(html).toContain("Thresh");
    const emptyHtml = renderToStaticMarkup(
      <AchievementCatalog
        presentation={empty.presentation}
        enabled
        selected
        view={view}
        playerId="demo-8"
      />,
    );
    expect(emptyHtml).toContain("Datos insuficientes");
    expect(many.presentation.items.find((i) => i.code === "resurrection")?.status).toBe(
      "not_observed",
    );
    const pendingHtml = renderToStaticMarkup(
      <AchievementCatalog
        presentation={few.presentation}
        enabled
        selected
        view={view}
        playerId="demo-4"
      />,
    );
    expect(pendingHtml).toContain("No observado");
    expect(html).not.toContain("Insignia obtenida");
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("server page preserves selected profile and modality without inventing observed states", async () => {
  const html = renderToStaticMarkup(
    await Page({ searchParams: Promise.resolve({ player: "demo-5", queue: "flex" }) }),
  );
  expect(html).toContain("Demo Marea#DEMO");
  expect(html).toContain("/player/demo-5?queue=flex");
  expect(html).toContain("/logros?queue=soloq&amp;player=demo-5");
  expect(html).toContain("Demo · evidencia ficticia");
  expect(html).toContain('aria-label="Categorías de logros"');
  expect(html.match(/<summary>/g)?.length).toBeGreaterThanOrEqual(3);
});
it("production Demo evaluates fictional observations without grants or fake progress", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "production");
  const html = renderToStaticMarkup(
    await Page({ searchParams: Promise.resolve({ player: "demo-5" }) }),
  );
  expect(html).toContain('data-state="observed"');
  expect(html).toContain("Demo · evidencia ficticia");
  expect(html).not.toContain('role="progressbar"');
  expect(html).toContain("Sin concesión permanente");
});
