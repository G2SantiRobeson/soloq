import type { PublicPlayer } from "./types";
import type { View } from "./queues";
import { kda, winrate } from "./stats";
import { rankSortValue } from "./ranking";
export const HIGHLIGHT_MIN_GAMES = 10;
export const RECENT_FORM_GAMES = 20;

export type RecentForm = { playerId: string; games: number; wins: number };
export function recentHighlights(players: PublicPlayer[], form: RecentForm[]) {
  const eligible = form.filter((r) => r.games >= HIGHLIGHT_MIN_GAMES);
  const strongest = eligible.toSorted(
    (a, b) =>
      b.wins / b.games - a.wins / a.games ||
      b.games - a.games ||
      a.playerId.localeCompare(b.playerId),
  )[0];
  const comparable = players.filter(
    (p) => p.momentum?.net != null && p.momentum.games >= HIGHLIGHT_MIN_GAMES,
  );
  return {
    form: strongest
      ? { ...strongest, player: players.find((p) => p.id === strongest.playerId) }
      : null,
    climb:
      comparable
        .filter((p) => p.momentum!.net! > 0)
        .toSorted((a, b) => b.momentum!.net! - a.momentum!.net! || a.id.localeCompare(b.id))[0] ??
      null,
    drop:
      comparable
        .filter((p) => p.momentum!.net! < 0)
        .toSorted((a, b) => a.momentum!.net! - b.momentum!.net! || a.id.localeCompare(b.id))[0] ??
      null,
  };
}
export function globalMetrics(
  players: PublicPlayer[],
  view: View,
  source: "ranked" | "matches" = "ranked",
) {
  const records = players.flatMap((player) => {
    if (source === "ranked" && view !== "5v5" && rankSortValue(player.rank) < 0) return [];
    const record = source === "matches" || view === "5v5" ? player.stats : player.rank!;
    return [
      {
        player,
        games: record.wins + record.losses,
        wins: record.wins,
        losses: record.losses,
        rate: winrate(record.wins, record.losses),
      },
    ];
  });
  const sorted = (rows: typeof records, value: (r: (typeof records)[number]) => number) =>
    [...rows].sort(
      (a, b) => value(b) - value(a) || a.player.gameName.localeCompare(b.player.gameName),
    )[0] ?? null;
  const combat = players.filter((p) => p.stats.games > 0);
  const combined = combat.reduce(
    (s, p) => ({
      kills: s.kills + p.stats.kills,
      deaths: s.deaths + p.stats.deaths,
      assists: s.assists + p.stats.assists,
    }),
    { kills: 0, deaths: 0, assists: 0 },
  );
  const wins = records.reduce((s, r) => s + r.wins, 0),
    losses = records.reduce((s, r) => s + r.losses, 0);
  return {
    participants: players.length,
    rankedParticipants: players.filter((p) => rankSortValue(p.rank) >= 0).length,
    highestLp:
      view === "5v5"
        ? null
        : sorted(
            records.filter((r) => rankSortValue(r.player.rank) >= 0),
            (r) => r.player.rank!.leaguePoints,
          ),
    leader:
      view === "5v5"
        ? null
        : sorted(
            records.filter((r) => rankSortValue(r.player.rank) >= 0),
            (r) => rankSortValue(r.player.rank),
          ),
    bestWinrate: sorted(
      records.filter((r) => r.games >= HIGHLIGHT_MIN_GAMES),
      (r) => r.rate,
    ),
    mostGames: sorted(
      records.filter((r) => r.games > 0),
      (r) => r.games,
    ),
    bestKda:
      [...combat]
        .filter((p) => p.stats.games >= HIGHLIGHT_MIN_GAMES)
        .sort(
          (a, b) =>
            kda(b.stats.kills, b.stats.deaths, b.stats.assists) -
              kda(a.stats.kills, a.stats.deaths, a.stats.assists) ||
            a.gameName.localeCompare(b.gameName),
        )[0] ?? null,
    winrate: wins + losses ? winrate(wins, losses) : null,
    kda: combat.length ? kda(combined.kills, combined.deaths, combined.assists) : null,
    averageGames: records.length ? (wins + losses) / records.length : null,
  };
}
