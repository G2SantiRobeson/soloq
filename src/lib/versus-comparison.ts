import type { PublicPlayer } from "./types";
import type { View } from "./queues";
import { rankedQueue } from "./queues";
import { hasRivalRank, rivalProximity, type Rivalry } from "./rivalries";
import { manualComparison } from "./manual-rival";
import { rivalComparisonLabel } from "./rival-comparison-label";
import { rankLabel } from "./ranking";
import { kda, winrate } from "./stats";
import { summarizeLp, signedLp } from "./lp-metrics";
import { detectRivalryDynamics } from "./rivalry-dynamics";
import { detectLeadershipChange } from "./rivalry-leadership";
import { rivalryTimeline } from "./rivalry-timeline";

export type VersusMetric = {
  key: string;
  label: string;
  values: readonly [string, string];
  higherId: string | null;
  verdict: string;
  note: string;
};
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
const number = (value: number, digits = 0) =>
  value.toLocaleString("es-CL", { maximumFractionDigits: digits });
const rounded = (value: number, digits: number) => Number(value.toFixed(digits));
const higher = (
  a: number | null,
  b: number | null,
  players: readonly [PublicPlayer, PublicPlayer],
) => (a === null || b === null || a === b ? null : players[a > b ? 0 : 1].id);
const statsAvailable = (p: PublicPlayer) =>
  p.stats &&
  [p.stats.games, p.stats.wins, p.stats.losses].every(count) &&
  p.stats.games > 0 &&
  p.stats.wins + p.stats.losses === p.stats.games;

/** Weekly LP is displayed only if an existing same-rank segment backs the exact weekly interval.
 * A normalized rank coordinate across promotions is deliberately not relabelled as raw LP. */
export function versusWeeklyLp(p: PublicPlayer, view: View) {
  const w = p.weeklySummary;
  const queue = rankedQueue(view);
  if (
    !w ||
    !queue ||
    !Number.isSafeInteger(w.net) ||
    !Number.isFinite(Date.parse(w.from)) ||
    !Number.isFinite(Date.parse(w.to)) ||
    Date.parse(w.from) >= Date.parse(w.to) ||
    Date.parse(w.to) > Date.parse(p.observedAt) ||
    !Number.isFinite(Date.parse(p.observedAt))
  )
    return null;
  const points = (p.weeklyRivalryHistory ?? p.rivalryHistory ?? []).filter(
    (s) =>
      Date.parse(s.timestamp) >= Date.parse(w.from) && Date.parse(s.timestamp) <= Date.parse(w.to),
  );
  const fromHistory =
    points.length >= 2 && points.every((s) => s.queue === queue) ? summarizeLp(points) : null;
  const segment =
    fromHistory?.from === w.from && fromHistory.to === w.to ? fromHistory : p.momentum;
  return segment?.from === w.from && segment.to === w.to && segment.net === w.net ? w : null;
}

/** Presentation of existing per-queue, season aggregates. No global winner or new score. */
export function versusMetrics(
  players: readonly [PublicPlayer, PublicPlayer],
  view: View,
): VersusMetric[] {
  const [a, b] = players;
  if (!rankedQueue(view) || a.platform !== b.platform || a.id === b.id) return [];
  const rank = manualComparison(a, b);
  const label = rivalComparisonLabel(a, b);
  const ranked = players.map((p) => hasRivalRank(p) && Number.isSafeInteger(p.rank.leaguePoints));
  const sameRank = ranked.every(Boolean) && rankLabel(a.rank) === rankLabel(b.rank);
  const available = players.map(statsAvailable);
  const wr = players.map((p, i) =>
    available[i] ? rounded(winrate(p.stats.wins, p.stats.losses), 1) : null,
  );
  const ratios = players.map((p, i) =>
    available[i] &&
    [p.stats.kills, p.stats.deaths, p.stats.assists].every(count) &&
    Number.isSafeInteger(p.stats.kills + p.stats.assists)
      ? rounded(kda(p.stats.kills, p.stats.deaths, p.stats.assists), 2)
      : null,
  );
  const weekly = players.map((p) => versusWeeklyLp(p, view));
  const weeklyComparable =
    weekly[0] &&
    weekly[1] &&
    !weekly[0].partial &&
    !weekly[1].partial &&
    weekly[0].from === weekly[1].from &&
    weekly[0].to === weekly[1].to;
  const verdict = (values: readonly (number | null)[]) =>
    values.some((v) => v === null)
      ? "Comparación no disponible"
      : values[0] === values[1]
        ? "Igual valor mostrado"
        : "Mayor valor en su muestra";
  return [
    {
      key: "rank",
      label: "Rango actual",
      values: players.map((p) => (hasRivalRank(p) ? rankLabel(p.rank) : "Sin rango")) as [
        string,
        string,
      ],
      higherId: sameRank ? null : rank.leaderId,
      verdict: ranked.every(Boolean)
        ? sameRank
          ? "Mismo rango registrado"
          : rank.leaderId
            ? "Rango superior"
            : "Empate de clasificación"
        : "Sin rango comparable",
      note: "Rango registrado de esta modalidad. No define un ganador del VS.",
    },
    {
      key: "lp",
      label: "LP actuales",
      values: players.map((p, i) => (ranked[i] ? number(p.rank!.leaguePoints) + " LP" : "—")) as [
        string,
        string,
      ],
      higherId:
        rank.gap === null ? null : higher(a.rank!.leaguePoints, b.rank!.leaguePoints, players),
      verdict:
        rank.gap === null
          ? "Distancia en LP no comparable"
          : rank.gap === 0
            ? "Mismos LP registrados"
            : "Diferencia: " + number(rank.gap) + " LP",
      note: label.crossApex
        ? "Resta directa entre categorías Apex; se conservan sus tiers oficiales. No indica LP necesarios para ascender."
        : label.kind === "lp"
          ? "Diferencia dentro del mismo tier y división."
          : label.text,
    },
    {
      key: "winrate",
      label: "Winrate",
      values: wr.map((v) => (v === null ? "—" : number(v, 1) + " %")) as [string, string],
      higherId: higher(wr[0], wr[1], players),
      verdict: verdict(wr),
      note: "Victorias / (victorias + derrotas) en la muestra importada de cada jugador.",
    },
    {
      key: "record",
      label: "Victorias / derrotas",
      values: players.map((p, i) =>
        available[i] ? number(p.stats.wins) + " V / " + number(p.stats.losses) + " D" : "—",
      ) as [string, string],
      higherId: null,
      verdict: "Volumen, sin ventaja atribuida",
      note: "Más partidas importadas no implican mejor rendimiento ni la misma cobertura.",
    },
    {
      key: "kda",
      label: "KDA",
      values: ratios.map((v) => (v === null ? "—" : number(v, 2))) as [string, string],
      higherId: higher(ratios[0], ratios[1], players),
      verdict: verdict(ratios),
      note: "(Asesinatos + asistencias) / máx(1, muertes), sobre cada muestra importada.",
    },
    {
      key: "weekly",
      label: "Cambio semanal de LP",
      values: weekly.map((w) =>
        w ? signedLp(w.net) + " LP" + (w.partial ? " · parcial" : "") : "—",
      ) as [string, string],
      higherId: weeklyComparable ? higher(weekly[0]!.net, weekly[1]!.net, players) : null,
      verdict: weeklyComparable
        ? verdict([weekly[0]!.net, weekly[1]!.net])
        : "Sin intervalos equivalentes acreditados",
      note: "Solo snapshots oficiales del mismo rango. Intervalos distintos o parciales se muestran por separado, sin atribuir ventaja.",
    },
  ];
}

export function versusMoment(players: readonly [PublicPlayer, PublicPlayer], view: View) {
  const proximity = rivalProximity(...players, view);
  const asOf = players
    .map((p) => p.observedAt)
    .toSorted((a, b) => Date.parse(a) - Date.parse(b))[0];
  if (
    !proximity ||
    !hasRivalRank(players[0]) ||
    !hasRivalRank(players[1]) ||
    players.some((p) => !Number.isFinite(Date.parse(p.observedAt)))
  )
    return null;
  const rivalry: Rivalry = {
    players: [players[0], players[1]],
    queue: proximity.queue,
    proximity: proximity.proximity,
    lpDifference: proximity.lpDifference,
  };
  return {
    rivalry,
    asOf,
    event: detectRivalryDynamics(rivalry, view, { asOf }),
    hasHistory:
      !!detectLeadershipChange(...rivalry.players, view, { asOf }) ||
      rivalryTimeline(rivalry, view, { asOf }).length > 0,
  };
}
