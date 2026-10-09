import { describe, expect, it } from "vitest";
import { matchPage } from "@/lib/match-pagination";

describe("available match pagination", () => {
  const matches = Array.from({ length: 24 }, (_, matchId) => ({
    matchId,
    isRemake: matchId === 8,
    cs: matchId * 10,
  }));
  it("shows the latest five initially and after returning to summary", () => {
    expect(matchPage(matches, false).items).toEqual(matches.slice(0, 5));
    expect(matchPage(matches, false, 2)).toMatchObject({ page: 0, start: 0, end: 5 });
  });
  it("paginates by ten in existing order, preserving remakes and all metrics", () => {
    const pages = [0, 1, 2].map((page) => matchPage(matches, true, page));
    expect(pages.map((p) => p.items.length)).toEqual([10, 10, 4]);
    expect(pages.flatMap((p) => p.items)).toEqual(matches);
    expect(pages[0].items[8]).toEqual(matches[8]);
    expect(pages[2]).toMatchObject({ pages: 3, page: 2, start: 20, end: 24 });
  });
  it("bounds navigation and handles empty and small histories", () => {
    expect(matchPage(matches, true, -1).page).toBe(0);
    expect(matchPage(matches, true, 100).page).toBe(2);
    expect(matchPage(matches, true, NaN).page).toBe(0);
    expect(matchPage([], true)).toMatchObject({ items: [], pages: 1, page: 0, start: 0, end: 0 });
    expect(matchPage(matches.slice(0, 3), false).items).toHaveLength(3);
    expect(matchPage(matches.slice(0, 10), true).pages).toBe(1);
    expect(matchPage(matches.slice(0, 11), true).pages).toBe(2);
  });
});
