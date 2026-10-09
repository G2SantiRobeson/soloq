import { chartRankCoordinate, rankLabel, TIERS, type Tier } from "./ranking";
import type { RankSnapshot } from "./lp-metrics";

// Conservative display boundary, not an ingestion limit or a claim about Riot activity.
export const MAX_RANK_INTERVAL_MS = 7 * 86400_000;

export function validRankObservation(point: RankSnapshot) {
  const tier = TIERS.indexOf(point.tier as Tier);
  return (
    tier >= 0 &&
    (tier >= 7 || ["I", "II", "III", "IV"].includes(point.division)) &&
    [point.leaguePoints, point.wins, point.losses].every((v) => Number.isInteger(v) && v >= 0) &&
    Number.isFinite(Date.parse(point.timestamp))
  );
}

export function comparableRankInterval(before: RankSnapshot, after: RankSnapshot) {
  const duration = Date.parse(after.timestamp) - Date.parse(before.timestamp);
  return (
    validRankObservation(before) &&
    validRankObservation(after) &&
    duration > 0 &&
    duration <= MAX_RANK_INTERVAL_MS &&
    before.tier === after.tier &&
    before.division === after.division &&
    after.wins >= before.wins &&
    after.losses >= before.losses
  );
}

export function rankTrajectory(history: RankSnapshot[]) {
  const data: { time: number; value: number | null; label: string; official: boolean }[] = [];
  const counts = timestampCounts(history);
  history.forEach((point, index) => {
    const time = Date.parse(point.timestamp);
    const previous = history[index - 1];
    if (
      previous &&
      (!comparableRankInterval(previous, point) ||
        counts.get(time) !== 1 ||
        counts.get(Date.parse(previous.timestamp)) !== 1)
    ) {
      const previousTime = Date.parse(previous.timestamp);
      // Explicit null breaks the path without changing either official endpoint.
      if (Number.isFinite(time) || Number.isFinite(previousTime))
        data.push({
          time: !Number.isFinite(time)
            ? previousTime
            : Number.isFinite(previousTime)
              ? (previousTime + time) / 2
              : time,
          value: null,
          label: "Intervalo indeterminado",
          official: false,
        });
    }
    if (Number.isFinite(time))
      data.push({
        time,
        value: validRankObservation(point) ? chartRankCoordinate(point) : null,
        label: `${rankLabel(point)} · ${point.leaguePoints} LP`,
        official: true,
      });
  });
  return data;
}

export type RankCursor = { time: number; value: number; label: string; official: boolean };

function timestampCounts(history: RankSnapshot[]) {
  const counts = new Map<number, number>();
  for (const point of history) {
    const time = Date.parse(point.timestamp);
    counts.set(time, (counts.get(time) ?? 0) + 1);
  }
  return counts;
}

/** Interpolation is ephemeral display data. Never persist it or include it in summaries. */
export function rankAtTime(history: RankSnapshot[], time: number): RankCursor | null {
  const exact = history.filter((p) => Date.parse(p.timestamp) === time);
  if (exact.length === 1 && validRankObservation(exact[0])) {
    const point = exact[0];
    return {
      time,
      value: chartRankCoordinate(point)!,
      label: `${rankLabel(point)} · ${point.leaguePoints} LP`,
      official: true,
    };
  }
  if (exact.length) return null;
  const counts = timestampCounts(history);
  for (let i = 1; i < history.length; i++) {
    const before = history[i - 1],
      after = history[i];
    const from = Date.parse(before.timestamp),
      to = Date.parse(after.timestamp);
    if (
      time <= from ||
      time >= to ||
      !comparableRankInterval(before, after) ||
      counts.get(from) !== 1 ||
      counts.get(to) !== 1
    )
      continue;
    const fraction = (time - from) / (to - from);
    const start = chartRankCoordinate(before)!;
    const value = start + (chartRankCoordinate(after)! - start) * fraction;
    // Invert the existing apex chart band so the tooltip stays on the drawn line.
    const tier = TIERS.indexOf(before.tier as Tier);
    const band = value - (28 + tier - 7);
    const lp =
      tier >= 7
        ? (1000 * band) / (1 - band)
        : before.leaguePoints + (after.leaguePoints - before.leaguePoints) * fraction;
    return {
      time,
      value,
      label: `${rankLabel(before)} · ≈ ${lp.toLocaleString("es-CL", { maximumFractionDigits: 1 })} LP`,
      official: false,
    };
  }
  return null;
}
