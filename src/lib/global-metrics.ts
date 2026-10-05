import type { PublicPlayer } from "./types";
import type { View } from "./queues";
import { kda, winrate } from "./stats";
import { rankSortValue } from "./ranking";
export const HIGHLIGHT_MIN_GAMES = 10;
export function globalMetrics(players: PublicPlayer[], view: View) {
  const records = players.flatMap((player) => {
    if (view !== "5v5" && rankSortValue(player.rank) < 0) return [];
    const record = view === "5v5" ? player.stats : player.rank!;
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
    rankedParticipants: records.length,
    leader: view === "5v5" ? null : sorted(records, (r) => rankSortValue(r.player.rank)),
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
