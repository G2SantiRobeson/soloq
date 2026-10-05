export type Totals = {
  games: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  duration: number;
  damage: number;
};
export const emptyTotals = (): Totals => ({
  games: 0,
  wins: 0,
  losses: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  cs: 0,
  duration: 0,
  damage: 0,
});
export const winrate = (wins: number, losses: number) =>
  wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
export const kda = (kills: number, deaths: number, assists: number) =>
  (kills + assists) / Math.max(1, deaths);
export const killParticipation = (kills: number, assists: number, teamKills: number) =>
  teamKills > 0 ? Math.min(1, (kills + assists) / teamKills) : null;
export type MatchStat = {
  win: boolean;
  isRemake?: boolean | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  duration: number;
  damage: number;
};
export function aggregate(matches: MatchStat[]): Totals {
  return matches
    .filter((m) => !m.isRemake)
    .reduce(
      (s, m) => ({
        games: s.games + 1,
        wins: s.wins + Number(m.win),
        losses: s.losses + Number(!m.win),
        kills: s.kills + m.kills,
        deaths: s.deaths + m.deaths,
        assists: s.assists + m.assists,
        cs: s.cs + m.cs,
        duration: s.duration + m.duration,
        damage: s.damage + m.damage,
      }),
      emptyTotals(),
    );
}
