import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoPlayers } from "@/server/demo";
import {
  ACHIEVEMENT_DEMO_PLAYER_ID,
  demoAchievementPlayerId,
  demoAchievementReader,
} from "@/server/achievements/demo";
import { evaluateStoredAchievements } from "@/server/achievements/evaluate";
import {
  profileAchievementLoader,
  profileAchievementPresentation,
} from "@/server/achievements/profile";
import { observedOtp } from "@/components/achievements/otp-highlight";
import {
  ProfileAchievementsContent,
  ProfileOtpHighlight,
  ProfileOtpHighlightContent,
} from "@/components/achievements/profile-achievements";

// Delegates to the real service; only records how it is called.
const service = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/server/achievements/service", async (original) => {
  const actual = await original<typeof import("@/server/achievements/service")>();
  return {
    readPlayerAchievements: (request: unknown) => {
      service.calls.push(request);
      return actual.readPlayerAchievements(request);
    },
  };
});

const champions = {
  "412": { name: "Thresh", image: "/champ-icons/412.png" },
  "103": { name: "Ahri", image: "/champ-icons/103.png" },
};
beforeEach(() => {
  service.calls = [];
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", "true");
  vi.stubEnv("NODE_ENV", "development");
  for (const name of ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV"]) vi.stubEnv(name, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const asOf = () => new Date().toISOString();
const presentation = (id: string, view: "soloq" | "flex") =>
  profileAchievementPresentation(id, view, asOf(), champions);
const otpItem = async (id: string, view: "soloq" | "flex") => {
  const p = await presentation(id, view);
  if (p?.status !== "available") throw new Error(`unavailable ${id}`);
  return p.items.find((i) => i.code === "otp-specialist")!;
};

describe("demo OTP evidence belongs to the displayed player", () => {
  it.each(["soloq", "flex"] as const)(
    "%s: an observed OTP is the top champion of that player's own pool",
    async (view) => {
      let observed = 0;
      for (const player of demoPlayers(view).filter((p) => p.stats.games >= 50)) {
        const otp = observedOtp(await presentation(player.id, view));
        if (!otp) continue;
        observed++;
        const top = player.champions[0];
        expect(otp).toMatchObject({
          championId: top.championId,
          games: top.games,
          sample: player.stats.games,
        });
        expect(Number(otp.share.replace(",", "."))).toBeCloseTo(
          (100 * top.games) / player.stats.games,
          1,
        );
      }
      expect(observed).toBe(1); // Only the explicit one-trick fixture.
    },
    120_000,
  );

  it("building one demo profile yields the same data as the full fixture set", () => {
    for (const view of ["soloq", "flex"] as const) {
      const all = demoPlayers(view).find((p) => p.id === "demo-5")!;
      const one = demoPlayers(view, "season", "demo-5");
      expect(one).toHaveLength(1);
      expect({ ...one[0], observedAt: "", lastSyncedAt: "", createdAt: "" }).toMatchObject({
        id: all.id,
        rank: all.rank,
        stats: all.stats,
        champions: all.champions,
      });
    }
  });

  it("positive and negative cases come from each player's fixture", async () => {
    expect((await otpItem("demo-5", "soloq")).status).toBe("observed");
    expect((await otpItem("demo-1", "soloq")).status).toBe("not_observed");
    expect((await otpItem("demo-8", "soloq")).status).toBe("insufficient_evidence");
    const balanced = demoPlayers("soloq").find((p) => p.id === "demo-1")!;
    expect(balanced.champions[0].games / balanced.stats.games).toBeLessThan(0.7);
  });

  it("two demo players never share an observation", async () => {
    const [marea, nebula] = await Promise.all([
      otpItem("demo-5", "soloq"),
      otpItem("demo-1", "soloq"),
    ]);
    expect(marea.specialization?.champion).toBe("Thresh");
    expect(nebula.specialization?.champion).not.toBe(marea.specialization?.champion);
    expect(nebula.measurement).not.toBe(marea.measurement);
    expect(demoAchievementPlayerId("demo-5")).not.toBe(demoAchievementPlayerId("demo-1"));
  });

  it("SoloQ and Flex read only their own queue", async () => {
    for (const [view, queueId] of [
      ["soloq", 420],
      ["flex", 440],
    ] as const) {
      const result = await evaluateStoredAchievements(
        demoAchievementReader,
        { playerId: demoAchievementPlayerId("demo-5"), view, season: "2026", asOf: asOf() },
        "fictitious",
      );
      if (result.status !== "available") throw new Error("fixture");
      const evidence = result.evaluations.find((e) => e.code === "otp-specialist")!.evidence as {
        queue: string;
        validGames: number;
      };
      expect(evidence.queue).toBe(view === "flex" ? "RANKED_FLEX_SR" : "RANKED_SOLO_5x5");
      const player = demoPlayers(view).find((p) => p.id === "demo-5")!;
      expect(player.recent.every((m) => m.queueId === queueId)).toBe(true);
      expect(evidence.validGames).toBe(player.stats.games);
    }
  });

  it("the Bento badge and the signals panel show one shared evaluation", async () => {
    const records = vi.spyOn(demoAchievementReader, "records");
    const load = profileAchievementLoader("demo-5", "soloq", asOf(), champions);
    const badge = renderToStaticMarkup(await ProfileOtpHighlightContent({ load, champions }));
    const panel = renderToStaticMarkup(
      await ProfileAchievementsContent({
        playerId: "demo-5",
        view: "soloq",
        asOf: asOf(),
        champions,
        load,
      }),
    );
    expect(service.calls).toHaveLength(1);
    expect(records).toHaveBeenCalledTimes(1);
    const player = demoPlayers("soloq").find((p) => p.id === "demo-5")!;
    const thresh = player.champions.find((c) => c.championId === 412)!;
    expect(badge).toContain("OTP</span> Thresh");
    expect(badge).toContain(`<strong>${thresh.games}</strong> de ${player.stats.games}`);
    expect(panel).toContain(`Thresh · ${thresh.games} / ${player.stats.games} partidas`);
    expect(
      renderToStaticMarkup(
        await ProfileOtpHighlightContent({
          load: profileAchievementLoader("demo-1", "soloq", asOf(), champions),
          champions,
        }),
      ),
    ).toBe("");
  });

  it("flag off: no badge, no evaluation and no reads", async () => {
    vi.stubEnv("ACHIEVEMENTS_EXPERIMENTAL", undefined);
    const records = vi.spyOn(demoAchievementReader, "records");
    const load = profileAchievementLoader("demo-5", "soloq", asOf(), champions);
    expect(ProfileOtpHighlight({ view: "soloq", load, champions })).toBeNull();
    expect(await load()).toBeNull();
    expect(service.calls).toHaveLength(0);
    expect(records).not.toHaveBeenCalled();
  });

  it("unknown demo ids and real players are never mapped to demo evidence", async () => {
    expect(await presentation("demo-999", "soloq")).toBeNull();
    expect(demoAchievementPlayerId("11111111-1111-4111-8111-111111111111")).toBeNull();
    expect(
      await demoAchievementReader.player("22222222-2222-4222-8222-222222222222"),
    ).toBeUndefined();
    // The dedicated fixture used by the evaluation tests is unchanged.
    expect(
      (await demoAchievementReader.player(ACHIEVEMENT_DEMO_PLAYER_ID))?.backfillProcessed,
    ).toBe(50);
    vi.stubEnv("DEMO_MODE", "false");
    const real = "33333333-3333-4333-8333-333333333333";
    vi.spyOn(console, "error").mockImplementation(() => {});
    await presentation(real, "soloq");
    expect(service.calls).toEqual([expect.objectContaining({ playerId: real, view: "soloq" })]);
  });
});
