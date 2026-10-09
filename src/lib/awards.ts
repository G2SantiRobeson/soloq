import type { PublicPlayer } from "./types";
import type { View } from "./queues";
import { HIGHLIGHT_MIN_GAMES, RECENT_FORM_GAMES } from "./global-metrics";
import { signedLp } from "./lp-metrics";

export type ResultSequence = { playerId: string; results: boolean[] };
export type Award = {
  key: string;
  title: string;
  player: PublicPlayer | null;
  value: string;
  detail?: string;
  empty: string;
  criterion: string;
  partial: boolean;
};
export type AwardMatchStats = {
  playerId: string;
  games: number;
  champions: number;
  zeroKills: number;
  winStreak: number;
  lossStreak: number;
  cs: number;
  duration: number;
  damage: number;
  deaths: number;
  assists: number;
};
export type AwardLpInterval = { playerId: string; delta: number; from: string; to: string };

export function longestStreaks(results: readonly boolean[]) {
  let win = 0,
    loss = 0,
    run = 0;
  for (let i = 0; i < results.length; i++) {
    run = i > 0 && results[i] === results[i - 1] ? run + 1 : 1;
    if (results[i]) win = Math.max(win, run);
    else loss = Math.max(loss, run);
  }
  return { win, loss };
}
export function recentResults(results: readonly boolean[]) {
  return results.slice(-RECENT_FORM_GAMES).toReversed();
}
type Scored = { player: PublicPlayer; score: number; games: number };
/** Deterministic tie breaks: score, sample size, name, ID. */
function rank<T extends Scored>(rows: T[], direction: "high" | "low") {
  return rows.toSorted(
    (a, b) =>
      (direction === "high" ? b.score - a.score : a.score - b.score) ||
      b.games - a.games ||
      a.player.gameName.localeCompare(b.player.gameName) ||
      a.player.id.localeCompare(b.player.id),
  );
}
export type FormRow = { player: PublicPlayer; games: number; wins: number; results: boolean[] };
export function formRanking(players: PublicPlayer[], sequences: ResultSequence[]): FormRow[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  return rank(
    sequences.flatMap(({ playerId, results }) => {
      const player = byId.get(playerId),
        recent = recentResults(results);
      if (!player || recent.length < HIGHLIGHT_MIN_GAMES) return [];
      const wins = recent.filter(Boolean).length;
      return [{ player, games: recent.length, wins, results: recent, score: wins / recent.length }];
    }),
    "high",
  ).map(({ player, games, wins, results }) => ({ player, games, wins, results }));
}
export function formExtremes(rows: FormRow[], size = 3) {
  const top = rows.slice(0, size);
  return { top, bottom: rows.slice(top.length).slice(-size).toReversed() };
}
function partial(player: PublicPlayer | undefined) {
  return (
    !!player?.seasonHistory &&
    (player.seasonHistory.status !== "completed" || player.seasonHistory.unavailable > 0)
  );
}

/** Match aggregates and official intervals are scoped to the selected queue and period upstream. */
export function computeAwards(
  players: PublicPlayer[],
  view: View,
  stats: AwardMatchStats[],
  intervals: AwardLpInterval[],
): { honor: Award[]; shame: Award[] } {
  const byId = new Map(players.map((p) => [p.id, p]));
  const eligible = stats.flatMap((s) => {
    const player = byId.get(s.playerId);
    return player && s.games >= HIGHLIGHT_MIN_GAMES ? [{ player, stats: s }] : [];
  });
  const scores = (value: (s: AwardMatchStats) => number) =>
    eligible.flatMap((r) => {
      const score = value(r.stats);
      return Number.isFinite(score) && score >= 0
        ? [{ player: r.player, score, games: r.stats.games }]
        : [];
    });
  const farming = scores((s) => (s.duration > 0 ? (s.cs * 60) / s.duration : NaN));
  const damage = scores((s) => (s.duration > 0 ? (s.damage * 60) / s.duration : NaN));
  const minimum =
    "Mínimo 10 partidas válidas en la cola y período seleccionados. Remakes excluidos. Empates: más partidas, nombre y luego ID.";
  const make = (
    key: string,
    title: string,
    rows: Scored[],
    direction: "high" | "low",
    negative: boolean,
    format: (score: number) => string,
    criterion: string,
    minimumScore = 0,
  ): Award => {
    const candidate = !negative || rows.length >= 2 ? rank(rows, direction)[0] : undefined;
    const row =
      candidate && candidate.score >= minimumScore && (key !== "zero-kills" || candidate.score > 0)
        ? candidate
        : undefined;
    return {
      key,
      title,
      player: row?.player ?? null,
      value: row ? format(row.score) : "—",
      detail: row ? row.games + " partidas" : undefined,
      empty:
        candidate && key === "zero-kills" && candidate.score === 0
          ? "Nadie terminó una partida sin kills"
          : minimumScore && candidate
            ? "Sin rachas de 2 o más"
            : negative
              ? "Hacen falta 2 jugadores con 10 partidas válidas"
              : "Sin muestra de 10 partidas válidas",
      criterion:
        criterion +
        " " +
        minimum +
        (negative ? " Requiere al menos dos jugadores elegibles para esta métrica." : ""),
      partial: partial(row?.player),
    };
  };
  const lp =
    view === "5v5"
      ? []
      : eligible.flatMap(({ player, stats }) =>
          intervals
            .filter((i) => i.playerId === player.id && Number.isFinite(i.delta))
            .map((i) => ({ player, score: i.delta, games: stats.games, interval: i })),
        );
  const lpPlayers = new Set(lp.map((r) => r.player.id)).size;
  const date = (iso: string) =>
    new Date(iso).toLocaleString("es-CL", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const lpAward = (negative: boolean): Award => {
    const candidates = lp.filter((r) => (negative ? r.score < 0 : r.score > 0));
    const row =
      !negative || lpPlayers >= 2
        ? candidates.toSorted(
            (a, b) =>
              (negative ? a.score - b.score : b.score - a.score) ||
              b.games - a.games ||
              a.player.gameName.localeCompare(b.player.gameName) ||
              a.player.id.localeCompare(b.player.id) ||
              b.interval.to.localeCompare(a.interval.to) ||
              b.interval.from.localeCompare(a.interval.from),
          )[0]
        : undefined;
    return {
      key: negative ? "worst-drop" : "best-climb",
      title: negative ? "Caída libre" : "Escalador",
      player: row?.player ?? null,
      value: row ? signedLp(row.score) + " LP" : "—",
      detail: row ? date(row.interval.from) + " → " + date(row.interval.to) + " UTC" : undefined,
      empty:
        negative && lpPlayers < 2
          ? "Hacen falta 2 jugadores con intervalos comparables"
          : lp.length
            ? negative
              ? "Sin bajadas observadas"
              : "Sin subidas observadas"
            : "Sin intervalos oficiales comparables",
      criterion:
        "Mayor " +
        (negative ? "pérdida" : "subida") +
        " en un único intervalo entre snapshots oficiales: mismo tier y división, sin reinicio de contadores ni huecos de más de 7 días. Ambos extremos deben estar dentro del período. No es LP por partida; puede incluir ajustes. " +
        minimum +
        (negative
          ? " Requiere dos jugadores con intervalos comparables, aunque solo uno haya bajado."
          : ""),
      partial: partial(row?.player),
    };
  };
  return {
    honor: [
      make(
        "win-streak",
        "Imparable",
        scores((s) => s.winStreak),
        "high",
        false,
        (v) => v + " seguidas",
        "Mayor racha de victorias consecutivas del historial importado del período. Los remakes se ignoran sin cortar la racha.",
        2,
      ),
      view === "5v5"
        ? make(
            "most-assists",
            "Ángel de la Grieta",
            scores((s) => s.assists / s.games),
            "high",
            false,
            (v) => v.toFixed(1) + " asist.",
            "Asistencias totales / partidas válidas; premia el apoyo al equipo.",
          )
        : lpAward(false),
      make(
        "champion-diversity",
        "Arsenal infinito",
        scores((s) => s.champions),
        "high",
        false,
        (v) => v + " campeones",
        "Número de IDs de campeón distintos utilizados en partidas válidas del período.",
      ),
      make(
        "best-farm",
        "Rey del farmeo",
        farming,
        "high",
        false,
        (v) => v.toFixed(2) + " CS/min",
        "CS total × 60 / duración total en segundos. Media ponderada por duración, no promedio de ratios individuales.",
      ),
      make(
        "damage-per-minute",
        "Máquina de daño",
        damage,
        "high",
        false,
        (v) => v.toLocaleString("es-CL", { maximumFractionDigits: 0 }) + " daño/min",
        "Daño total a campeones × 60 / duración total en segundos. Media ponderada por duración.",
      ),
    ],
    shame: [
      make(
        "loss-streak",
        "La maldición",
        scores((s) => s.lossStreak),
        "high",
        true,
        (v) => v + " seguidas",
        "Mayor racha de derrotas consecutivas del período. Los remakes se ignoran sin cortar la racha.",
        2,
      ),
      view === "5v5"
        ? make(
            "least-assists",
            "¿Y el equipo?",
            scores((s) => s.assists / s.games),
            "low",
            true,
            (v) => v.toFixed(1) + " asist.",
            "Menor promedio de asistencias por partida válida; compara el juego en equipo.",
          )
        : lpAward(true),
      make(
        "most-deaths",
        "Imán de habilidades",
        scores((s) => s.deaths / s.games),
        "high",
        true,
        (v) => v.toFixed(1) + " muertes",
        "Muertes totales / partidas válidas del período.",
      ),
      make(
        "worst-farm",
        "La cosecha perdida",
        farming,
        "low",
        true,
        (v) => v.toFixed(2) + " CS/min",
        "Menor CS total × 60 / duración total en segundos. Compara roles distintos; no evalúa la calidad personal del jugador.",
      ),
      make(
        "zero-kills",
        "Pacifista involuntario",
        scores((s) => (100 * s.zeroKills) / s.games),
        "high",
        true,
        (v) => v.toFixed(1) + "% sin kills",
        "Partidas con exactamente cero asesinatos / partidas válidas. El rol influye; no mide el aporte al equipo.",
      ),
    ],
  };
}
