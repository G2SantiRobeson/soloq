import "server-only";
import { isDemo } from "@/server/env";
import { demoPlayers } from "@/server/demo";
import type { View } from "@/lib/queues";
import type { ChampionCatalog } from "@/lib/champion-assets";
import type { AchievementPresentation } from "@/lib/achievements/presentation";
import { achievementExperienceEnabled } from "./feature";
import { profileAchievementPresentation } from "./profile";
export const ACHIEVEMENT_DEMO_CASES = [
  { id: "demo-5", label: "Varias señales" },
  { id: "demo-4", label: "Pocas señales" },
  { id: "demo-8", label: "Sin historial" },
] as const;
export type AchievementCenterSelection = {
  enabled: boolean;
  id: string | null;
  name: string | null;
  invalid: boolean;
  presentation: AchievementPresentation | null;
};
/** Catalog without a player performs no achievement read. One selected player uses the existing loader. */
export async function readAchievementCenter(
  player: string | string[] | undefined,
  view: View,
  asOf: string,
  champions: ChampionCatalog = {},
): Promise<AchievementCenterSelection> {
  const enabled = achievementExperienceEnabled();
  const empty = { enabled, id: null, name: null, invalid: false, presentation: null };
  if (player === undefined || player === "") return empty;
  if (
    typeof player !== "string" ||
    !(
      /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(player) ||
      (isDemo() && /^demo-[1-9]\d{0,2}$/.test(player))
    )
  )
    return { ...empty, invalid: true };
  const id = player.toLowerCase();
  const fixture = isDemo() ? demoPlayers(view, "season", id)[0] : undefined;
  if (isDemo() && !fixture) return { ...empty, invalid: true };
  return {
    enabled,
    id,
    name: fixture ? `${fixture.gameName}#${fixture.tagLine}` : "Perfil consultado",
    invalid: false,
    presentation:
      enabled && view !== "5v5"
        ? await profileAchievementPresentation(
            id,
            view,
            asOf,
            fixture
              ? {
                  ...Object.fromEntries(
                    fixture.champions.map((c) => [
                      c.championId,
                      { name: c.champion, image: `/champ-icons/${c.championId}.png` },
                    ]),
                  ),
                  ...champions,
                }
              : champions,
          )
        : null,
  };
}
