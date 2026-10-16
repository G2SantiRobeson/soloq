import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { demoPlayers } from "@/server/demo";
import { selectRivalries, hasRivalRank } from "@/lib/rivalries";
import { rankedQueue } from "@/lib/queues";
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-14T12:00:00Z")));
afterEach(() => vi.restoreAllMocks());
it.each(["soloq", "flex", "5v5"] as const)(
  "has 24 distinct fictional players and preserves the original IDs in %s",
  (view) => {
    const players = demoPlayers(view);
    expect(players).toHaveLength(24);
    expect(new Set(players.map((p) => p.id)).size).toBe(24);
    expect(players[3]).toMatchObject({ id: "demo-4", gameName: "Demo Ronin" });
    expect(players[4]).toMatchObject({ id: "demo-5", gameName: "Demo Marea" });
    for (const player of players.slice(12)) {
      expect(player.gameName).toMatch(/^Demo /);
      expect(player.stats.games).toBeGreaterThan(1);
      if (view === "5v5") {
        expect(player.rank).toBeNull();
        expect(player.history).toHaveLength(0);
      } else {
        expect(hasRivalRank(player)).toBe(true);
        expect(player.rank!.wins).toBeGreaterThanOrEqual(0);
        expect(player.rank!.losses).toBeGreaterThanOrEqual(0);
        expect(player.history).toHaveLength(12);
        expect(player.history.at(-1)).toMatchObject(player.rank!);
        for (const point of player.history) {
          expect(point.wins).toBeGreaterThanOrEqual(0);
          expect(point.losses).toBeGreaterThanOrEqual(0);
        }
        const single = demoPlayers(view, "season", player.id)[0];
        expect(single).toEqual(player);
      }
    }
  },
);
it.each(["soloq", "flex"] as const)(
  "shows three disjoint %s duels and provides EUW, LAN and BR examples",
  (view) => {
    const players = demoPlayers(view),
      pairs = selectRivalries(players, view);
    expect(pairs).toHaveLength(3);
    const ids = pairs.flatMap((p) => p.players.map((p) => p.id));
    expect(new Set(ids).size).toBe(6);
    for (const pair of pairs) {
      expect(pair.queue).toBe(rankedQueue(view));
      expect(pair.players[0].platform).toBe(pair.players[1].platform);
    }
    for (const platform of ["EUW1", "LA1", "BR1"]) {
      const filtered = selectRivalries(
        players.filter((p) => p.platform === platform),
        view,
      );
      expect(filtered).toHaveLength(1);
    }
    expect(
      selectRivalries(
        players.filter((p) => p.platform === "NA1"),
        view,
      ),
    ).toHaveLength(0);
    expect(pairs[0].players.map((p) => p.id).sort()).toEqual(["demo-4", "demo-5"]);
  },
);
