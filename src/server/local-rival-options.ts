import "server-only";
import { getProfileRivalPool } from "./profile-rival";
import { isDemo } from "./env";
import { rankedQueue, type View } from "@/lib/queues";
import { validManualChoice, type ManualRivalContext } from "@/lib/manual-rival";
import type { RivalIdentity } from "@/lib/nearest-rival";
/** Public rank-only candidates; deliberately never reads shared preferences or writes data. */
export async function getLocalRivalOptions(
  player: RivalIdentity,
  view: View,
): Promise<ManualRivalContext> {
  const empty = { available: false, demo: isDemo(), selectedId: null, candidates: [] };
  if (!rankedQueue(view)) return empty;
  const pool = await getProfileRivalPool(view, player.platform, player.observedAt);
  if (!pool) return empty;
  return {
    available: true,
    demo: isDemo(),
    selectedId: null,
    candidates: pool
      .filter((p) => validManualChoice(player, p))
      .sort((a, b) => a.gameName.localeCompare(b.gameName, "es") || a.id.localeCompare(b.id)),
  };
}
