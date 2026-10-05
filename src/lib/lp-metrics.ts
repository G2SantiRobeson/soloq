import { rankProgress, TIERS, type Rank, type Tier } from "./ranking";
export type RankSnapshot = Rank & { timestamp: string };
export const LP_WINDOW = 30;
export type LpMetrics = {
  net: number | null;
  perGame: number | null;
  perWin: number | null;
  perLoss: number | null;
  games: number;
  winsSample: number;
  lossesSample: number;
  intervals: number;
  adjustments: number;
  from: string | null;
  to: string | null;
};
function valid(s: RankSnapshot) {
  return (
    TIERS.includes(s.tier as Tier) &&
    (TIERS.indexOf(s.tier as Tier) >= 7 || ["I", "II", "III", "IV"].includes(s.division)) &&
    [s.leaguePoints, s.wins, s.losses].every((n) => Number.isInteger(n) && n >= 0) &&
    Number.isFinite(Date.parse(s.timestamp))
  );
}
/**
 * Latest continuous segment, at most 30 observations. Coordinates absorb division/tier changes.
 * Counter resets, placements and invalid observations break the segment (never bridge seasons).
 * LP/game uses intervals with games; zero-game decay/adjustments only affect net momentum.
 * LP/win and LP/loss use ONE-game intervals with a compatible sign, including 0 LP.
 * These are observed estimates, never Match-V5 LP rewards: polling may include other adjustments.
 * Do not allocate a mixed multi-game interval to individual wins or losses.
 */
export function summarizeLp(history: RankSnapshot[]): LpMetrics {
  const empty: LpMetrics = {
    net: null,
    perGame: null,
    perWin: null,
    perLoss: null,
    games: 0,
    winsSample: 0,
    lossesSample: 0,
    intervals: 0,
    adjustments: 0,
    from: null,
    to: null,
  };
  const points = history.slice(-LP_WINDOW);
  const latest = points.at(-1);
  if (!latest || !valid(latest)) return empty;
  let net = 0,
    gameDelta = 0,
    winDelta = 0,
    lossDelta = 0;
  const result = { ...empty, to: latest.timestamp };
  for (let i = points.length - 1; i > 0; i--) {
    const before = points[i - 1],
      after = points[i];
    if (
      !valid(before) ||
      !valid(after) ||
      Date.parse(before.timestamp) >= Date.parse(after.timestamp)
    )
      break;
    const wins = after.wins - before.wins,
      losses = after.losses - before.losses;
    if (wins < 0 || losses < 0) break;
    const delta = rankProgress(after)! - rankProgress(before)!;
    const games = wins + losses;
    net += delta;
    result.intervals++;
    result.from = before.timestamp;
    if (!games) {
      result.adjustments += delta;
      continue;
    }
    result.games += games;
    gameDelta += delta;
    if (wins === 1 && losses === 0 && delta >= 0) {
      result.winsSample++;
      winDelta += delta;
    }
    if (losses === 1 && wins === 0 && delta <= 0) {
      result.lossesSample++;
      lossDelta += delta;
    }
  }
  return {
    ...result,
    net: result.intervals ? net : null,
    perGame: result.games ? gameDelta / result.games : null,
    perWin: result.winsSample ? winDelta / result.winsSample : null,
    perLoss: result.lossesSample ? lossDelta / result.lossesSample : null,
  };
}
export function signedLp(value: number, decimals = 0) {
  const rounded = Number(value.toFixed(decimals));
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("es-CL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
