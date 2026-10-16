import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "@/app/salon-de-la-fama/page";
vi.mock("postgres", () => ({
  default: vi.fn(() => {
    throw Error("FORBIDDEN_DATABASE");
  }),
}));
beforeEach(() => vi.stubEnv("DEMO_MODE", "true"));
afterEach(() => vi.unstubAllEnvs());
const render = async (queue?: string) =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ queue }) }));
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

describe("hall of fame (Stage C)", () => {
  it("opens with the shared masthead and one sober notice inside it", async () => {
    const html = await render("soloq");
    expect(html).toContain(
      '<section class="page-heading"><div class="page-title"><h1>Salón de la Fama',
    );
    const masthead = html.slice(0, html.indexOf("</section>"));
    expect(masthead).toContain("acreditación real todavía no disponible");
    expect(masthead).toContain("Nombres, hazañas, fechas y récords simulados");
    expect(html.match(/acreditación real todavía no disponible/g)).toHaveLength(1);
    expect(html.match(/Nombres, hazañas, fechas y récords simulados/g)).toHaveLength(1);
    expect(html).not.toContain("eyebrow");
    expect(html).not.toMatch(
      /EL LEGADO DE LA COMUNIDAD|EL PRÓXIMO CAPÍTULO|HISTORIAL PERSONAL|RÉCORDS Y PIONEROS/,
    );
  });

  it("uses the shared queue tabs for SoloQ and Flex only", async () => {
    const html = await render("flex");
    const tabs = html.slice(html.indexOf('aria-label="Modalidad del Salón de la Fama"'));
    const nav = tabs.slice(0, tabs.indexOf("</nav>"));
    expect(nav).toContain('href="/salon-de-la-fama?queue=soloq"');
    expect(nav).toContain('class="queue-tab active" aria-current="page"');
    expect(nav).not.toContain("5v5");
  });

  it("hangs the three original emblems as plaques, legendary first, with no generic trophy art", async () => {
    const html = await render("soloq");
    const plaques = html.slice(html.indexOf('aria-labelledby="hall-concepts"'));
    const order = ["el-intocable.webp", "el-primero-de-su-nombre.webp", "el-monarca.webp"].map(
      (name) => plaques.indexOf(name),
    );
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toMatch(/lucide-trophy|lucide-history/);
  });

  it("keeps the notice honest outside Demo: no simulated names, no Demo sentence", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    const html = await render("soloq");
    expect(html).toContain("acreditación real todavía no disponible");
    expect(html).not.toContain("Nombres, hazañas, fechas y récords simulados");
    expect(html).toContain("Todavía no hay acreditaciones disponibles");
  });

  it("reserves --reward for the Salón and keeps its module free of literal colours and stripes", () => {
    const css = readFileSync("src/components/hall-of-fame/hall.module.css", "utf8");
    expect(css).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(css).not.toMatch(/border-(left|top): 2px/);
    expect(css).toContain("var(--reward)");
    const users = files("src")
      .filter((path) => /\.(css|tsx?)$/.test(path))
      .filter((path) => readFileSync(path, "utf8").includes("var(--reward)"));
    expect(users.map((path) => path.replaceAll("\\", "/"))).toEqual([
      "src/components/hall-of-fame/hall.module.css",
    ]);
    expect(readFileSync("src/app/globals.css", "utf8").match(/--reward:/g)).toHaveLength(1);
  });
});
