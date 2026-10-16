import { PLATFORMS } from "./routing";
import { rankedQueue, type View } from "./queues";
import { validPlayerId } from "./shared-rivalry";
import { validManualChoice } from "./manual-rival";
import type { RivalIdentity } from "./nearest-rival";
export const RIVAL_PREFERENCE_EVENT = "soloq:rival-preference";
export type Preference = {
  id: string | null;
  status: "empty" | "valid" | "obsolete" | "unavailable";
};
export type RivalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function rivalPreferenceKey(player: RivalIdentity, view: View): string | null {
  if (!validPlayerId(player.id) || !PLATFORMS.includes(player.platform) || !rankedQueue(view))
    return null;
  return "soloq:rival:v1:" + player.id.toLowerCase() + ":" + player.platform + ":" + view;
}
export function readLocalRival(
  storage: Pick<Storage, "getItem"> | null,
  key: string | null,
  player: RivalIdentity,
  candidates: readonly RivalIdentity[],
): Preference {
  if (!storage || !key) return { id: null, status: "unavailable" };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { id: null, status: "empty" };
    if (raw.length > 160) return { id: null, status: "obsolete" };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { id: null, status: "obsolete" };
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      record.version !== 1 ||
      typeof record.rivalId !== "string" ||
      !validPlayerId(record.rivalId)
    )
      return { id: null, status: "obsolete" };
    const id = record.rivalId.toLowerCase(),
      rival = candidates.find((p) => p.id.toLowerCase() === id);
    return validManualChoice(player, rival)
      ? { id: rival!.id, status: "valid" }
      : { id: null, status: "obsolete" };
  } catch (error) {
    return { id: null, status: error instanceof SyntaxError ? "obsolete" : "unavailable" };
  }
}
export function writeLocalRival(
  storage: RivalStorage | null,
  key: string | null,
  player: RivalIdentity,
  candidates: readonly RivalIdentity[],
  id: string | null,
): boolean {
  if (
    id !== null &&
    !validManualChoice(
      player,
      candidates.find((p) => p.id === id),
    )
  )
    throw new Error("INVALID_RIVAL");
  if (!storage || !key) return false;
  try {
    if (id === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ version: 1, rivalId: id.toLowerCase() }));
    return true;
  } catch {
    return false;
  }
}
