import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import postgres from "postgres";
import { db } from "@/db";
import { getLeaderboard, getProfile } from "@/server/queries";
import { getSeasonOverview } from "@/server/season-queries";
import { getSignatureBaseline } from "@/server/signature-baseline";
import { computeAwards } from "@/lib/awards";
import { globalMetrics } from "@/lib/global-metrics";
import { rankTrajectory } from "@/lib/rank-trajectory";
import { VIEWS } from "@/lib/queues";
import { DemoBanner, Footer } from "@/components/shell";
import { RankChart } from "@/components/rank-chart";
import { LpDeltaSummary } from "@/components/lp-delta-summary";
import { MatchHistory } from "@/components/match-history";
import { HistoryStatusLabel } from "@/components/history-status";
import AdminPage from "@/app/admin/page";
import PlayerPage, { generateMetadata as profileMetadata } from "@/app/player/[id]/page";
import Privacy from "@/app/privacy/page";
import Terms from "@/app/terms/page";
import { GET as listPlayers, POST as addPlayer } from "@/app/api/admin/players/route";
import { POST as login } from "@/app/api/admin/login/route";
import { POST as logout } from "@/app/api/admin/logout/route";
import { PATCH, DELETE } from "@/app/api/admin/players/[id]/route";
import { POST as sync } from "@/app/api/admin/sync/route";
import { POST as singleSync } from "@/app/api/admin/players/[id]/sync/route";
import { POST as backfill } from "@/app/api/admin/players/[id]/backfill/route";
import { GET as cron } from "@/app/api/cron/sync/route";
import { GET as status } from "@/app/api/ladder/sync-status/route";
import { GET as progress } from "@/app/api/admin/sync/progress/route";
import { readSyncProgress } from "@/server/sync/progress";
import { withSyncLease } from "@/server/sync/lease";
import { syncPlayer, syncBackfillPlayer, syncAllPlayers } from "@/server/sync/service";
import { authenticated, allowLogin, createSession, destroySession } from "@/server/auth";
import { RiotClient } from "@/server/riot/client";

const cacheCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock("postgres", () => ({
  default: vi.fn(() => {
    throw new Error("FORBIDDEN_POSTGRES");
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "a".repeat(64) }), set: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      cacheCalls.push(args);
      return fn(...args);
    },
}));

const secretNames = [
  "DATABASE_URL",
  "RIOT_API_KEY",
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "CRON_SECRET",
];
const staticFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (!url.startsWith("https://ddragon.leagueoflegends.com/"))
    throw new Error("FORBIDDEN_AUTHENTICATED_RIOT");
  return Response.json(url.endsWith("versions.json") ? ["26.1.1"] : { data: {} });
});
beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("APP_URL", "http://localhost");
  for (const key of secretNames) vi.stubEnv(key, undefined);
  vi.stubGlobal("fetch", staticFetch);
  vi.clearAllMocks();
  cacheCalls.length = 0;
});
afterEach(() => {
  expect(postgres).not.toHaveBeenCalled();
  expect(
    staticFetch.mock.calls.every(([input]) =>
      String(input).startsWith("https://ddragon.leagueoflegends.com/"),
    ),
  ).toBe(true);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Production Demo without credentials or PostgreSQL", () => {
  it.each(VIEWS)(
    "serves leaderboard, profiles, graphs and awards for %s exclusively from fixtures",
    async (view) => {
      const players = await getLeaderboard(view);
      expect(players).toHaveLength(12);
      for (const player of players) {
        expect(player.id).toMatch(/^demo-/);
        expect(player.gameName).toMatch(/^Demo /);
        const profile = await getProfile(player.id, view);
        expect(profile?.id).toBe(player.id);
        expect(profile?.recent.length).toBeLessThanOrEqual(40);
        expect(profile).not.toHaveProperty("puuid");
      }
      const profile = await getProfile(players[0].id, view);
      if (view !== "5v5") expect(rankTrajectory(profile!.history).length).toBeGreaterThan(0);
      else expect(profile?.rank).toBeNull();
      const overview = await getSeasonOverview(view, "season");
      expect(overview.activity.length).toBeGreaterThan(0);
      expect(overview.awardStats.length).toBe(players.length);
      expect(
        computeAwards(players, view, overview.awardStats, overview.lpIntervals).honor.length,
      ).toBeGreaterThan(0);
      await expect(getSignatureBaseline(view)).resolves.not.toBeNull();
      expect(cacheCalls.some((args) => args[0] === view && args[1] === "demo")).toBe(true);
    },
  );

  it.each(["season", "30d", "7d"] as const)(
    "supports all queue metrics in period %s without a database",
    async (period) => {
      for (const view of VIEWS) {
        const players = await getLeaderboard(view, period);
        const overview = await getSeasonOverview(view, period);
        expect(globalMetrics(players, view, "matches").participants).toBe(12);
        expect(players.reduce((sum, p) => sum + p.stats.games, 0)).toBeGreaterThan(0);
        expect(overview.uniqueGames).toBeGreaterThan(0);
        expect(overview.activity.length).toBeGreaterThan(0);
      }
    },
  );

  it("returns missing or malformed profiles without touching PostgreSQL", async () => {
    for (const id of ["missing", "123e4567-e89b-42d3-a456-426614174000", "../invalid"]) {
      await expect(getProfile(id, "soloq")).resolves.toBeNull();
      await expect(
        PlayerPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }),
      ).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("renders the honest demo banner, metadata, disabled admin, privacy, terms and disclaimer", async () => {
    expect(renderToStaticMarkup(<DemoBanner />)).toMatch(/rangos y LP ficticios/);
    expect(renderToStaticMarkup(<Footer />)).toMatch(/isn.*endorsed by Riot Games/);
    const admin = renderToStaticMarkup(await AdminPage());
    expect(admin).toContain("disabled");
    expect(admin).toMatch(/modo demo/);
    const metadata = await profileMetadata({
      params: Promise.resolve({ id: "demo-1" }),
      searchParams: Promise.resolve({}),
    });
    expect(metadata.description).toMatch(/ficticio/);
    const privacy = renderToStaticMarkup(<Privacy />);
    const terms = renderToStaticMarkup(<Terms />);
    expect(privacy).toMatch(/únicamente.*ficticios/);
    expect(privacy).toMatch(/revisión de alojamiento, conservación y jurisdicción/);
    expect(privacy).not.toMatch(/Guardamos Riot ID/);
    expect(terms).toMatch(/No son observaciones oficiales/);
    expect(terms).not.toMatch(/rango mostrado procede de Riot/);
  });

  it.each(["true", "false"])(
    "publishes the authorized contact and preserves legal and mode distinctions with DEMO_MODE=%s",
    (mode) => {
      vi.stubEnv("DEMO_MODE", mode);
      const privacy = renderToStaticMarkup(<Privacy />);
      const terms = renderToStaticMarkup(<Terms />);
      const footer = renderToStaticMarkup(<Footer />);
      for (const markup of [privacy, terms, footer]) {
        expect(markup).toContain("Yuusha1");
        expect(markup).toContain('href="mailto:drg1212yt@gmail.com"');
        expect(markup).not.toMatch(/contacto.*pendientes de publicación/);
      }
      for (const markup of [privacy, terms]) {
        expect(markup).toContain(
          "no sustituye la identidad legal del responsable cuando sea exigible",
        );
        expect(markup).toMatch(/pendientes/);
      }
      expect(terms).toContain("No se afirma que esos pasos estén");
      expect(terms).toContain("Riot Developer Portal");
      expect(footer).toMatch(/isn.*endorsed by Riot Games/);
      if (mode === "true") {
        expect(privacy).toMatch(/únicamente.*ficticios/);
        expect(privacy).not.toContain("Guardamos Riot ID");
        expect(terms).toContain("No son observaciones oficiales");
      } else {
        expect(privacy).toContain("Guardamos Riot ID");
        expect(privacy).toContain("cookie de sesión HttpOnly");
        expect(terms).toContain("mostrado procede de Riot");
        expect(terms).not.toContain("No son observaciones oficiales");
      }
    },
  );

  it("labels synthetic LP records instead of presenting demo snapshots as official Riot data", async () => {
    const profile = (await getProfile("demo-1", "soloq"))!;
    const chart = renderToStaticMarkup(<RankChart history={profile.history} demo />);
    const deltas = renderToStaticMarkup(
      <LpDeltaSummary observations={profile.lpObservations} demo />,
    );
    expect(chart).toMatch(/Rango ficticio/);
    expect(chart).toMatch(/snapshots ficticios de demo/);
    expect(chart).not.toMatch(/Rango oficial|snapshots oficiales/);
    expect(deltas).toMatch(/REGISTROS FICTICIOS/);
    expect(deltas).not.toMatch(/REGISTROS REALES|contadores oficiales/);
    const history = renderToStaticMarkup(<MatchHistory rows={[]} demo />);
    expect(history).toMatch(/contadores ranked son ficticios/);
    expect(history).toMatch(/fixture no contiene partidas/);
    expect(history).not.toMatch(/oficiales de Riot|después de sincronizar/);
    const coverage = renderToStaticMarkup(
      <HistoryStatusLabel history={profile.seasonHistory} demo />,
    );
    expect(coverage).toMatch(/estados de importación son simulados/);
    expect(coverage).not.toMatch(/Cobertura disponible en Riot|próximas actualizaciones/);
  });

  it.each([login, logout, addPlayer, PATCH, DELETE, sync, singleSync, backfill])(
    "blocks admin mutations with residual cookies and invalid input before secrets, SQL or Riot",
    async (handler) => {
      for (const origin of ["http://localhost", "https://evil.example"]) {
        const response = await handler(
          new Request("http://localhost/api/admin/players/invalid/sync", {
            method: "POST",
            headers: {
              origin,
              "content-type": "application/json",
              cookie: `soloq_admin=${"a".repeat(64)}`,
            },
            body: "invalid-json",
          }),
        );
        expect(response.status).toBe(origin === "http://localhost" ? 503 : 403);
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
      expect(staticFetch).not.toHaveBeenCalled();
    },
  );

  it("rejects administrative reads even with a valid-looking residual session", async () => {
    expect(await authenticated()).toBe(false);
    expect((await listPlayers(new Request("http://localhost/api/admin/players"))).status).toBe(503);
    const response = await progress(new Request("http://localhost/api/admin/sync/progress"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(readSyncProgress()).rejects.toThrow(/deshabilitado/);
  });

  it("makes residual cron calls harmless without CRON_SECRET or authorization", async () => {
    for (const authorization of ["", "Bearer residual-token"]) {
      const response = await cron(
        new Request("http://localhost/api/cron/sync", { headers: { authorization } }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ skipped: true, reason: "demo" });
    }
    expect(staticFetch).not.toHaveBeenCalled();
  });

  it("serves uncached sync status without secrets or a database", async () => {
    const response = await status(new Request("http://localhost/api/ladder/sync-status"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      status: "never",
      lastSuccessfulSyncAt: null,
      schedulerConfigured: false,
    });
  });

  it("fails closed for direct database, sync service and session calls", async () => {
    expect(() => db()).toThrow(/deshabilitado/);
    await expect(withSyncLease(async () => true)).rejects.toThrow(/deshabilitada/);
    await expect(syncAllPlayers()).rejects.toThrow(/deshabilitada/);
    await expect(syncPlayer("invalid", new RiotClient())).rejects.toThrow(/deshabilitado/);
    await expect(syncBackfillPlayer("invalid", new RiotClient())).rejects.toThrow(/deshabilitado/);
    await expect(allowLogin()).rejects.toThrow(/deshabilitado/);
    await expect(createSession()).rejects.toThrow(/deshabilitado/);
    await expect(destroySession()).rejects.toThrow(/deshabilitado/);
  });

  it("blocks authenticated Riot calls even if credentials are accidentally configured", async () => {
    vi.stubEnv("RIOT_API_KEY", "dummy-must-not-be-used");
    vi.stubEnv("DATABASE_URL", "postgres://dummy:dummy@invalid/unused");
    expect(() => db()).toThrow(/deshabilitado/);
    const client = new RiotClient();
    const operations = [
      client.identity("LA2", "fixture"),
      client.account("LA2", "fixture", "DEMO"),
      client.summoner("LA2", "fixture"),
      client.leagues("LA2", "fixture"),
      client.matchIds("LA2", "fixture", 0, 1, 0),
      client.match("LA2", "DEMO_1"),
    ];
    for (const operation of operations) await expect(operation).rejects.toThrow(/deshabilitadas/);
    expect(staticFetch).not.toHaveBeenCalled();
  });
});
