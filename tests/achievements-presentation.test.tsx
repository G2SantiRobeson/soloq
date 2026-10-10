import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AchievementPanel } from "@/components/achievements/achievement-panel";
import { AchievementTitlePreview } from "@/components/achievements/title-preview";
import { ACHIEVEMENT_STATUS_TEXT } from "@/lib/achievements/presentation";
import { achievementPresentation } from "@/server/achievements/presentation";
import { uiFixture, uiPresentation, uiStateFixture, withStatus } from "./achievements-ui-fixtures";

describe("server evidence → presentation → isolated SSR components", () => {
  it.each(Object.keys(ACHIEVEMENT_STATUS_TEXT) as (keyof typeof ACHIEVEMENT_STATUS_TEXT)[])(
    "real fixture evaluations produce %s",
    async (status) => {
      const result = await uiStateFixture(status);
      if (result.status !== "available") throw new Error("fixture failed");
      expect(result.evaluations.every((e) => e.status === status)).toBe(true);
    },
  );
  it("renders the three provisional observations, exact measurements and boundaries without JavaScript", async () => {
    const dto = uiPresentation(await uiFixture());
    const html = renderToStaticMarkup(<AchievementPanel presentation={dto} />);
    for (const text of [
      "Resurrección",
      "Imparable",
      "OTP · muestra importada",
      "Diamond I",
      "80 LP → 25 LP → 80 LP",
      "55 LP",
      "35 / 50",
      "70 %",
      "Yasuo",
      "1.1.A-observed-v1",
      "2026-09-01T12:00:00Z",
      "No se conoce la trayectoria intermedia",
      "No acredita ausencia de partidas",
      "Sin concesiones permanentes",
      "Demo · evidencia ficticia",
      "SoloQ",
      "Temporada 2026",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("OTP certificado");
    expect(html).not.toContain("desbloqueado");
    expect(html).not.toContain("<script");
    expect((html.match(/<details/g) ?? []).length).toBe(4);
    expect(html).toContain("(excluido)");
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });
  it.each(Object.keys(ACHIEVEMENT_STATUS_TEXT) as (keyof typeof ACHIEVEMENT_STATUS_TEXT)[])(
    "%s has an explicit text state in each item",
    async (status) => {
      const dto = uiPresentation(withStatus(await uiFixture(), status));
      const html = renderToStaticMarkup(<AchievementPanel presentation={dto} />);
      expect(html.split(ACHIEVEMENT_STATUS_TEXT[status]).length - 1).toBe(3);
      expect(html).toContain(`data-status="${status}"`);
      if (status === "invalid_input") expect(html).not.toContain("Caída observada");
      if (status === "not_observed") expect(html).not.toContain("nunca lo consiguió");
    },
  );
  it.each(["soloq", "flex"] as const)(
    "preserves explicit %s mode and Demo provenance",
    async (view) => {
      const html = renderToStaticMarkup(
        <AchievementPanel presentation={uiPresentation(await uiFixture(view))} />,
      );
      expect(html).toContain(view === "soloq" ? "SoloQ" : "Flex");
      expect(html).toContain("Datos ficticios");
    },
  );
  it("live provenance never claims to be fictitious or certified", async () => {
    const html = renderToStaticMarkup(
      <AchievementPanel presentation={uiPresentation(await uiFixture("soloq", false))} />,
    );
    expect(html).toContain("Registros almacenados por SoloQ");
    expect(html).not.toContain("Demo ·");
    expect(html).toContain("Sin certificación ni concesión permanente");
  });
  it("keeps coverage counts distinct from percentages and never certifies completed", async () => {
    const result = await uiFixture();
    if (result.status !== "available") throw new Error("fixture failed");
    result.coverage.historyStatus = "completed";
    const dto = uiPresentation(result);
    const html = renderToStaticMarkup(<AchievementPanel presentation={dto} />);
    expect(html).toContain("Historial disponible importado; exhaustividad no acreditada");
    expect(html).toContain("50 IDs procesados, 70 descubiertos y 2 detalles no disponibles");
    expect(html).toContain("No es un porcentaje de temporada");
    expect(html).not.toContain("71,43");
  });
  it("bounds serialized streak IDs but preserves the server's full evidence", async () => {
    const result = await uiFixture();
    if (result.status !== "available") throw new Error("fixture failed");
    const streak = result.evaluations[1].evidence;
    if (streak?.kind !== "recorded_win_streak") throw new Error("fixture failed");
    streak.matchIds = Array.from({ length: 50000 }, (_, i) => `fixture-${i}`);
    streak.maxObservedWins = 50000;
    const dto = uiPresentation(result);
    const serialized = JSON.stringify(dto);
    expect(serialized).toContain("50000");
    expect(serialized).not.toContain("fixture-20,");
    expect(serialized.length).toBeLessThan(10000);
    expect(streak.matchIds).toHaveLength(50000);
  });
  it.each([
    "invalid_request",
    "not_found",
    "ineligible",
    "not_applicable",
    "unavailable",
    "invalid_data",
  ] as const)("%s never shows false negative or invented measurements", (status) => {
    const html = renderToStaticMarkup(
      <AchievementPanel presentation={achievementPresentation({ status })} />,
    );
    expect(html).not.toContain("No observado");
    expect(html).not.toContain("Caída observada");
    if (status === "unavailable") expect(html).toContain("No se evaluaron logros");
    if (status === "not_applicable") expect(html).toContain("5v5");
  });
  it("future concepts and title preview cannot be selected or granted", async () => {
    const html = renderToStaticMarkup(
      <>
        <AchievementPanel
          presentation={uiPresentation(await uiFixture())}
          future={[
            {
              key: "future",
              name: "Concepto futuro",
              description: "Pendiente de reglas aprobadas.",
            },
          ]}
        />
        <AchievementTitlePreview title="Resurgente" />
      </>,
    );
    expect(html).toContain("Futuro · no disponible");
    expect(html).toContain("vista conceptual ficticia");
    expect(html).toContain("No concedido");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });
  it("native summaries have distinct labels, badges are decorative and headings are linked uniquely", async () => {
    const dto = uiPresentation(await uiFixture());
    const html = renderToStaticMarkup(
      <>
        <AchievementPanel presentation={dto} />
        <AchievementPanel presentation={dto} />
      </>,
    );
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...html.matchAll(/aria-labelledby="([^"]+)"/g)].every((m) => ids.includes(m[1]))).toBe(
      true,
    );
    expect((html.match(/aria-hidden="true"/g) ?? []).length).toBe(6);
    expect(html).toContain("Criterio y evidencia de Resurrección");
    expect(html).not.toContain('tabindex="-1"');
  });
  it("does not introduce public imports, client evaluation, routes, IO in components or writes in the reader", () => {
    for (const path of [
      "src/app/page.tsx",
      "src/app/player/[id]/page.tsx",
      "src/components/leaderboard.tsx",
      "src/app/metrics/page.tsx",
    ])
      expect(readFileSync(path, "utf8")).not.toMatch(/achievements/);
    for (const f of readdirSync("src/components/achievements").filter((f) => f.endsWith(".tsx"))) {
      const source = readFileSync(`src/components/achievements/${f}`, "utf8");
      expect(source).not.toMatch(
        /use client|evaluateUnstoppable|evaluateResurrection|evaluateOtp|fetch\(|@\/db|@\/server/,
      );
    }
    const reader = readFileSync("src/server/achievements/queries.ts", "utf8");
    expect(reader).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.execute\(|coalesce|\.limit\(/i);
  });
});
