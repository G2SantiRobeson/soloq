import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "@/app/logros/page";
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
});
const render = async (query: { queue?: string; player?: string }) =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }));
const gallery = (html: string) => html.slice(html.indexOf('aria-label="Galería de desafíos"'));

describe("achievements page (Stage C)", () => {
  it("opens with the shared masthead and the profile picker beside the title", async () => {
    const html = await render({ queue: "soloq", player: "demo-5" });
    expect(html).toContain('<section class="page-heading"><div class="page-title"><h1>Logros');
    const masthead = html.slice(html.indexOf('class="page-heading"'), html.indexOf("</section>"));
    expect(masthead).toContain("Experimental");
    expect(html).toContain('aria-labelledby="achievement-profile-title"');
    const picker = html.slice(html.indexOf('id="achievement-profile-title"'));
    expect(picker.indexOf("Demo Marea#DEMO")).toBeLessThan(picker.indexOf("Galería de desafíos"));
    expect(picker).toContain('aria-label="Casos ficticios de demostración"');
    expect(html).not.toContain("eyebrow");
    expect(html).not.toMatch(/LOGROS E INSIGNIAS|TU MARCA COMPETITIVA|EVIDENCIA REGISTRADA/);
  });

  it("uses the shared queue tabs for SoloQ and Flex only, keeping the consulted profile", async () => {
    const html = await render({ queue: "flex", player: "demo-5" });
    const tabs = html.slice(html.indexOf('aria-label="Modalidad de logros"'));
    expect(tabs).toContain('href="/logros?queue=soloq&amp;player=demo-5"');
    expect(tabs).toContain('class="queue-tab active" aria-current="page"');
    expect(tabs.slice(0, tabs.indexOf("</nav>"))).not.toContain("5v5");
  });

  it("reads each challenge as one row: threshold from the rule, state, evidence and the experimental tag", async () => {
    const html = gallery(await render({ queue: "soloq", player: "demo-5" }));
    for (const threshold of [
      "Caída ≥50 LP y recuperación en ≤30 días",
      "≥5 victorias consecutivas",
      "≥50 partidas y ≥65 % con un campeón",
    ])
      expect(html).toContain(threshold);
    expect(html.match(/<dt>Umbral<\/dt>/g)).toHaveLength(3);
    expect(html.match(/<dt>Evaluación<\/dt>/g)).toHaveLength(3);
    expect(html.match(/>Experimental</g)).toHaveLength(3);
    expect(html).toContain('data-state="observed"');
  });

  it("keeps the catalog honest without a consulted profile: no evidence, no Demo markers", () => {
    const html = renderToStaticMarkup(
      <AchievementCatalog presentation={null} enabled selected={false} view="soloq" />,
    );
    expect(html.match(/Sin jugador consultado/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).not.toContain("Ficticio · Demo");
    expect(html.match(/>Experimental</g)).toHaveLength(3);
  });

  it("outside Demo offers the public ID form in the masthead without reading any player", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", undefined);
    const html = await render({});
    const masthead = html.slice(html.indexOf('class="page-heading"'));
    expect(masthead).toContain('<label for="achievement-player">ID público del perfil</label>');
    expect(html).toContain("Elige un perfil");
    expect(html).toContain("Evaluación desactivada en este entorno");
    expect(html).not.toContain("Casos ficticios de demostración");
  });

  it("keeps the category colour in emblem tokens: the module CSS has no literal colours", () => {
    const css = readFileSync("src/components/achievements/experience.module.css", "utf8");
    expect(css).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(css).not.toMatch(/border-left: 2px/);
    const tokens = readFileSync("src/app/globals.css", "utf8");
    for (const theme of ["recovery", "streak", "mastery"])
      expect(tokens).toMatch(new RegExp(`--emblem-${theme}: #[\\da-f]{6};`));
  });
});
