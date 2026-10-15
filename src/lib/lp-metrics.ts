import { rankProgress, TIERS, type Rank, type Tier } from "./ranking";
import { rankedQueue, type RankedQueue, type View } from "./queues";
import { seasonStart } from "./season";
import type { Platform } from "./routing";
export type RankSnapshot = Rank & { timestamp: string; queue?: RankedQueue };
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
 * Latest comparable segment, at most 30 observations. Rank transitions end the segment.
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
    if (before.tier !== after.tier || before.division !== after.division) break;
    const delta = after.leaguePoints - before.leaguePoints;
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

/** Official endpoint displacement. Intermediate observations must not hide resets/placements. */
export function observedRankInterval(
  points: RankSnapshot[],
  platform: Platform = "LA2",
  now = new Date(),
  queue?: RankedQueue,
) {
  if (points.length < 2) return null;
  const season = seasonStart(platform).getTime();
  for (let i = 0; i < points.length; i++) {
    const point = points[i],
      previous = points[i - 1];
    const time = Date.parse(point.timestamp);
    if (
      !valid(point) ||
      rankProgress(point) === null ||
      time < season ||
      time > now.getTime() ||
      (queue && point.queue !== queue) ||
      (previous &&
        (time <= Date.parse(previous.timestamp) ||
          point.wins < previous.wins ||
          point.losses < previous.losses ||
          point.queue !== previous.queue))
    )
      return null;
  }
  const before = points[0],
    after = points.at(-1)!;
  return {
    net: rankProgress(after)! - rankProgress(before)!,
    wins: after.wins - before.wins,
    losses: after.losses - before.losses,
    from: before.timestamp,
    to: after.timestamp,
  };
}

export type FiveMatchLp = {
  net: number | null;
  from: string | null;
  to: string | null;
  reason: string;
};
type FormMatch = {
  matchId: string;
  queueId?: number;
  timestamp?: string;
  duration?: number;
  win: boolean;
  isRemake?: boolean | null;
};
/** Use the displayed five, plus the immediately preceding match to detect a wider interval. */
export function lastFiveRankDelta(
  history: RankSnapshot[],
  matches: FormMatch[],
  view: View,
  platform: Platform = "LA2",
  now = new Date(),
): FiveMatchLp {
  const unavailable = (reason: string): FiveMatchLp => ({
    net: null,
    from: null,
    to: null,
    reason,
  });
  const queue = rankedQueue(view),
    queueId = view === "soloq" ? 420 : 440;
  const five = matches.slice(0, 5);
  if (!queue || five.length !== 5)
    return unavailable("Se necesitan las cinco partidas visibles de la misma modalidad.");
  if (
    new Set(five.map((m) => m.matchId)).size !== 5 ||
    five.some(
      (m) =>
        m.queueId !== queueId ||
        !Number.isFinite(Date.parse(m.timestamp ?? "")) ||
        !Number.isInteger(m.duration) ||
        m.duration! <= 0 ||
        typeof m.isRemake !== "boolean" ||
        Date.parse(m.timestamp!) < seasonStart(platform).getTime() ||
        Date.parse(m.timestamp!) + m.duration! * 1000 > now.getTime(),
    )
  )
    return unavailable("Faltan fechas, duración o clasificación de remakes verificables.");
  const first = Math.min(...five.map((m) => Date.parse(m.timestamp!)));
  const last = Math.max(...five.map((m) => Date.parse(m.timestamp!) + m.duration! * 1000));
  const chronological = five.toSorted(
    (a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!),
  );
  if (
    chronological.some(
      (m, i) =>
        i > 0 &&
        Date.parse(m.timestamp!) <
          Date.parse(chronological[i - 1].timestamp!) + chronological[i - 1].duration! * 1000,
    ) ||
    history.some((s) => !Number.isFinite(Date.parse(s.timestamp)))
  )
    return unavailable("Fechas de partidas u observaciones incompatibles.");
  const ordered = history.toSorted((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const before = ordered.findLastIndex((s) => Date.parse(s.timestamp) < first);
  const post = ordered.findIndex((s) => Date.parse(s.timestamp) >= last);
  if (before < 0 || post <= before)
    return unavailable(
      "Faltan observaciones oficiales que delimiten exactamente las cinco partidas.",
    );
  const counted = five.filter((m) => !m.isRemake);
  const wins = counted.filter((m) => m.win).length,
    losses = counted.length - wins;
  // An early LEAGUE check may still lag the last completed game; use the first
  // later observation whose official counters cover the entire displayed form.
  const after = ordered.findIndex(
    (s, index) =>
      index >= post &&
      s.wins - ordered[before].wins === wins &&
      s.losses - ordered[before].losses === losses,
  );
  if (after < 0)
    return unavailable(
      "Los contadores oficiales no aíslan esas cinco partidas; el intervalo puede incluir partidas adicionales o cobertura incompleta.",
    );
  const interval = observedRankInterval(ordered.slice(before, after + 1), platform, now, queue);
  if (!interval || !observedRankInterval(ordered.slice(before), platform, now, queue))
    return unavailable("Observaciones incompatibles, colocaciones, reset o contadores inválidos.");
  const from = Date.parse(interval.from),
    to = Date.parse(interval.to);
  const extra = matches
    .slice(5)
    .some(
      (m) =>
        !Number.isFinite(Date.parse(m.timestamp ?? "")) ||
        !Number.isInteger(m.duration) ||
        (Date.parse(m.timestamp ?? "") + (m.duration ?? 0) * 1000 > from &&
          Date.parse(m.timestamp ?? "") <= to),
    );
  const prematureCounters = ordered.slice(before, after + 1).some((s) => {
    const completed = counted.filter(
      (m) => Date.parse(m.timestamp!) + m.duration! * 1000 <= Date.parse(s.timestamp),
    );
    return (
      s.wins - ordered[before].wins > completed.filter((m) => m.win).length ||
      s.losses - ordered[before].losses > completed.filter((m) => !m.win).length
    );
  });
  if (
    extra ||
    prematureCounters ||
    (!counted.length && interval.net !== 0) ||
    interval.wins !== counted.filter((m) => m.win).length ||
    interval.losses !== counted.filter((m) => !m.win).length
  )
    return unavailable(
      "Los contadores oficiales no aíslan esas cinco partidas; el intervalo puede incluir partidas adicionales.",
    );
  return {
    net: interval.net,
    from: interval.from,
    to: interval.to,
    reason:
      "Variación neta observada entre verificaciones oficiales, no LP individuales de MATCH-V5. Los remakes no cuentan como victorias o derrotas.",
  };
}
