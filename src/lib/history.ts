import { rankLabel, rankSortValue } from "./ranking";
import type { RankSnapshot } from "./lp-metrics";

export type PerformancePoint = { timestamp: string; winrate: number; sample: number };
export type ActivityPoint = { timestamp: string; games: number; wins: number; losses: number };
// Fill internal gaps only: an empty history must remain an explicit empty state.
export function continuousActivity(points: ActivityPoint[]): ActivityPoint[] {
  if (!points.length) return [];
  const sorted = points.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
  const weeks = new Map(sorted.map((p) => [p.timestamp, p]));
  const result: ActivityPoint[] = [];
  for (
    let t = Date.parse(sorted[0].timestamp);
    t <= Date.parse(sorted.at(-1)!.timestamp);
    t += 7 * 86400_000
  ) {
    const timestamp = new Date(t).toISOString();
    result.push(weeks.get(timestamp) ?? { timestamp, games: 0, wins: 0, losses: 0 });
  }
  return result;
}
export type MatchObservation = {
  matchId: string;
  timestamp: string;
  duration: number;
  win: boolean;
  isRemake?: boolean | null;
};
export type LpObservation = {
  from: string;
  to: string;
  confidence: "high" | "aggregated" | "unknown";
  delta: number | null;
  games: number;
  matchId: string | null;
  label: string;
};
export function lpObservations(
  history: RankSnapshot[],
  matches: MatchObservation[],
): LpObservation[] {
  return history.slice(1).map((after, i) => {
    const before = history[i];
    const start = Date.parse(before.timestamp),
      end = Date.parse(after.timestamp);
    const wins = after.wins - before.wins,
      losses = after.losses - before.losses;
    const games = matches.filter(
      (m) =>
        m.isRemake === false &&
        Date.parse(m.timestamp) + m.duration * 1000 > start &&
        Date.parse(m.timestamp) + m.duration * 1000 <= end,
    );
    const base: LpObservation = {
      from: before.timestamp,
      to: after.timestamp,
      confidence: "unknown",
      delta: null,
      games: games.length,
      matchId: null,
      label: "Sin datos suficientes para atribuir LP",
    };
    if (
      rankSortValue(before) < 0 ||
      rankSortValue(after) < 0 ||
      !(end > start) ||
      wins < 0 ||
      losses < 0
    )
      return base;
    if (before.tier !== after.tier || before.division !== after.division)
      return {
        ...base,
        label: `${rankSortValue(after) > rankSortValue(before) ? "Ascenso" : "Descenso"} a ${rankLabel(after)}`,
      };
    const delta = after.leaguePoints - before.leaguePoints;
    if (
      !games.length ||
      games.length !== wins + losses ||
      games.filter((m) => m.win).length !== wins
    )
      return base;
    if (games.length === 1 && ((wins === 1 && delta < 0) || (losses === 1 && delta > 0)))
      return base;
    return {
      ...base,
      confidence: games.length === 1 ? "high" : "aggregated",
      delta,
      matchId: games.length === 1 ? games[0].matchId : null,
      label:
        games.length === 1
          ? "Delta observado · confianza alta"
          : `Cambio conjunto en ${games.length} partidas`,
    };
  });
}
// Demo/pure-domain equivalent of the SQL rolling window. No rank data is derived here.
export function rollingWinrate(matches: MatchObservation[]): PerformancePoint[] {
  const sorted = matches
    .filter((m) => !m.isRemake)
    .toSorted(
      (a, b) => a.timestamp.localeCompare(b.timestamp) || a.matchId.localeCompare(b.matchId),
    );
  return sorted.map((m, i) => {
    const window = sorted.slice(Math.max(0, i - 19), i + 1);
    return {
      timestamp: m.timestamp,
      sample: window.length,
      winrate: (window.filter((m) => m.win).length / window.length) * 100,
    };
  });
}
