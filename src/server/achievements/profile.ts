import "server-only";
import { cache } from "react";
import type { View } from "@/lib/queues";
import type { ChampionCatalog } from "@/lib/champion-assets";
import { CURRENT_SEASON } from "@/lib/season";
import { isDemo } from "@/server/env";
import { achievementsExperimentalEnabled } from "./feature";
import { reportAchievementFailure } from "./errors";
import { achievementPresentation } from "./presentation";
import type { AchievementPresentation } from "@/lib/achievements/presentation";

// Request-local React cache, scoped by identity, queue and cutoff. No cross-request cache.
const read = cache(async (playerId: string, view: View, asOf: string) => {
  const { readPlayerAchievements } = await import("./service");
  return readPlayerAchievements({ playerId, view, season: CURRENT_SEASON.id, asOf });
});

export type ProfileAchievementLoader = () => Promise<AchievementPresentation | null>;

/**
 * One presentation per profile render, started lazily by its first consumer (the signals
 * panel or the OTP badge) so streaming is unchanged and no consumer evaluates twice.
 */
export function profileAchievementLoader(
  playerId: string,
  view: View,
  asOf: string,
  champions: ChampionCatalog,
): ProfileAchievementLoader {
  let pending: Promise<AchievementPresentation | null> | undefined;
  return () => (pending ??= profileAchievementPresentation(playerId, view, asOf, champions));
}

export async function profileAchievementPresentation(
  playerId: string,
  view: View,
  asOf: string,
  champions: ChampionCatalog,
): Promise<AchievementPresentation | null> {
  if (!achievementsExperimentalEnabled() || view === "5v5") return null;
  try {
    if (isDemo()) {
      const [{ demoPlayers }, { ACHIEVEMENT_DEMO_PLAYER_ID }] = await Promise.all([
        import("@/server/demo"),
        import("./demo"),
      ]);
      if (!demoPlayers(view).some((p) => p.id === playerId)) return null;
      playerId = ACHIEVEMENT_DEMO_PLAYER_ID;
    }
    return achievementPresentation(await read(playerId, view, asOf), champions);
  } catch (error) {
    // The programming defect remains detectable without leaking the exception payload.
    reportAchievementFailure("presentation", error);
    return achievementPresentation({ status: "unavailable" });
  }
}
