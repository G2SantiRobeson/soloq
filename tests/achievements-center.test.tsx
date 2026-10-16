import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ACHIEVEMENTS } from "@/lib/achievements/catalog";
import { ACHIEVEMENT_CATEGORIES, achievementExperienceState } from "@/lib/achievements/experience";
import { AchievementCatalog } from "@/components/achievements/achievement-catalog";
import {
  AchievementShowcase,
  AchievementShowcaseContent,
  AchievementShowcaseLoaded,
} from "@/components/achievements/achievement-showcase";
import { readAchievementCenter } from "@/server/achievements/center";
import { profileAchievementLoader } from "@/server/achievements/profile";
import {
  ProfileAchievementsContent,
  ProfileOtpHighlightContent,
} from "@/components/achievements/profile-achievements";
import { HeaderNav } from "@/components/header-nav";
import type { AchievementDisplay, AchievementPresentation } from "@/lib/achievements/presentation";
import { uiFixture } from "./achievements-ui-fixtures";
const service = vi.hoisted(() => vi.fn());
vi.mock("@/server/achievements/service", () => ({ readPlayerAchievements: service }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/logros",
}));
beforeEach(() => {
  service.mockReset();
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("VERCEL_TARGET_ENV", undefined);
});
afterEach(() => vi.unstubAllEnvs());
const context = { enabled: true, selected: true, view: "soloq" as const };
const available = { status: "available" } as AchievementPresentation;
const item = (status: AchievementDisplay["status"]) => ({ status }) as AchievementDisplay;
it("groups exactly the implemented catalog without invented active badges", () => {
  expect(ACHIEVEMENTS.map((d) => d.code)).toEqual([
    "resurrection",
    "unstoppable",
    "otp-specialist",
  ]);
  expect(ACHIEVEMENT_CATEGORIES.map((c) => c.code)).toEqual([
    "progression",
    "performance",
    "champion",
  ]);
  const html = renderToStaticMarkup(
    <AchievementCatalog presentation={null} enabled={false} selected={false} view="soloq" />,
  );
  expect(html.match(/data-state="disabled"/g)).toHaveLength(3);
  expect(html).toContain("≥50 LP");
  expect(html).toContain("≥5 victorias");
  expect(html).toContain("≥65 %");
  expect(html).toContain("Sin concesión permanente");
  expect(html).toContain("No constituye una certificación");
  expect(html).not.toContain("Futuro · no disponible");
  expect(html).not.toContain('role="progressbar"');
});
it.each([
  ["observed", "observed"],
  ["not_observed", "pending"],
  ["insufficient_evidence", "insufficient"],
  ["invalid_input", "invalid"],
] as const)("maps engine %s to %s without inventing a grant", (status, kind) => {
  expect(achievementExperienceState(item(status), available, context).kind).toBe(kind);
});
it("keeps disabled, unselected, unsupported and unavailable states distinct", () => {
  expect(achievementExperienceState(undefined, null, { ...context, enabled: false }).kind).toBe(
    "disabled",
  );
  expect(achievementExperienceState(undefined, null, { ...context, selected: false }).kind).toBe(
    "unselected",
  );
  expect(achievementExperienceState(undefined, null, { ...context, view: "5v5" }).kind).toBe(
    "not_applicable",
  );
  expect(
    achievementExperienceState(
      undefined,
      { status: "unavailable", message: "No se evaluó" },
      context,
    ).kind,
  ).toBe("unavailable");
});
it("does not read player achievements without a selection, with invalid IDs, off or in 5v5", async () => {
  await readAchievementCenter(undefined, "soloq", "2026-11-01T00:00:00Z");
  for (const id of ["../secret", "<script>", ["demo-5", "demo-4"], "demo-999"])
    expect((await readAchievementCenter(id, "soloq", "2026-11-01T00:00:00Z")).invalid).toBe(true);
  await readAchievementCenter("demo-5", "5v5", "2026-11-01T00:00:00Z");
  vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", undefined);
  vi.stubEnv("DEMO_MODE", "false");
  expect((await readAchievementCenter("demo-5", "soloq", "2026-11-01T00:00:00Z")).enabled).toBe(
    false,
  );
  expect(service).not.toHaveBeenCalled();
});
it("Production cannot activate evaluation even with an accidental true flag", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("DEMO_MODE", "false");
  expect((await readAchievementCenter("demo-5", "soloq", "2026-11-01T00:00:00Z")).enabled).toBe(
    false,
  );
  expect(service).not.toHaveBeenCalled();
});
it("uses one shared evaluation across showcase, original panel and OTP badge", async () => {
  service.mockResolvedValue(await uiFixture());
  const load = profileAchievementLoader("demo-5", "soloq", "2026-11-01T00:00:00Z", {});
  const [showcase] = await Promise.all([
    AchievementShowcaseLoaded({ load }),
    ProfileAchievementsContent({
      playerId: "demo-5",
      view: "soloq",
      asOf: "2026-11-01T00:00:00Z",
      champions: {},
      load,
    }),
    ProfileOtpHighlightContent({ load, champions: {} }),
  ]);
  expect(service).toHaveBeenCalledTimes(1);
  const html = renderToStaticMarkup(showcase);
  expect(html).toContain("Resurrección");
  expect(html).toContain("Racha imparable");
  expect(html).toContain("Ficticio · Demo");
  expect(html).toContain("sin insignias permanentes");
});
it("shows truthful empty and unavailable cases without displaying nonpositive badges", () => {
  expect(renderToStaticMarkup(<AchievementShowcaseContent presentation={null} />)).toContain(
    "No hay una lectura evaluable",
  );
  const presentation = {
    status: "available",
    demo: true,
    items: [item("not_observed"), item("insufficient_evidence")],
  } as AchievementPresentation;
  const html = renderToStaticMarkup(<AchievementShowcaseContent presentation={presentation} />);
  expect(html).toContain("No hay condiciones observadas");
  expect(html).not.toContain("Ficticio · Demo");
});
it("keeps the catalog entry usable when disabled and never loads its evaluation", () => {
  vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", undefined);
  vi.stubEnv("DEMO_MODE", "false");
  const load = vi.fn();
  const html = renderToStaticMarkup(
    <AchievementShowcase playerId="demo-5" view="flex" load={load} />,
  );
  expect(html).toContain("/logros?queue=flex&amp;player=demo-5");
  expect(html).toContain("desactivada");
  expect(load).not.toHaveBeenCalled();
  expect(AchievementShowcase({ playerId: "demo-5", view: "5v5", load })).toBeNull();
});
it("adds an accessible active entry alongside ranking and metrics", () => {
  const html = renderToStaticMarkup(<HeaderNav />);
  expect(html).toContain('href="/logros"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain("Clasificación");
  expect(html).toContain("Métricas");
});
