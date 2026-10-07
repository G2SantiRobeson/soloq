import type { PublicPlayer } from "./types";
import type { View } from "./queues";
import { HIGHLIGHT_MIN_GAMES, RECENT_FORM_GAMES } from "./global-metrics";
import { kda, winrate } from "./stats";
import { signedLp } from "./lp-metrics";

/** Chronological results (oldest first) of each player in the selected queue and period. */
export type ResultSequence = { playerId: string; results: boolean[] };

export type Award = {
  key: string;
  title: string;
  player: PublicPlayer | null;
  value: string;
  detail?: string;
  /** One-line empty state when nobody qualifies. */
  empty: string;
};

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

/** Last results, most recent first, capped at the recent-form window. */
export function recentResults(results: readonly boolean[]) {
  return results.slice(-RECENT_FORM_GAMES).toReversed();
}

type Scored = { player: PublicPlayer; score: number; games: number; wins?: number };
/** Deterministic ranking: score, then more games, then name, then id. */
function rank(rows: Scored[], direction: "high" | "low") {
  return rows.toSorted(
    (a, b) =>
      (direction === "high" ? b.score - a.score : a.score - b.score) ||
      b.games - a.games ||
      a.player.gameName.localeCompare(b.player.gameName) ||
      a.player.id.localeCompare(b.player.id),
  );
}

export type FormRow = { player: PublicPlayer; games: number; wins: number; results: boolean[] };
/** Players with enough recent games, best recent winrate first. */
export function formRanking(players: PublicPlayer[], sequences: ResultSequence[]): FormRow[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const rows = sequences.flatMap(({ playerId, results }) => {
    const player = byId.get(playerId);
    const recent = recentResults(results);
    if (!player || recent.length < HIGHLIGHT_MIN_GAMES) return [];
    const wins = recent.filter(Boolean).length;
    return [{ player, games: recent.length, wins, results: recent }];
  });
  return rank(
    rows.map((r) => ({ player: r.player, score: r.wins / r.games, games: r.games })),
    "high",
  ).map(({ player }) => rows.find((r) => r.player === player)!);
}

/** Top and bottom of the form ranking without showing anyone twice. */
export function formExtremes(rows: FormRow[], size = 3) {
  const top = rows.slice(0, size);
  const bottom = rows.slice(top.length).slice(-size).toReversed();
  return { top, bottom };
}

const percent = (value: number) => `${value.toFixed(1)}%`;

export function computeAwards(
  players: PublicPlayer[],
  view: View,
  sequences: ResultSequence[],
): { honor: Award[]; shame: Award[] } {
  const minimum = `Mínimo ${HIGHLIGHT_MIN_GAMES} partidas`;
  const eligible = players.filter((p) => p.stats.games >= HIGHLIGHT_MIN_GAMES);
  const rate = eligible.map((p) => ({
    player: p,
    score: winrate(p.stats.wins, p.stats.losses),
    games: p.stats.games,
  }));
  const ratio = eligible.map((p) => ({
    player: p,
    score: kda(p.stats.kills, p.stats.deaths, p.stats.assists),
    games: p.stats.games,
  }));
  const deaths = eligible.map((p) => ({
    player: p,
    score: p.stats.deaths / p.stats.games,
    games: p.stats.games,
  }));
  const form = formRanking(players, sequences);
  const lp =
    view === "5v5"
      ? []
      : players
          .filter((p) => p.momentum?.net != null && p.momentum.games >= HIGHLIGHT_MIN_GAMES)
          .map((p) => ({ player: p, score: p.momentum!.net!, games: p.momentum!.games }));
  const byId = new Map(players.map((p) => [p.id, p]));
  const streaks = sequences.flatMap(({ playerId, results }) => {
    const player = byId.get(playerId);
    return player ? [{ player, ...longestStreaks(results), games: results.length }] : [];
  });
  // A "worst" award needs a real comparison: with one eligible player it would just repeat the best.
  const pair = <T>(rows: T[]) => rows.length >= 2;
  const award = (
    key: string,
    title: string,
    row: Scored | undefined,
    value: (r: Scored) => string,
    detail: (r: Scored) => string | undefined,
    empty: string,
  ): Award => ({
    key,
    title,
    player: row?.player ?? null,
    value: row ? value(row) : "—",
    detail: row ? detail(row) : undefined,
    empty,
  });
  const record = (r: Scored) => `${r.player.stats.wins} V / ${r.player.stats.losses} D`;
  const formRow = (row: FormRow | undefined) =>
    row && { player: row.player, score: row.wins / row.games, games: row.games, wins: row.wins };
  const formDetail = (r: Scored) => `${r.wins} V / ${r.games - (r.wins ?? 0)} D`;
  const bestStreak = rank(
    streaks
      .filter((s) => s.win >= 2)
      .map((s) => ({ player: s.player, score: s.win, games: s.games })),
    "high",
  )[0];
  const worstStreak = rank(
    streaks
      .filter((s) => s.loss >= 2)
      .map((s) => ({ player: s.player, score: s.loss, games: s.games })),
    "high",
  )[0];
  const honor: Award[] = [
    award(
      "best-winrate",
      "Mejor winrate",
      rank(rate, "high")[0],
      (r) => percent(r.score),
      record,
      `Nadie llega a ${HIGHLIGHT_MIN_GAMES} partidas`,
    ),
    award(
      "best-kda",
      "Mejor KDA",
      rank(ratio, "high")[0],
      (r) => r.score.toFixed(2),
      () => minimum,
      `Nadie llega a ${HIGHLIGHT_MIN_GAMES} partidas`,
    ),
    award(
      "best-form",
      "Mejor forma",
      formRow(form[0]),
      (r) => percent(r.score * 100),
      formDetail,
      "Sin muestra reciente suficiente",
    ),
    ...(view === "5v5"
      ? []
      : [
          award(
            "best-climb",
            "Mayor subida de LP",
            rank(
              lp.filter((r) => r.score > 0),
              "high",
            )[0],
            (r) => `${signedLp(r.score)} LP`,
            (r) => `${r.games} partidas`,
            "Nadie subió en el período observado",
          ),
        ]),
    award(
      "most-games",
      "Más partidas",
      rank(
        players
          .filter((p) => p.stats.games > 0)
          .map((p) => ({ player: p, score: p.stats.games, games: p.stats.games })),
        "high",
      )[0],
      (r) => String(r.score),
      () => "Partidas del período",
      "Todavía no hay partidas",
    ),
    award(
      "win-streak",
      "Mayor racha de victorias",
      bestStreak,
      (r) => `${r.score} seguidas`,
      () => "En el período",
      "Ninguna racha de 2 o más",
    ),
  ];
  const shame: Award[] = [
    award(
      "worst-winrate",
      "Peor winrate",
      pair(rate) ? rank(rate, "low")[0] : undefined,
      (r) => percent(r.score),
      record,
      "Hacen falta 2 jugadores con muestra",
    ),
    award(
      "worst-kda",
      "Peor KDA",
      pair(ratio) ? rank(ratio, "low")[0] : undefined,
      (r) => r.score.toFixed(2),
      () => minimum,
      "Hacen falta 2 jugadores con muestra",
    ),
    award(
      "worst-form",
      "Peor forma",
      pair(form) ? formRow(form.at(-1)) : undefined,
      (r) => percent(r.score * 100),
      formDetail,
      "Hacen falta 2 jugadores con muestra",
    ),
    ...(view === "5v5"
      ? []
      : [
          award(
            "worst-drop",
            "Mayor caída de LP",
            rank(
              lp.filter((r) => r.score < 0),
              "low",
            )[0],
            (r) => `${signedLp(r.score)} LP`,
            (r) => `${r.games} partidas`,
            "Nadie bajó en el período observado",
          ),
        ]),
    award(
      "most-deaths",
      "Más muertes por partida",
      pair(deaths) ? rank(deaths, "high")[0] : undefined,
      (r) => r.score.toFixed(1),
      () => minimum,
      "Hacen falta 2 jugadores con muestra",
    ),
    award(
      "loss-streak",
      "Mayor racha de derrotas",
      worstStreak,
      (r) => `${r.score} seguidas`,
      () => "En el período",
      "Ninguna racha de 2 o más",
    ),
  ];
  return { honor, shame };
}
