import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlayerPage from "@/app/player/[id]/page";
import { DisclosureLabel } from "@/components/disclosure";
import { InfoTip, viewportShift } from "@/components/info-tip";
import { MatchHistory } from "@/components/match-history";
import { ProfileAchievements } from "@/components/achievements/profile-achievements";
import { demoPlayers } from "@/server/demo";
import { kda, winrate } from "@/lib/stats";
import { rankLabel } from "@/lib/ranking";
import { signedLp } from "@/lib/lp-metrics";
import { HIGHLIGHT_MIN_GAMES } from "@/lib/global-metrics";
import type { View } from "@/lib/queues";
import type { PlayerProfile } from "@/lib/types";

// One lazily built fixture snapshot per queue: expected and rendered values share the same objects.
const fixtures = vi.hoisted(() => ({
  players: {} as Record<string, PlayerProfile[]>,
  load: (view: string): PlayerProfile[] => {
    throw new Error(`fixtures not ready: ${view}`);
  },
}));
vi.mock("@/server/queries", () => ({
  getProfile: async (id: string, view: string) =>
    fixtures.load(view).find((p) => p.id === id) ?? null,
}));
vi.mock("@/server/riot/assets", () => ({
  getAssets: async () => ({ version: null, champions: {} }),
  profileIconUrl: () => null,
}));
vi.mock("@/components/player-signature-section", () => ({
  PlayerSignatureSection: () => <p>firma-cargada</p>,
  PlayerSignatureSkeleton: () => null,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/player/demo-1",
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

fixtures.load = (view) => (fixtures.players[view] ??= demoPlayers(view as View));
beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", undefined);
});
afterEach(() => vi.unstubAllEnvs());

const player = (view: View, id: string) => fixtures.load(view).find((p) => p.id === id)!;
async function render(view: View, id = "demo-1") {
  const page = await PlayerPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({ queue: view }),
  });
  return { page, html: renderToStaticMarkup(page) };
}
/** The redesigned upper area only: everything before rank progression. */
const overview = (html: string) =>
  html.slice(html.indexOf('class="profile-bento'), html.indexOf('class="profile-progression-grid'));
const summaries = (html: string) =>
  [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => m[1]);
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

describe("profile overview keeps every previously visible datum", () => {
  // Ranked Challenger, Flex, unranked without history, single-game sample, 5v5 record.
  it.each([
    ["soloq", "demo-1"],
    ["flex", "demo-1"],
    ["soloq", "demo-8"],
    ["soloq", "demo-11"],
    ["5v5", "demo-1"],
  ] as const)("%s %s", async (view, id) => {
    const p = player(view, id);
    const top = overview((await render(view, id)).html);
    const official = view !== "5v5" && !!p.rank;
    const record = official && p.rank ? p.rank : p.stats;
    const games = record.wins + record.losses;
    expect(top).toContain(`${record.wins} V`);
    expect(top).toContain(`${record.losses} D`);
    expect(top).toContain(games ? `${winrate(record.wins, record.losses).toFixed(1)}%` : "—");
    expect(top).toContain(
      `${games} partidas ${official ? "en el estado ranked actual" : "importadas"}`,
    );
    const { stats } = p;
    expect(top).toContain(
      stats.games ? kda(stats.kills, stats.deaths, stats.assists).toFixed(2) : "—",
    );
    if (stats.duration) expect(top).toContain((stats.cs / (stats.duration / 60)).toFixed(1));
    if (stats.games)
      expect(top).toContain(Math.round(stats.damage / stats.games).toLocaleString("es-CL"));
    expect(top).toContain(`PARTIDAS IMPORTADAS</span><strong>${stats.games}</strong>`);
    // Full pool, including champions behind the "Ver pool completo" disclosure.
    for (const c of p.champions) {
      expect(top).toContain(`${c.wins} V / ${c.losses} D`);
      if (c.games >= HIGHLIGHT_MIN_GAMES)
        expect(top).toContain(`${winrate(c.wins, c.losses).toFixed(0)}%`);
    }
    if (p.champions.length > 3)
      expect(top).toContain(`Ver pool completo (${p.champions.length} campeones)`);
    if (!p.champions.length) expect(top).toContain("Aún no hay partidas importadas");
    expect(top).toContain("Winrate por campeón desde");
    expect(top).toContain("Historial ficticio de demo");
    if (view !== "5v5") {
      expect(top).toContain("RANGO ACTUAL");
      expect(top).toContain(rankLabel(p.rank));
      if (p.rank && p.rank.tier !== "UNRANKED")
        expect(top).toContain(`<strong>${p.rank.leaguePoints.toLocaleString("es-CL")}</strong>`);
      if (p.momentum?.net != null) expect(top).toContain(`${signedLp(p.momentum.net)} LP`);
      else expect(top).toContain("Sin tendencia");
    }
  });

  it("5v5 shows no nonexistent rank or LP", async () => {
    const top = overview((await render("5v5")).html);
    expect(top).toContain("REGISTRO 5V5");
    expect(top).toContain("Sin rango propio");
    expect(top).not.toContain("RANGO ACTUAL");
    expect(top).not.toContain("lp-display");
    expect(top).not.toContain("ΔLP observado");
  });

  it("keeps official ranked counters and imported statistics labelled apart", async () => {
    const top = overview((await render("soloq")).html);
    expect(top).toMatch(/REGISTRO RANKED<\/h2><span class="bento-tag">FICTICIO/);
    expect(top).toMatch(/COMBATE<\/h2><span class="bento-tag">HISTORIAL FICTICIO/);
    expect(top).toMatch(/POOL DE CAMPEONES<\/h2><span class="bento-tag">HISTORIAL FICTICIO/);
    const unranked = overview((await render("soloq", "demo-8")).html);
    expect(unranked).toContain("REGISTRO IMPORTADO");
    expect(unranked).not.toContain("REGISTRO RANKED");
  });
});

describe("profile structure and semantics", () => {
  it.each(["soloq", "flex", "5v5"] as const)(
    "%s blocks are labelled sections in mobile reading order",
    async (view) => {
      const top = overview((await render(view)).html);
      const order = [
        ...(view === "5v5" ? [] : ["RANGO ACTUAL"]),
        view === "5v5" ? "REGISTRO 5V5" : "REGISTRO RANKED",
        "FORMA RECIENTE",
        "COMBATE",
        "POOL DE CAMPEONES",
        "Firma competitiva",
      ];
      const positions = order.map((label) => top.indexOf(label));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect((top.match(/<section class="bento-block[^"]*" aria-label="/g) ?? []).length).toBe(
        order.length - 1,
      );
    },
  );

  it("every disclosure is native, closed by default and free of nested controls", async () => {
    const { html } = await render("soloq");
    const labels = summaries(html);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    for (const label of labels) expect(label).not.toMatch(/<a |<button|<input|<select|<details/);
    expect(html).not.toMatch(/<details[^>]* open=""/);
    expect(html).not.toMatch(/<summary[^>]*aria-expanded/);
    expect(labels.some((label) => label.includes("Firma competitiva"))).toBe(true);
    expect(labels.some((label) => label.includes("Cambios de LP entre registros"))).toBe(true);
    expect(html).toContain("firma-cargada"); // Signature still streams into its disclosure.
  });

  it("5v5 keeps the signature but has no LP-interval disclosure", async () => {
    const labels = summaries((await render("5v5")).html);
    expect(labels.some((label) => label.includes("Firma competitiva"))).toBe(true);
    expect(labels.some((label) => label.includes("Cambios de LP"))).toBe(false);
  });

  it("section disclosures expose a visible state affordance hidden from assistive tech", () => {
    const html = renderToStaticMarkup(
      <DisclosureLabel title="Señales competitivas" badge="Experimental" hint="Evidencia" />,
    );
    expect(html).toContain("<strong>Señales competitivas <span");
    expect(html).toContain('<span class="disclosure-toggle" aria-hidden="true">');
    expect(html).toContain("Mostrar");
    expect(html).toContain("Ocultar");
    expect(html).toContain('<span class="disclosure-hint">Evidencia</span>');
  });
});

describe("experimental signals respect the server flag inside the new layout", () => {
  const props = { playerId: "demo-1", asOf: "2026-11-01T00:00:00Z", champions: {} };
  it("off: no block and no empty slot in the overview", async () => {
    const { page, html } = await render("soloq");
    expect(html).not.toContain("Señales competitivas");
    expect(ProfileAchievements({ ...props, view: "soloq" })).toBeNull();
    // The element stays in the bento but renders nothing, so the grid has no placeholder.
    const bento = elements(page).find((e) => String(e.props.className).startsWith("profile-bento"));
    expect(elements(bento).some((e) => e.type === ProfileAchievements)).toBe(true);
  });
  it.each(["soloq", "flex"] as const)("on (%s): one closed section disclosure", (view) => {
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    vi.stubEnv("NODE_ENV", "development");
    const wrapper = ProfileAchievements({ ...props, view });
    expect(wrapper?.type).toBe("details");
    expect(String(wrapper?.props.className)).toContain("disclosure-block");
    expect(wrapper?.props.open).toBeUndefined();
    const summary = renderToStaticMarkup(
      elements(wrapper).find((element) => element.type === "summary"),
    );
    expect(summary).toContain("Señales competitivas");
    expect(summary).toContain("Experimental");
    expect(summary).toContain("Observaciones y evidencia");
    expect(summary).not.toMatch(/<a |<button|<input|<select/);
  });
  it("on: still absent in 5v5", () => {
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(ProfileAchievements({ ...props, view: "5v5" })).toBeNull();
  });
});

describe("contextual help", () => {
  it("names the icon trigger and links it to a hidden status bubble", () => {
    const html = renderToStaticMarkup(<InfoTip label="Cómo se calcula: KDA">Texto</InfoTip>);
    const id = html.match(/aria-controls="([^"]+)"/)![1];
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Cómo se calcula: KDA"');
    expect(html).toContain(`role="status" id="${id}"`);
    expect(html).toMatch(/class="info-tip-bubble"[^>]*hidden=""/);
  });
  it("a term trigger is named by its visible text", () => {
    const html = renderToStaticMarkup(<InfoTip term="LP">Texto</InfoTip>);
    expect(html).not.toContain("aria-label");
    expect(html).toMatch(/<button[^>]*>LP<\/button>/);
  });
  it.each([
    [20, 300, 390, 0],
    [-40, 240, 390, -(-40) + 8],
    [200, 470, 390, 390 - 8 - 470],
    [-10, 400, 390, 18],
  ])("keeps a bubble at %i..%i inside a %ipx viewport", (left, right, viewport, shift) => {
    expect(viewportShift(left, right, viewport)).toBe(shift);
    const moved = [left + shift, right + shift];
    if (right - left <= viewport - 16) {
      expect(moved[0]).toBeGreaterThanOrEqual(8);
      expect(moved[1]).toBeLessThanOrEqual(viewport - 8);
    }
  });
});

describe("match history actions", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => <article key={i}>Partida {i}</article>);
  it("the expand action is a bounded button wired to the list", () => {
    const html = renderToStaticMarkup(<MatchHistory rows={rows(12)} />);
    const list = html.match(/<div id="([^"]+)"><article>/)![1];
    const escaped = list.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(html).toMatch(
      new RegExp(
        `<button type="button" class="button secondary match-history-toggle" aria-expanded="false" aria-controls="${escaped}">Ver más partidas<svg[^>]*aria-hidden="true"`,
      ),
    );
    expect(html).not.toContain("Páginas del historial"); // Pagination appears only when expanded.
    expect((html.match(/<article>/g) ?? []).length).toBe(5);
  });
  it("short histories show no expand action", () => {
    expect(renderToStaticMarkup(<MatchHistory rows={rows(5)} />)).not.toContain("<button");
  });
});

describe("control tokens", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)![1];
  const tokens = Object.fromEntries(
    [...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
  const resolve = (name: string): string => {
    const value = tokens[name];
    const reference = value.match(/^var\(--([\w-]+)\)$/);
    return reference ? resolve(reference[1]) : value;
  };
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [x, y] = [luminance(resolve(a)), luminance(resolve(b))];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const surfaces = ["bg", "surface", "surface-alt", "surface-2", "surface-raised"];
  it.each(surfaces)("control boundaries and icons stay visible on --%s", (surface) => {
    expect(contrast("control-border", surface)).toBeGreaterThanOrEqual(3);
    expect(contrast("control-icon", surface)).toBeGreaterThanOrEqual(3);
    expect(contrast("muted", surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("text", surface)).toBeGreaterThanOrEqual(4.5);
  });
  it("control backgrounds keep text readable and targets keep their minimum", () => {
    for (const background of ["control-bg", "control-bg-hover"]) {
      expect(contrast("text", background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast("control-border", background)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast("accent-ink", "accent")).toBeGreaterThanOrEqual(4.5);
    expect(parseInt(resolve("target-min"))).toBeGreaterThanOrEqual(44);
    expect(parseInt(resolve("target-floor"))).toBeGreaterThanOrEqual(24);
  });
});
