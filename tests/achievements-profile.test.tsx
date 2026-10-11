import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlayerPage, { generateMetadata } from "@/app/player/[id]/page";
import {
  ProfileAchievements,
  ProfileAchievementsContent,
} from "@/components/achievements/profile-achievements";
import { PlayerSignatureSection } from "@/components/player-signature-section";
import { profileAchievementPresentation } from "@/server/achievements/profile";
import { demoPlayers } from "@/server/demo";
import { uiFixture, uiStateFixture } from "./achievements-ui-fixtures";
import type { View } from "@/lib/queues";
import { Header, Footer, DemoBanner } from "@/components/shell";
import styles from "@/components/achievements/achievements.module.css";
import type { PlayerProfile } from "@/lib/types";
import { emptyTotals } from "@/lib/stats";

const service = vi.hoisted(() => vi.fn());
const missing = vi.hoisted(() => ({ value: false }));
const profileChanges = vi.hoisted(() => ({ value: {} as Partial<PlayerProfile> }));
vi.mock("@/server/achievements/service", () => ({ readPlayerAchievements: service }));
vi.mock("@/server/queries", async () => {
  const { demoPlayers } = await import("@/server/demo");
  return {
    getProfile: async (id: string, view: View) => {
      const player = demoPlayers(view).find((p) => p.id === id);
      return missing.value || !player ? null : { ...player, ...profileChanges.value };
    },
  };
});
vi.mock("@/server/riot/assets", () => ({
  getAssets: async () => ({ version: null, champions: {} }),
  profileIconUrl: () => null,
}));
vi.mock("@/server/signature-baseline", () => ({ getSignatureBaseline: async () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/player/demo-1",
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
beforeEach(() => {
  service.mockReset();
  missing.value = false;
  profileChanges.value = {};
  vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", undefined);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("VERCEL_TARGET_ENV", undefined);
  vi.stubEnv("DEMO_MODE", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const props = {
  playerId: "demo-1",
  view: "soloq" as const,
  asOf: "2026-11-01T00:00:00Z",
  champions: {},
};
const pageProps = (view: View = "soloq", id = "demo-1") => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve({ queue: view }),
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
/** Resolve only known async RSCs; Vitest is not a Next streaming/browser test. */
async function resolvedPage(view: View) {
  const page = await PlayerPage(pageProps(view));
  const list = elements(page);
  // Exercise actual async data boundaries separately; JSX retains existing client components.
  for (const el of list.filter((e) => e.type === ProfileAchievements)) {
    expect(el.props.view).toBe(view);
  }
  return page;
}
describe("gated profile integration", () => {
  it.each(["soloq", "flex", "5v5"] as const)(
    "off profile %s keeps existing data and performs no achievements work",
    async (view) => {
      service.mockRejectedValue(new Error("must not run"));
      const page = await resolvedPage(view);
      expect(elements(page).some((e) => e.type === PlayerSignatureSection)).toBe(true);
      expect(ProfileAchievements({ ...props, view })).toBeNull();
      expect(await ProfileAchievementsContent({ ...props, view })).toBeNull();
      expect(await profileAchievementPresentation(props.playerId, view, props.asOf, {})).toBeNull();
      expect(service).not.toHaveBeenCalled();
      const labels = elements(page).filter((e) => typeof e.type === "string");
      expect(labels.some((e) => e.props.className === "profile-header")).toBe(true);
      expect(labels.some((e) => e.props.className === "profile-progression-grid")).toBe(true);
    },
  );
  it("metadata never runs the achievements service", async () => {
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    expect(await generateMetadata(pageProps())).toMatchObject({ title: "Demo Nebula#DEMO" });
    expect(service).not.toHaveBeenCalled();
  });
  it("Production with accidental true remains off", async () => {
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(ProfileAchievements(props)).toBeNull();
    expect(await ProfileAchievementsContent(props)).toBeNull();
    expect(service).not.toHaveBeenCalled();
  });
  it.each(["soloq", "flex"] as const)(
    "on %s renders real evaluated fictional signals with no grants",
    async (view) => {
      vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
      service.mockResolvedValue(await uiFixture(view));
      const panel = await ProfileAchievementsContent({ ...props, view });
      const html = renderToStaticMarkup(panel);
      expect(html).toContain("Señales competitivas · Experimental");
      expect(html).toContain("Datos ficticios");
      expect(html).toContain("Resurrección");
      expect(html).toContain("Racha observada de 5 victorias");
      expect(html).toContain("35 / 50");
      expect(html).not.toMatch(/obtenido oficialmente|desbloqueado|insignia permanente/);
      expect(service).toHaveBeenCalledWith(
        expect.objectContaining({ view, playerId: "11111111-1111-4111-8111-111111111111" }),
      );
      const wrapper = ProfileAchievements({ ...props, view });
      expect(wrapper?.type).toBe("details");
      expect(wrapper?.props.open).toBeUndefined();
    },
  );
  it("on 5v5 does no work or queue mixing", async () => {
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    expect(ProfileAchievements({ ...props, view: "5v5" })).toBeNull();
    expect(await ProfileAchievementsContent({ ...props, view: "5v5" })).toBeNull();
    expect(service).not.toHaveBeenCalled();
  });
  it("missing page does not mount experimental work", async () => {
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    missing.value = true;
    await expect(PlayerPage(pageProps())).rejects.toThrow("NOT_FOUND");
    expect(service).not.toHaveBeenCalled();
  });
  it("unknown Demo ID never consults the service", async () => {
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    expect(await ProfileAchievementsContent({ ...props, playerId: "demo-999" })).toBeNull();
    expect(service).not.toHaveBeenCalled();
  });
  it.each(["observed", "not_observed", "insufficient_evidence", "invalid_input"] as const)(
    "preserves %s without turning it into a grant",
    async (status) => {
      vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
      service.mockResolvedValue(await uiStateFixture(status));
      expect(renderToStaticMarkup(await ProfileAchievementsContent(props))).toContain(
        `data-status="${status}"`,
      );
    },
  );
  it("infrastructure unavailability is neutral and does not break the rest of the page", async () => {
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    service.mockResolvedValue({ status: "unavailable" });
    const html = renderToStaticMarkup(await ProfileAchievementsContent(props));
    expect(html).toContain("No se evaluaron logros");
    expect(html).not.toContain("No conseguido");
    expect(
      elements(await PlayerPage(pageProps())).some((e) => e.props.className === "profile-header"),
    ).toBe(true);
  });
  it("an unexpected boundary failure emits sanitized diagnostics and a neutral panel", async () => {
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    service.mockRejectedValue(new TypeError("private-token"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(await ProfileAchievementsContent(props));
    expect(html).toContain("No se evaluaron logros");
    expect(html).not.toContain("private-token");
    expect(log).toHaveBeenCalledWith("[achievements] presentation:unexpected");
  });
  it("the page returns essential JSX before an unsettled experimental read", async () => {
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    service.mockReturnValue(new Promise(() => {}));
    const page = await PlayerPage(pageProps());
    expect(elements(page).some((e) => e.props.className === "profile-header")).toBe(true);
    expect(service).not.toHaveBeenCalled(); // Work begins when Next renders the independent Suspense child.
  });
  it("URL, cookie and header inputs cannot enable server policy", async () => {
    const forged = {
      ...pageProps(),
      searchParams: Promise.resolve({ queue: "soloq", achievements: "true" }),
    };
    await PlayerPage(forged);
    expect(ProfileAchievements(props)).toBeNull();
    const source = readFileSync("src/server/achievements/feature.ts", "utf8");
    expect(source).not.toMatch(/cookies\(|headers\(|searchParams|process\.env\.NEXT_PUBLIC/);
    expect(service).not.toHaveBeenCalled();
  });
  it("does not alter public Demo fixtures or unrelated leaderboard/LP/signature consumers", async () => {
    const before = demoPlayers("soloq");
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    service.mockResolvedValue(await uiFixture());
    await ProfileAchievementsContent(props);
    // Fixture clock is request-specific; all ranked/match identities remain unchanged.
    expect(demoPlayers("soloq").map((p) => [p.id, p.rank, p.stats])).toEqual(
      before.map((p) => [p.id, p.rank, p.stats]),
    );
    for (const file of [
      "src/components/leaderboard.tsx",
      "src/app/page.tsx",
      "src/app/metrics/page.tsx",
    ])
      expect(readFileSync(file, "utf8")).not.toMatch(/achievements/);
  });
});

async function resolveRsc(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(Children.toArray(node).map(resolveRsc));
  if (!isValidElement<Record<string, unknown>>(node)) return node;
  if (node.type === PlayerSignatureSection)
    return resolveRsc(
      await PlayerSignatureSection(node.props as Parameters<typeof PlayerSignatureSection>[0]),
    );
  if (node.type === ProfileAchievements)
    return resolveRsc(ProfileAchievements(node.props as Parameters<typeof ProfileAchievements>[0]));
  if (node.type === ProfileAchievementsContent)
    return resolveRsc(
      await ProfileAchievementsContent(
        node.props as Parameters<typeof ProfileAchievementsContent>[0],
      ),
    );
  return "children" in node.props
    ? cloneElement(node, {}, await resolveRsc(node.props.children as ReactNode))
    : node;
}

it.each([
  "observed",
  "not_observed",
  "insufficient_evidence",
  "invalid_input",
  "unavailable",
  "mixed",
  "partial",
  "completed_unavailable",
  "unranked",
  "long_id",
  "empty",
  "large_pool",
  "soloq",
  "flex",
  "5v5",
  "demo",
] as const)(
  "renders the whole fictional profile with %s signals (optional local visual export)",
  async (state) => {
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
    const view = state === "flex" ? "flex" : state === "5v5" ? "5v5" : "soloq";
    const status = ["not_observed", "insufficient_evidence", "invalid_input"].includes(state)
      ? (state as "not_observed" | "insufficient_evidence" | "invalid_input")
      : state === "empty" || state === "unranked"
        ? "insufficient_evidence"
        : "observed";
    const fixture =
      state === "unavailable"
        ? { status: "unavailable" as const }
        : await uiStateFixture(status, view === "flex" ? "flex" : "soloq");
    if (fixture.status === "available") {
      if (state === "mixed") {
        const uncertain = await uiStateFixture("insufficient_evidence");
        if (uncertain.status !== "available") throw new Error("fixture");
        fixture.evaluations = [fixture.evaluations[0], ...uncertain.evaluations.slice(1)];
      }
      if (state === "completed_unavailable") fixture.coverage.historyStatus = "completed";
    }
    if (state === "unranked")
      profileChanges.value = { rank: null, history: [], lpObservations: [], momentum: null };
    if (state === "long_id")
      profileChanges.value = {
        gameName: "DemoIdentidadCompetitivaDePruebaMuyLarga",
        tagLine: "DEMO-LARGO",
      };
    if (state === "empty")
      profileChanges.value = {
        rank: null,
        stats: emptyTotals(),
        champions: [],
        recent: [],
        history: [],
        lpObservations: [],
        performance: [],
        momentum: null,
      };
    if (state === "large_pool") {
      const champion = demoPlayers("soloq")[0].champions[0];
      profileChanges.value = {
        champions: Array.from({ length: 50 }, (_, i) => ({
          ...champion,
          championId: i + 1,
          champion: `Campeón ficticio de nombre largo ${i + 1}`,
        })),
      };
    }
    service.mockResolvedValue(fixture);
    const markup = renderToStaticMarkup(
      <>
        <Header />
        <DemoBanner />
        <main id="content" className="container main-content">
          {await resolveRsc(await PlayerPage(pageProps(view)))}
        </main>
        <Footer />
      </>,
    );
    expect(markup).toContain(state === "long_id" ? "DemoIdentidadCompetitiva" : "Demo Nebula");
    expect(markup).toContain("Rendimiento de temporada");
    expect(markup).toContain("Últimas partidas");
    expect(markup).toContain("Firma competitiva");
    if (view === "5v5") {
      expect(markup).not.toContain("Señales competitivas");
      expect(service).not.toHaveBeenCalled();
    } else {
      expect(markup).toContain(
        state === "unavailable" ? "No se evaluaron logros" : `data-status="${status}"`,
      );
      expect(markup).toContain("Jugadores, partidas, rangos y LP ficticios");
      if (fixture.status === "available") expect(markup).toContain("Datos ficticios");
      expect(markup).not.toMatch(
        /No conseguido|No cumple|OTP certificado|Logros obtenidos|Mis logros desbloqueados/,
      );
      if (fixture.status === "available") {
        expect(
          fixture.evaluations.every(
            (e) => e.grantAuthorized === false && e.certification === "not_established",
          ),
        ).toBe(true);
        if (state === "mixed")
          expect(fixture.evaluations.map((e) => e.status)).toEqual([
            "observed",
            "insufficient_evidence",
            "insufficient_evidence",
          ]);
      }
      if (state === "completed_unavailable") expect(markup).toContain("muestra parcial");
    }
    const target = process.env.ACHIEVEMENT_VISUAL_DIR;
    if (!target) return;
    mkdirSync(target, { recursive: true });
    let css = readFileSync("src/components/achievements/achievements.module.css", "utf8");
    const classes = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    for (const key of classes)
      css = css.replace(new RegExp(`\\.${key}(?![\\w-])`, "g"), `.${styles[key]}`);
    const globals = readFileSync(
      process.env.ACHIEVEMENT_VISUAL_CSS ?? "src/app/globals.css",
      "utf8",
    ).replace(/^@import[^;]*;/gm, "");
    // Own static fixture, not an application route. Relative assets resolve to the local Demo server.
    const reset = `*{box-sizing:border-box}body{margin:0;--font-body:Arial,sans-serif;--font-display:Arial,sans-serif}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`;
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="http://127.0.0.1:3011/"><title>SoloQ QA ficticio · ${state}</title><style>${reset}\n${globals}\n${css}</style></head><body>${markup}</body></html>`;
    writeFileSync(join(target, `profile-${state}.html`), html);
    if (existsSync("node_modules/axe-core/axe.min.js")) {
      writeFileSync(join(target, "axe.min.js"), readFileSync("node_modules/axe-core/axe.min.js"));
      writeFileSync(
        join(target, `profile-${state}-axe.html`),
        html
          .replace("</head>", '<script src="http://127.0.0.1:4179/axe.min.js"></script></head>')
          .replace(
            "</body>",
            `<pre id="qa-audit" style="white-space:pre-wrap;overflow-wrap:anywhere">Evaluando…</pre><script>let busy=false,pending=false;async function audit(){if(busy){pending=true;return}busy=true;try{const r=await axe.run(document.querySelector('main'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});document.getElementById('qa-audit').textContent=JSON.stringify({violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})),passes:r.passes.length,incomplete:r.incomplete.map(v=>v.id)})}finally{busy=false;if(pending){pending=false;audit()}}}document.addEventListener('toggle',audit,true);audit()</script></body>`,
          ),
      );
    }
  },
);
