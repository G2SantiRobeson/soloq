import { describe, expect, it } from "vitest";
import { selectRivalries, MAX_RIVALRIES } from "@/lib/rivalries";
import { emptyTotals } from "@/lib/stats";
import { rankSortValue, type Rank } from "@/lib/ranking";
import type { PublicPlayer } from "@/lib/types";

const player = (
  id: string,
  lp = 50,
  rank: Partial<Rank> = {},
  platform: PublicPlayer["platform"] = "LA2",
): PublicPlayer => ({
  id,
  gameName: id,
  tagLine: "TEST",
  platform,
  profileIconId: 29,
  lastSyncedAt: null,
  observedAt: "2026-10-14T00:00:00Z",
  createdAt: "2026-10-01T00:00:00Z",
  rank: { tier: "GOLD", division: "II", leaguePoints: lp, wins: 10, losses: 8, ...rank },
  stats: emptyTotals(),
  recent: [],
  momentum: null,
});
const ids = (rows: ReturnType<typeof selectRivalries>) =>
  rows.map((r) => r.players.map((p) => p.id));

describe("automatic ladder rivalries", () => {
  it("selects nearby official ranks including the 35 LP boundary", () => {
    expect(selectRivalries([player("a", 70), player("b", 35)], "soloq")[0]).toMatchObject({
      lpDifference: 35,
      proximity: "same-rank",
      queue: "RANKED_SOLO_5x5",
    });
    expect(selectRivalries([player("a", 71), player("b", 35)], "soloq")).toEqual([]);
  });
  it("supports a configurable threshold and exact ties", () => {
    const players = [player("a", 70), player("b", 60)];
    expect(selectRivalries(players, "soloq", { lpThreshold: 9 })).toEqual([]);
    expect(selectRivalries(players, "soloq", { lpThreshold: 10 })).toHaveLength(1);
    expect(
      selectRivalries([player("b"), player("a")], "soloq", { lpThreshold: 0 })[0].lpDifference,
    ).toBe(0);
  });
  it.each([-1, NaN, Infinity, 1.5])("rejects invalid thresholds: %s", (lpThreshold) => {
    expect(selectRivalries([player("a"), player("b")], "soloq", { lpThreshold })).toEqual([]);
  });
  it("is deterministic on ties, independent of input order or display sort", () => {
    const players = [player("d"), player("c"), player("b"), player("a")];
    expect(ids(selectRivalries(players, "soloq"))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(ids(selectRivalries([...players].reverse(), "soloq"))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
  it("prioritizes closest adjacent rivals, then the higher official rank", () => {
    expect(
      ids(
        selectRivalries(
          [player("a", 90), player("b", 80), player("c", 79), player("d", 40)],
          "soloq",
        ),
      ),
    ).toEqual([["b", "c"]]);
    expect(
      ids(
        selectRivalries(
          [
            player("a", 50),
            player("b", 40),
            player("c", 50, { tier: "DIAMOND" }),
            player("d", 40, { tier: "DIAMOND" }),
          ],
          "soloq",
        ),
      )[0],
    ).toEqual(["c", "d"]);
  });
  it("allows adjacent divisions near their boundary without inventing an LP difference", () => {
    expect(
      selectRivalries(
        [player("a", 5, { division: "I" }), player("b", 80, { division: "II" })],
        "soloq",
      )[0],
    ).toMatchObject({ proximity: "adjacent-divisions", lpDifference: null });
  });
  it.each([
    ["I", 30, "II", 50],
    ["I", 0, "III", 99],
    ["II", 1, "IV", 99],
  ])("rejects distant/nonadjacent divisions %s/%s vs %s/%s", (division, lp, otherDiv, otherLp) => {
    expect(
      selectRivalries(
        [
          player("a", Number(lp), { division: String(division) }),
          player("b", Number(otherLp), { division: String(otherDiv) }),
        ],
        "soloq",
      ),
    ).toEqual([]);
  });
  it.each([
    ["GOLD", "PLATINUM"],
    ["DIAMOND", "MASTER"],
    ["MASTER", "GRANDMASTER"],
    ["GRANDMASTER", "CHALLENGER"],
  ])("keeps official tiers %s and %s distinct", (a, b) => {
    expect(
      selectRivalries(
        [player("a", 10, { tier: a, division: "I" }), player("b", 10, { tier: b, division: "I" })],
        "soloq",
      ),
    ).toEqual([]);
  });
  it.each(["MASTER", "GRANDMASTER", "CHALLENGER"])("compares LP within %s only", (tier) => {
    expect(
      selectRivalries(
        [player("a", 1000, { tier, division: "I" }), player("b", 980, { tier, division: "I" })],
        "soloq",
      )[0].lpDifference,
    ).toBe(20);
  });
  it("separates platforms even in the same routing region", () => {
    expect(
      selectRivalries([player("a", 50, {}, "LA2"), player("b", 50, {}, "LA1")], "soloq"),
    ).toEqual([]);
    expect(
      selectRivalries(
        [player("a", 50, {}, "LA2"), player("c", 51, {}, "EUW1"), player("b", 49, {}, "LA2")],
        "soloq",
      )[0].players.map((p) => p.platform),
    ).toEqual(["LA2", "LA2"]);
  });
  it("binds the result to SoloQ/Flex and excludes 5v5 entirely", () => {
    const players = [player("a"), player("b")];
    expect(selectRivalries(players, "flex")[0].queue).toBe("RANKED_FLEX_SR");
    expect(selectRivalries(players, "soloq")[0].queue).toBe("RANKED_SOLO_5x5");
    expect(selectRivalries(players, "5v5")).toEqual([]);
  });
  it.each([
    { tier: "UNRANKED" },
    { tier: "UNKNOWN" },
    { division: "V" },
    { leaguePoints: -1 },
    { leaguePoints: NaN },
    { leaguePoints: Infinity },
    { leaguePoints: 0.5 },
    { leaguePoints: 100 },
  ])("excludes invalid rank %j", (rank) => {
    expect(selectRivalries([player("a", 50, rank), player("b")], "soloq")).toEqual([]);
  });
  it("requires two eligible identities and does not use match stats to invent a rank", () => {
    expect(selectRivalries([], "soloq")).toEqual([]);
    expect(selectRivalries([player("a")], "soloq")).toEqual([]);
    expect(selectRivalries([{ ...player("a"), rank: null }, player("b")], "soloq")).toEqual([]);
  });
  it("excludes ambiguous duplicate identities", () => {
    expect(selectRivalries([player("a"), player("a", 60), player("b")], "soloq")).toEqual([]);
  });
  it("never repeats a player, caps highlights at three and preserves the input ladder", () => {
    const players = Array.from({ length: 12 }, (_, i) => player(`p${String(i).padStart(2, "0")}`));
    const before = structuredClone(players);
    const rivalries = selectRivalries(players, "soloq");
    expect(rivalries).toHaveLength(MAX_RIVALRIES);
    const selected = rivalries.flatMap((r) => r.players.map((p) => p.id));
    expect(new Set(selected).size).toBe(selected.length);
    expect(players).toEqual(before);
    for (const r of rivalries)
      expect(rankSortValue(r.players[0].rank)).toBeGreaterThanOrEqual(
        rankSortValue(r.players[1].rank),
      );
  });
});
