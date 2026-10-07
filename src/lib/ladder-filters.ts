import { PLATFORMS, type Platform } from "./routing";
import type { View } from "./queues";

export const LADDER_SORTS = ["rank", "games", "winrate", "kda"] as const;
export type LadderSort = (typeof LADDER_SORTS)[number];
export type LadderFilters = {
  search: string;
  region: Platform | "all";
  sort: LadderSort;
  ascending: boolean;
};
export type LadderSearchParams = Record<string, string | string[] | undefined>;
export const SEARCH_MAX_LENGTH = 40;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function defaultLadderSort(view: View): LadderSort {
  return view === "5v5" ? "winrate" : "rank";
}

export function parseLadderFilters(view: View, params: LadderSearchParams): LadderFilters {
  const sort = first(params.sort);
  const region = first(params.region);
  const validSort =
    LADDER_SORTS.includes(sort as LadderSort) && !(view === "5v5" && sort === "rank");
  return {
    search: (first(params.q) ?? "").slice(0, SEARCH_MAX_LENGTH),
    region: PLATFORMS.includes(region as Platform) ? (region as Platform) : "all",
    sort: validSort ? (sort as LadderSort) : defaultLadderSort(view),
    ascending: first(params.dir) === "asc",
  };
}

/** Query string for the ladder; defaults are omitted so shared URLs stay short. */
export function ladderQuery(view: View, filters: LadderFilters): string {
  const params = new URLSearchParams({ queue: view });
  if (filters.search) params.set("q", filters.search);
  if (filters.region !== "all") params.set("region", filters.region);
  if (filters.sort !== defaultLadderSort(view)) params.set("sort", filters.sort);
  if (filters.ascending) params.set("dir", "asc");
  return `?${params}`;
}
