import { eligibleRivalPairs, MAX_RIVALRIES, type Rivalry } from "./rivalries";
import { rankedQueue, type View } from "./queues";
import {
  ladderQuery,
  parseLadderFilters,
  type LadderFilters,
  type LadderSearchParams,
} from "./ladder-filters";
import type { PublicPlayer } from "./types";
import { rivalryKey } from "./weekly-rivalry";
export type RivalPairIds = readonly [string, string];
export type SharedRivalryRequest =
  { status: "none" | "invalid" } | { status: "requested"; ids: RivalPairIds };
export type SharedRivalryResult =
  { status: "none" | "invalid" | "unavailable" } | { status: "ready"; rivalry: Rivalry };
export const validPlayerId = (id: unknown): id is string =>
  typeof id === "string" &&
  (/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id) ||
    /^demo-[1-9]\d{0,2}$/.test(id));
export function normalizedRivalIds(ids: readonly unknown[]): RivalPairIds | null {
  if (ids.length !== 2 || !validPlayerId(ids[0]) || !validPlayerId(ids[1])) return null;
  const a = ids[0].toLowerCase(),
    b = ids[1].toLowerCase();
  if (a === b) return null;
  return a < b ? [a, b] : [b, a];
}
export const rivalryAnchor = (ids: RivalPairIds) => "rivalidad-" + [...ids].sort().join("--");
export function parseSharedRivalry(params: LadderSearchParams, view: View): SharedRivalryRequest {
  const a = params.rivalA,
    b = params.rivalB;
  if (a === undefined && b === undefined) return { status: "none" };
  if (!rankedQueue(view) || (params.queue !== undefined && params.queue !== view))
    return { status: "invalid" };
  const ids = normalizedRivalIds([a, b]);
  return ids ? { status: "requested", ids } : { status: "invalid" };
}
export function sharedRivalryQuery(view: View, filters: LadderFilters, ids: RivalPairIds): string {
  const params = new URLSearchParams(ladderQuery(view, filters));
  params.set("rivalA", ids[0]);
  params.set("rivalB", ids[1]);
  return "?" + params;
}
export function sharedRivalryPath(
  view: View,
  rawIds: RivalPairIds,
  filters = parseLadderFilters(view, {}),
  manual = false,
): string | null {
  const ids = normalizedRivalIds(rawIds);
  if (!ids || !rankedQueue(view)) return null;
  return (
    "/rivalidad/" + ids.join("/") + ladderQuery(view, filters) + (manual ? "&tipo=elegida" : "")
  );
}
/** Resolve only public, filtered, adjacent current ladder candidates. Never force an old pair. */
export function resolveSharedRivalry(
  players: readonly PublicPlayer[],
  view: View,
  request: SharedRivalryRequest,
): SharedRivalryResult {
  if (request.status !== "requested") return { status: request.status };
  const ids = normalizedRivalIds(request.ids);
  if (!ids || !rankedQueue(view)) return { status: "invalid" };
  const [a, b] = ids;
  const pair = eligibleRivalPairs(players, view).find((r) => {
    const ids = r.players.map((p) => p.id.toLowerCase());
    return ids.includes(a) && ids.includes(b);
  });
  return pair ? { status: "ready", rivalry: pair } : { status: "unavailable" };
}
/** Requested valid pair replaces overlapping public duels; never duplicates players or changes the ladder. */
export function visibleSharedRivalries(
  ordinary: readonly Rivalry[],
  shared: SharedRivalryResult,
): Rivalry[] {
  if (shared.status !== "ready") return [...ordinary];
  const ids = new Set(shared.rivalry.players.map((p) => p.id));
  return [
    shared.rivalry,
    ...ordinary.filter(
      (r) => rivalryKey(r) !== rivalryKey(shared.rivalry) && r.players.every((p) => !ids.has(p.id)),
    ),
  ].slice(0, MAX_RIVALRIES);
}
