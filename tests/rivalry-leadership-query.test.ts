import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLeaderboard } from "@/server/queries";
import { WEEKLY_RIVALRY_HISTORY_LIMIT } from "@/lib/weekly-rivalry";
import { RIVALRY_HISTORY_LIMIT } from "@/lib/rivalry-leadership";
const database = vi.hoisted(() =>
  vi.fn(() => {
    throw Error("FORBIDDEN_DATABASE");
  }),
);
vi.mock("@/db", () => ({ db: database }));
beforeEach(() => {
  database.mockClear();
  vi.stubEnv("DEMO_MODE", "true");
});
afterEach(() => vi.unstubAllEnvs());
// RC2 retains main's real reader. Staging SQL-batch behavior is outside this Demo release.
describe("RC2 fictional leadership observations bypass database batching entirely", () => {
  it.each(["soloq", "flex"] as const)(
    "%s carries bounded, queue-specific original histories without DB or N+1",
    async (view) => {
      const players = await getLeaderboard(view);
      expect(players).toHaveLength(24);
      for (const player of players) {
        expect((player.rivalryHistory ?? []).length).toBeLessThanOrEqual(RIVALRY_HISTORY_LIMIT);
        expect((player.weeklyRivalryHistory ?? []).length).toBeLessThanOrEqual(
          WEEKLY_RIVALRY_HISTORY_LIMIT,
        );
        expect(
          (player.rivalryHistory ?? []).every(
            (h) => h.queue === (view === "soloq" ? "RANKED_SOLO_5x5" : "RANKED_FLEX_SR"),
          ),
        ).toBe(true);
      }
      expect(players.some((p) => (p.rivalryHistory ?? []).length > 1)).toBe(true);
      expect(database).not.toHaveBeenCalled();
    },
  );
  it("5v5 has no invented ranked history", async () => {
    const players = await getLeaderboard("5v5");
    for (const player of players) {
      expect(player.rank).toBeNull();
      expect(player.rivalryHistory ?? []).toEqual([]);
    }
    expect(database).not.toHaveBeenCalled();
  });
});
