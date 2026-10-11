import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observedOtp, OtpHighlight } from "@/components/achievements/otp-highlight";
import {
  ProfileAchievementsContent,
  ProfileOtpHighlight,
  ProfileOtpHighlightContent,
} from "@/components/achievements/profile-achievements";
import { RecentChampionForm } from "@/components/recent-champion-form";
import { PlayerMomentum } from "@/components/player-momentum";
import { MatchHistory } from "@/components/match-history";
import { RecordBlock } from "@/components/profile-overview";
import { achievementPresentation } from "@/server/achievements/presentation";
import { profileAchievementLoader } from "@/server/achievements/profile";
import { countLabel } from "@/lib/format";
import { summarizeLp, type RankSnapshot } from "@/lib/lp-metrics";
import { emptyTotals } from "@/lib/stats";
import type { PlayerProfile } from "@/lib/types";
import { uiFixture, uiPresentation, uiStateFixture } from "./achievements-ui-fixtures";

const service = vi.hoisted(() => vi.fn());
vi.mock("@/server/achievements/service", () => ({ readPlayerAchievements: service }));

beforeEach(() => {
  service.mockReset();
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", undefined);
  vi.stubEnv("NODE_ENV", "development");
  for (const name of ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV"]) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());

const enable = () => vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
const catalog = { "157": { name: "Yasuo", image: "/champ-icons/157.png" } };
const props = { playerId: "demo-1", asOf: "2026-11-01T00:00:00Z", champions: catalog };

describe("OTP badge comes only from the existing observed evaluation", () => {
  it("exposes the evaluator's own figures for an observed OTP", async () => {
    const result = await uiFixture();
    if (result.status !== "available") throw new Error("fixture");
    const evaluation = result.evaluations.find((e) => e.code === "otp-specialist")!;
    expect(evaluation.status).toBe("observed");
    const evidence = evaluation.evidence as {
      championId: number;
      championGames: number;
      validGames: number;
    };
    const otp = observedOtp(uiPresentation(result));
    expect(otp).toEqual({
      championId: evidence.championId,
      champion: "Yasuo",
      games: evidence.championGames,
      sample: evidence.validGames,
      share: "70",
    });
    // The badge repeats the panel measurement, it does not compute a second figure.
    const panel = uiPresentation(result);
    if (panel.status !== "available") throw new Error("fixture");
    expect(panel.items.find((i) => i.code === "otp-specialist")!.measurement).toBe(
      "Yasuo · 35 / 50 partidas · 70 % de la muestra importada",
    );
  });

  it.each(["not_observed", "insufficient_evidence", "invalid_input"] as const)(
    "shows nothing when OTP is %s",
    async (status) => {
      const presentation = uiPresentation(await uiStateFixture(status));
      if (presentation.status !== "available") throw new Error("fixture");
      expect(presentation.items.find((i) => i.code === "otp-specialist")!.status).toBe(status);
      expect(observedOtp(presentation)).toBeNull();
    },
  );

  it("shows nothing for unavailable or absent presentations", () => {
    expect(observedOtp(achievementPresentation({ status: "unavailable" }))).toBeNull();
    expect(observedOtp(null)).toBeNull();
  });

  it("renders identity, exact figures and provisional provenance", () => {
    const html = renderToStaticMarkup(
      <OtpHighlight
        otp={{ championId: 107, champion: "Rengar", games: 59, sample: 71, share: "83,1" }}
        champions={{}}
        demo={false}
      />,
    );
    expect(html).toContain('aria-label="Especialización observada: OTP de Rengar"');
    expect(html).toContain(">OTP</span> Rengar");
    expect(html).toContain("<strong>59</strong> de 71 partidas importadas");
    expect(html).toContain("<strong>83,1 %</strong> de la muestra");
    expect(html).toContain("no certificación");
    expect(html).toContain("muestra importada");
    expect(html).not.toMatch(/certificado|desbloqueado|título|solo sabe/i);
  });

  it("falls back to initials when the champion icon is unavailable", () => {
    const html = renderToStaticMarkup(
      <OtpHighlight
        otp={{
          championId: 999999,
          champion: "Campeón #999999",
          games: 40,
          sample: 50,
          share: "80",
        }}
        champions={{}}
        demo
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("CA");
    expect(html).toContain("ficticia de demo");
  });
});

describe("OTP respects the experimental flag and shares one evaluation", () => {
  it.each(["soloq", "flex", "5v5"] as const)("flag off (%s): no badge, no work", (view) => {
    const load = profileAchievementLoader("demo-1", view, props.asOf, {});
    expect(ProfileOtpHighlight({ view, load, champions: {} })).toBeNull();
    expect(service).not.toHaveBeenCalled();
  });

  it("flag on: no badge in 5v5", () => {
    enable();
    const load = profileAchievementLoader("demo-1", "5v5", props.asOf, {});
    expect(ProfileOtpHighlight({ view: "5v5", load, champions: {} })).toBeNull();
    expect(service).not.toHaveBeenCalled();
  });

  it("flag on: the badge and the signals panel read a single evaluation", async () => {
    enable();
    service.mockResolvedValue(await uiFixture());
    const load = profileAchievementLoader("demo-1", "soloq", props.asOf, catalog);
    expect(service).not.toHaveBeenCalled(); // Lazy until a consumer renders.
    const badge = renderToStaticMarkup(
      await ProfileOtpHighlightContent({ load, champions: catalog }),
    );
    const panel = renderToStaticMarkup(
      await ProfileAchievementsContent({ ...props, view: "soloq", load }),
    );
    expect(service).toHaveBeenCalledTimes(1);
    expect(badge).toContain("OTP</span> Yasuo");
    expect(panel).toContain("OTP · muestra importada");
    expect(panel).toContain("35 / 50 partidas");
  });

  it.each(["not_observed", "insufficient_evidence"] as const)(
    "flag on: %s keeps the panel and hides the badge",
    async (status) => {
      enable();
      service.mockResolvedValue(await uiStateFixture(status));
      const load = profileAchievementLoader("demo-1", "soloq", props.asOf, catalog);
      expect(await ProfileOtpHighlightContent({ load, champions: catalog })).toBeNull();
      expect(
        renderToStaticMarkup(await ProfileAchievementsContent({ ...props, view: "soloq", load })),
      ).toContain(`data-status="${status}"`);
      expect(service).toHaveBeenCalledTimes(1);
    },
  );
});

describe("recent form is operable without hover", () => {
  const matches = Array.from({ length: 6 }, (_, i) => ({
    matchId: `m-${i}`,
    champion: "Ahri",
    championId: 103,
    win: i % 2 === 0,
    isRemake: i === 3,
    kills: 3,
    deaths: 2,
    assists: i,
    timestamp: "2026-10-10T12:00:00Z",
  }));
  it("profile variant: five named buttons, results as text, details in the toggletip", () => {
    const html = renderToStaticMarkup(
      <RecentChampionForm matches={matches} champions={{}} interactive size={40} />,
    );
    const buttons = html.match(/<button type="button" class="info-tip-button"[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(5);
    for (const button of buttons) expect(button).toContain('aria-expanded="false"');
    expect(html).toContain('<span class="sr-only">Ahri · Victoria · Más reciente</span>');
    expect(html).toContain('<span class="recent-result" aria-hidden="true">V</span>');
    expect(html).toContain('<span class="recent-result" aria-hidden="true">D</span>');
    expect(html).toContain('<span class="recent-result" aria-hidden="true">R</span>');
    expect(html).toContain('aria-label="Últimas partidas, más reciente a la izquierda"');
    expect(html).not.toContain("data-tip");
  });
  it("ladder variant keeps its compact markup and order", () => {
    const html = renderToStaticMarkup(<RecentChampionForm matches={matches} champions={{}} />);
    expect(html).not.toContain("<button");
    expect((html.match(/data-tip="/g) ?? []).length).toBe(5);
    expect(html.match(/data-tip="([^"]+)"/)![1]).toBe("Ahri · Victoria · Más reciente");
  });
});

describe("singular and plural copy", () => {
  it("formats counts", () => {
    expect(countLabel(1, "partida", "partidas")).toBe("1 partida");
    expect(countLabel(0, "partida", "partidas")).toBe("0 partidas");
    expect(countLabel(2, "intervalo observado", "intervalos observados")).toBe(
      "2 intervalos observados",
    );
  });
  it("one observed interval reads in singular", () => {
    const history: RankSnapshot[] = [0, 1].map((i) => ({
      tier: "GOLD",
      division: "I",
      leaguePoints: 40 + i * 20,
      wins: 10 + i,
      losses: 5,
      timestamp: `2026-10-0${i + 1}T12:00:00Z`,
    }));
    const html = renderToStaticMarkup(<PlayerMomentum metrics={summarizeLp(history)} detailed />);
    expect(html).toContain("1 intervalo observado");
    expect(html).not.toContain("1 intervalos");
  });
  it("one loaded match and one ranked game read in singular", () => {
    expect(renderToStaticMarkup(<MatchHistory rows={[<article key="a">A</article>]} />)).toContain(
      "1 PARTIDA RECIENTE CARGADA",
    );
    const player = {
      rank: { tier: "IRON", division: "II", leaguePoints: 0, wins: 1, losses: 0 },
      stats: { ...emptyTotals(), games: 1, wins: 1, losses: 0 },
    } as unknown as PlayerProfile;
    const html = renderToStaticMarkup(<RecordBlock player={player} view="soloq" demo={false} />);
    expect(html).toContain("1 partida en el estado ranked actual");
    const imported = renderToStaticMarkup(
      <RecordBlock player={{ ...player, rank: null }} view="soloq" demo={false} />,
    );
    expect(imported).toContain("1 partida importada");
  });
});
