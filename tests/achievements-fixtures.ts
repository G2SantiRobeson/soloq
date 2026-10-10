import type {
  AchievementCoverage,
  AchievementMatch,
  AchievementSnapshot,
  MatchEvaluationInput,
  RankEvaluationInput,
} from "@/lib/achievements";
import { currentAchievementScope } from "@/lib/achievements";

export const DAY = 86400_000;
export const fixedScope = currentAchievementScope("soloq", "LA2", "2026-11-01T00:00:00Z");
export const coverage: AchievementCoverage = {
  source: "imported_history",
  historyStatus: "running",
  unavailable: 0,
  intervalCoverage: "unproven",
};
export function snapshot(
  lp: number,
  day: number,
  extra: Partial<AchievementSnapshot> = {},
): AchievementSnapshot {
  return {
    id: `snapshot-${day}`,
    queue: "RANKED_SOLO_5x5",
    timestamp: new Date(Date.parse("2026-09-01T12:00:00Z") + day * DAY).toISOString(),
    tier: "DIAMOND",
    division: "I",
    leaguePoints: lp,
    wins: 20 + Math.floor(day),
    losses: 10 + Math.floor(day),
    ...extra,
  };
}
export function match(i: number, extra: Partial<AchievementMatch> = {}): AchievementMatch {
  return {
    matchId: `fictitious-${i}`,
    queueId: 420,
    timestamp: new Date(Date.parse("2026-10-01T12:00:00Z") + i * 60000).toISOString(),
    win: true,
    isRemake: false,
    championId: 157,
    ...extra,
  };
}
export function rankInput(
  snapshots = [snapshot(80, 0), snapshot(25, 1), snapshot(80, 2)],
): RankEvaluationInput {
  return { scope: fixedScope, snapshots };
}
export function matchContext(matches: readonly AchievementMatch[]): MatchEvaluationInput {
  return { scope: fixedScope, matches, coverage };
}
export function otpMatches(n = 50, championGames = 35) {
  return Array.from({ length: n }, (_, i) =>
    match(i, { championId: i < championGames ? 157 : 99 }),
  );
}
/** Reproducible Fisher-Yates without ambient randomness. */
export function shuffle<T>(input: readonly T[], seed: number) {
  const out = [...input];
  let state = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
