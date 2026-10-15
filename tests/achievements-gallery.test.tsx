import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { AchievementCatalog } from "@/components/achievements/achievement-catalog";
import { AchievementEmblem } from "@/components/achievements/achievement-emblem";
import { AchievementShowcaseContent } from "@/components/achievements/achievement-showcase";
import { uiFixture, uiPresentation, uiStateFixture } from "./achievements-ui-fixtures";
const context = { enabled: true, selected: true, view: "soloq" as const, playerId: "demo-5" };
describe("F6.2 gallery and experimental emblem identity", () => {
  it("renders precisely three categorized emblem slots with collapsed, named details", async () => {
    const html = renderToStaticMarkup(
      <AchievementCatalog {...context} presentation={uiPresentation(await uiFixture())} />,
    );
    expect(html).toContain('aria-label="Galería de desafíos"');
    for (const [category, theme] of [
      ["progression", "recovery"],
      ["performance", "streak"],
      ["champion", "mastery"],
    ]) {
      expect(html).toContain(`id="logros-${category}"`);
      expect(html).toContain(`data-theme="${theme}"`);
    }
    expect(html.match(/<details/g)).toHaveLength(3);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html.match(/Ver requisitos/g)).toHaveLength(3);
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const label of [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]))
      expect(ids).toContain(label);
    expect(html).not.toMatch(
      /Insignia desbloqueada|Premio obtenido|Logro equipado|role="progressbar"/i,
    );
  });
  it.each([
    ["observed", "Condición observada", "lucide-circle-check"],
    ["not_observed", "No observado", "lucide-circle-dashed"],
    ["insufficient_evidence", "Datos insuficientes", "lucide-circle-help"],
    ["invalid_input", "Datos no válidos", "lucide-circle-x"],
  ] as const)("uses text and a distinct status icon for %s", async (status, label, icon) => {
    const dto = uiPresentation(await uiStateFixture(status));
    const html = renderToStaticMarkup(<AchievementCatalog {...context} presentation={dto} />);
    expect(html).toContain(label);
    expect(html).toContain(icon);
    expect(html).toContain("Experimental");
    expect(html).toContain("Sin concesión permanente");
    for (const item of dto.status === "available" ? dto.items : []) {
      if (item.measurement) expect(html).toContain(item.measurement.replaceAll("&", "&amp;"));
      expect(item.grantAuthorized).toBe(false);
    }
  });
  it("distinguishes disabled and insufficient evidence, without fabricated measurements", async () => {
    const disabled = renderToStaticMarkup(
      <AchievementCatalog {...context} enabled={false} presentation={null} />,
    );
    expect(disabled.match(/data-state="disabled"/g)).toHaveLength(3);
    expect(disabled).toContain("lucide-power");
    expect(disabled).not.toContain("EVIDENCIA REGISTRADA");
    const insufficient = renderToStaticMarkup(
      <AchievementCatalog
        {...context}
        presentation={uiPresentation(await uiStateFixture("insufficient_evidence"))}
      />,
    );
    expect(insufficient).not.toContain("Evaluación desactivada");
    expect(insufficient).toContain("Datos insuficientes");
  });
  it("keeps actual measurements, exact criteria, coverage and profile links in the details", async () => {
    const dto = uiPresentation(await uiFixture());
    const html = renderToStaticMarkup(<AchievementCatalog {...context} presentation={dto} />);
    expect(html).toContain("≥50 LP");
    expect(html).toContain("≥5 victorias");
    expect(html).toContain("≥65 %");
    expect(html).toContain("No hay una prueba de cobertura exhaustiva");
    expect(html).toContain("/player/demo-5?queue=soloq");
    expect(html).toContain("Cómo se acredita");
    expect(html).not.toContain("% completado");
  });
  it("shares the three emblem concepts with the compact profile without equipping awards", async () => {
    const html = renderToStaticMarkup(
      <AchievementShowcaseContent presentation={uiPresentation(await uiFixture())} />,
    );
    for (const theme of ["recovery", "streak", "mastery"])
      expect(html).toContain(`data-theme="${theme}"`);
    expect(html.match(/Condición observada/g)).toHaveLength(3);
    expect(html).toContain("Ficticio · Demo");
    expect(html).not.toContain("Equipar");
    expect(html).toContain("sin insignias permanentes");
    expect(renderToStaticMarkup(<AchievementEmblem code="unstoppable" compact />)).toContain(
      'aria-hidden="true"',
    );
  });
});
