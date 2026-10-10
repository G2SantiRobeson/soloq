import "server-only";
import type { AchievementReader } from "./contracts";

export const ACHIEVEMENT_DEMO_PLAYER_ID = "11111111-1111-4111-8111-111111111111";
/** Dedicated fictional input, independent of the public demo fixtures and clock. */
export const demoAchievementReader: AchievementReader = {
  async player(id) {
    if (id !== ACHIEVEMENT_DEMO_PLAYER_ID) return undefined;
    return {
      id,
      platform: "LA2",
      enabled: true,
      backfillSeason: "2026",
      backfillStatus: "running",
      backfillProcessed: 50,
      backfillDiscovered: 70,
      backfillUnavailable: 2,
      lastSyncedAt: null,
      rankCheckedAt: null,
    };
  },
  async records(_player, scope) {
    const flex = scope.view === "flex";
    return {
      snapshots: [80, 25, 80].map((leaguePoints, i) => ({
        id: `fictitious-snapshot-${i}`,
        queue: flex ? "RANKED_FLEX_SR" : "RANKED_SOLO_5x5",
        timestamp: `2026-09-0${i + 1}T12:00:00Z`,
        tier: "DIAMOND",
        division: "I",
        leaguePoints,
        wins: 20 + i,
        losses: 10 + i,
      })),
      matches: Array.from({ length: 50 }, (_, i) => ({
        matchId: `fictitious-match-${i}`,
        queueId: flex ? 440 : 420,
        timestamp: new Date(Date.parse("2026-10-01T12:00:00Z") + i * 3600000).toISOString(),
        win: i < 5 || i % 2 === 0,
        isRemake: false,
        championId: i < 35 ? 157 : 99,
      })),
    };
  },
};
