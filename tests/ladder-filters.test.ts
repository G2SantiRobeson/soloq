import { describe, expect, it } from "vitest";
import { ladderQuery, parseLadderFilters, SEARCH_MAX_LENGTH } from "@/lib/ladder-filters";

describe("ladder filters in the URL", () => {
  it("falls back to the view defaults for missing or invalid values", () => {
    expect(parseLadderFilters("soloq", {})).toEqual({
      search: "",
      region: "all",
      sort: "rank",
      ascending: false,
    });
    expect(parseLadderFilters("5v5", { sort: "rank", region: "MARS", dir: "up" })).toEqual({
      search: "",
      region: "all",
      sort: "winrate",
      ascending: false,
    });
  });
  it("reads valid values and caps the search length", () => {
    const filters = parseLadderFilters("flex", {
      q: "x".repeat(SEARCH_MAX_LENGTH + 10),
      region: ["LA2", "NA1"],
      sort: "kda",
      dir: "asc",
    });
    expect(filters).toEqual({
      search: "x".repeat(SEARCH_MAX_LENGTH),
      region: "LA2",
      sort: "kda",
      ascending: true,
    });
  });
  it("round-trips and omits defaults", () => {
    const filters = parseLadderFilters("soloq", { q: "Neb#LAS", region: "LA2", sort: "winrate" });
    const query = ladderQuery("soloq", filters);
    expect(query).toBe("?queue=soloq&q=Neb%23LAS&region=LA2&sort=winrate");
    expect(parseLadderFilters("soloq", Object.fromEntries(new URLSearchParams(query)))).toEqual(
      filters,
    );
    expect(ladderQuery("5v5", parseLadderFilters("5v5", {}))).toBe("?queue=5v5");
  });
});
