import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HALL_PROPOSALS } from "@/lib/hall-of-fame/proposals";
import { ACHIEVEMENTS } from "@/lib/achievements/catalog";
import { readHallPreview } from "@/server/hall-of-fame/demo";
import { HallOfFame, HallLegacyShowcase } from "@/components/hall-of-fame/hall-of-fame";
import Page from "@/app/salon-de-la-fama/page";
import { HeaderNav } from "@/components/header-nav";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/salon-de-la-fama" }));
vi.mock("postgres", () => ({
  default: vi.fn(() => {
    throw Error("FORBIDDEN_DATABASE");
  }),
}));
beforeEach(() => vi.stubEnv("DEMO_MODE", "true"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("keeps a versioned conceptual catalog separate from the three experimental rules", () => {
  expect(HALL_PROPOSALS.map((p) => p.id)).toEqual(["intocable", "primero-de-su-nombre", "monarca"]);
  expect(HALL_PROPOSALS.map((p) => p.category)).toEqual(["legendary", "pioneer", "permanent"]);
  expect(ACHIEVEMENTS.map((p) => p.code)).toEqual([
    "resurrection",
    "unstoppable",
    "otp-specialist",
  ]);
  for (const p of HALL_PROPOSALS)
    for (const field of [p.requirement, p.evidence, p.coverage, p.feasibility, p.infrastructure])
      expect(field.length).toBeGreaterThan(30);
  expect(HALL_PROPOSALS[0].requirement).toContain("15");
  expect(HALL_PROPOSALS[0].requirement).toContain("no aprobado");
});
it("uses separate fictional recognitions and preserves former holders rather than revoking history", () => {
  const data = readHallPreview("soloq");
  expect(data.recognitions).toHaveLength(3);
  expect(data.records).toHaveLength(2);
  expect(data.records.find((r) => r.to === null)?.playerId).toBe("demo-4");
  const former = data.records.find((r) => r.to !== null)!;
  expect(former.playerId).toBe("demo-5");
  expect(data.recognitions.some((r) => r.playerId === former.playerId)).toBe(true);
  for (const r of [...data.records, ...data.recognitions]) expect(r.source).toBe("fictional_hall");
  const pioneer = data.recognitions.find((r) => r.proposalId === "primero-de-su-nombre")!;
  expect(pioneer.playerId).not.toBe(data.records.find((r) => r.to === null)?.playerId);
});
it.each(["flex", "5v5"] as const)("does not mix SoloQ fixtures into %s", (view) => {
  const data = readHallPreview(view);
  expect(data.recognitions).toEqual([]);
  expect(data.records).toEqual([]);
  const html = renderToStaticMarkup(<HallOfFame view={view} />);
  expect(html).toContain("Sin acreditaciones de demostración");
  expect(html).not.toContain("data-source=");
});
it("has no real-mode data lookup or grants, even when the experimental flag is enabled", () => {
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("FORBIDDEN_NETWORK"));
  expect(readHallPreview("soloq").recognitions).toEqual([]);
  const html = renderToStaticMarkup(<HallOfFame view="soloq" />);
  expect(html).toContain("Todavía no hay acreditaciones disponibles");
  expect(html).not.toContain("Demo Marea");
  expect(html).not.toContain("data-source=");
  expect(html).toContain("Rareza real: todavía no disponible");
  expect(fetch).not.toHaveBeenCalled();
  expect(HallLegacyShowcase({ playerId: "demo-5", view: "soloq" })).toBeNull();
});
it("makes proposal requirements, dates and simulated evidence accessible without false rarity", () => {
  const html = renderToStaticMarkup(<HallOfFame view="soloq" />);
  expect(html).toContain("acreditación real todavía no disponible");
  expect(html).toContain("Ficticio · Demo");
  expect(html).toContain("Ningún reconocimiento se concede");
  expect(html.match(/data-proposal=/g)).toHaveLength(3);
  expect(html).not.toMatch(/<details[^>]* open/);
  expect(html).toContain("Ver propuesta y requisitos");
  expect(html).toContain("Ver evidencia simulada");
  expect(html).toContain("fecha exacta no establecida");
  expect(html).toContain("Antiguo poseedor simulado");
  expect(html).toContain("Poseedor vigente simulado");
  expect(html).toContain("Rareza: no calculada");
  expect(html).not.toContain("% de jugadores");
  expect(html).not.toMatch(/<button|<form|Equipar|Insignia desbloqueada/);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const label of [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]))
    expect(ids).toContain(label);
});
it("keeps the profile preview read-only, mode-scoped, date-labelled and linked to evidence", () => {
  const html = renderToStaticMarkup(<HallLegacyShowcase playerId="demo-5" view="soloq" />);
  expect(html).toContain("Legado personal");
  expect(html).toContain("El Intocable");
  expect(html).toContain("Acreditación simulada");
  expect(html).toContain("2026");
  expect(html).toContain("#reconocimiento-demo-legend-marea");
  expect(html).not.toMatch(/<form|<button|Equipar/);
  const empty = renderToStaticMarkup(<HallLegacyShowcase playerId="demo-8" view="soloq" />);
  expect(empty).toContain("No hay reconocimientos simulados");
  expect(empty).not.toContain("data-source=");
  expect(HallLegacyShowcase({ playerId: "demo-5", view: "5v5" })).toBeNull();
});
it("provides navigation between concepts, profiles and the preserved challenge catalog", async () => {
  const html = renderToStaticMarkup(
    await Page({ searchParams: Promise.resolve({ queue: "flex" }) }),
  );
  expect(html).toContain("/logros?queue=flex");
  expect(html).toContain("/salon-de-la-fama?queue=soloq");
  expect(html).toContain("Sin acreditaciones");
  const nav = renderToStaticMarkup(<HeaderNav />);
  expect(nav).toContain('href="/salon-de-la-fama"');
  expect(nav).toContain('aria-current="page"');
});
