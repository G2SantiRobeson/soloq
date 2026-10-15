import "server-only";
import { demoPlayers } from "@/server/demo";
import type { View } from "@/lib/queues";
import type { AchievementPlayerContext, AchievementReader, AchievementRecords } from "./contracts";

export const ACHIEVEMENT_DEMO_PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const PUBLIC_DEMO_PREFIX = "00000000-0000-4000-8000-";

/** Deterministic achievement identity of a public demo profile (`demo-5` → its own UUID). */
export function demoAchievementPlayerId(demoId: string): string | null {
  const match = /^demo-([1-9]\d{0,11})$/.exec(demoId);
  return match ? PUBLIC_DEMO_PREFIX + match[1].padStart(12, "0") : null;
}
const publicDemoId = (id: string) =>
  id.startsWith(PUBLIC_DEMO_PREFIX) ? `demo-${Number(id.slice(PUBLIC_DEMO_PREFIX.length))}` : null;
const publicDemoPlayer = (id: string, view: View) => {
  const demoId = publicDemoId(id);
  return demoId ? demoPlayers(view, "season", demoId)[0] : undefined;
};

/**
 * Public demo profiles are evaluated from their own fixture: the same matches that build
 * the displayed pool and form, and the same snapshots as the rank chart. The evaluator
 * keeps queue and season filtering, so SoloQ and Flex never mix.
 */
function publicDemoContext(id: string): AchievementPlayerContext | undefined {
  // Import counters describe every imported queue, like the real player context.
  const p = publicDemoPlayer(id, "5v5");
  if (!p?.seasonHistory) return undefined;
  return {
    id,
    platform: p.platform,
    enabled: true,
    backfillSeason: p.seasonHistory.season,
    backfillStatus: p.seasonHistory.status,
    backfillProcessed: p.seasonHistory.processed,
    backfillDiscovered: p.seasonHistory.discovered,
    backfillUnavailable: p.seasonHistory.unavailable,
    lastSyncedAt: p.lastSyncedAt ? new Date(p.lastSyncedAt) : null,
    rankCheckedAt: null,
  };
}
function publicDemoRecords(id: string, view: View): AchievementRecords {
  const p = publicDemoPlayer(id, view);
  if (!p) return { snapshots: [], matches: [] };
  const queue = view === "flex" ? "RANKED_FLEX_SR" : "RANKED_SOLO_5x5";
  return {
    snapshots: p.history.map((h, i) => ({
      id: `${p.id}-${view}-snapshot-${i}`,
      queue,
      timestamp: h.timestamp,
      tier: h.tier,
      division: h.division,
      leaguePoints: h.leaguePoints,
      wins: h.wins,
      losses: h.losses,
    })),
    matches: p.recent.map((m) => ({
      matchId: m.matchId,
      queueId: m.queueId,
      timestamp: m.timestamp,
      win: m.win,
      isRemake: m.isRemake ?? false,
      championId: m.championId,
    })),
  };
}

/**
 * Fictional readers only. ACHIEVEMENT_DEMO_PLAYER_ID is a dedicated test fixture,
 * independent of the public demo profiles; public profiles read their own fixture.
 */
export const demoAchievementReader: AchievementReader = {
  async player(id) {
    if (id !== ACHIEVEMENT_DEMO_PLAYER_ID) return publicDemoContext(id);
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
  async records(player, scope) {
    if (player.id !== ACHIEVEMENT_DEMO_PLAYER_ID)
      return publicDemoRecords(player.id, scope.view === "flex" ? "flex" : "soloq");
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
