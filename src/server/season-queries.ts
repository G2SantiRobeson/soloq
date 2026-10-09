import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { matches, playerMatches, players } from "@/db/schema";
import { queueIds, type View } from "@/lib/queues";
import { type MetricsPeriod } from "@/lib/season";
import type { PerformancePoint, ActivityPoint } from "@/lib/history";
import { continuousActivity } from "@/lib/history";
import { RECENT_FORM_GAMES } from "@/lib/global-metrics";
import type { ResultSequence } from "@/lib/awards";
import { seasonFilter } from "./season-filter";
import { isDemo } from "./env";
import { demoPlayers } from "./demo";
import { getAwardMatchStats, getAwardLpIntervals } from "./award-queries";
import { longestStreaks, type AwardMatchStats, type AwardLpInterval } from "@/lib/awards";
import { comparableRankInterval } from "@/lib/rank-trajectory";
import { periodStart } from "@/lib/season";

export async function getPerformance(id: string, view: View): Promise<PerformancePoint[]> {
  // Compute the rolling last-20 window before selecting the final observation of each UTC day.
  // Database does the windowing; at most ~366 points reach the browser.
  const result = await db().execute(sql`
    with rolling as (
      select ${matches.timestamp} as timestamp, ${matches.id} as id,
        avg(case when ${playerMatches.win} then 100.0 else 0 end) over w as winrate,
        count(*) over w as sample
      from ${playerMatches} join ${matches} on ${matches.id} = ${playerMatches.matchId}
      join ${players} on ${players.id} = ${playerMatches.playerId}
      where ${playerMatches.playerId} = ${id} and ${inArray(matches.queueId, queueIds(view))}
        and ${seasonFilter(matches.timestamp, players.platform)} and coalesce(${matches.isRemake}, false) = false
      window w as (order by ${matches.timestamp}, ${matches.id} rows between 19 preceding and current row)
    ), daily as (
      select *, row_number() over (partition by (timestamp at time zone 'UTC')::date order by timestamp desc, id desc) as n from rolling
    ) select timestamp, winrate, sample from daily where n = 1 order by timestamp`);
  const rows = Array.isArray(result)
    ? result
    : (result as unknown as { rows: Record<string, unknown>[] }).rows;
  return rows.map((r) => ({
    timestamp: new Date(r.timestamp as string).toISOString(),
    winrate: Number(r.winrate),
    sample: Number(r.sample),
  }));
}
export async function getSeasonOverview(view: View, period: MetricsPeriod) {
  const now = Date.now();
  if (isDemo()) {
    const roster = demoPlayers(view, period);
    const games = roster.flatMap((p) => p.recent).filter((m) => !m.isRemake);
    const weeks = new Map<string, ActivityPoint>();
    const champions = new Map<
      number,
      { championId: number; champion: string; games: number; wins: number }
    >();
    for (const m of games) {
      const d = new Date(m.timestamp);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const key = d.toISOString();
      const w = weeks.get(key) ?? { timestamp: key, games: 0, wins: 0, losses: 0 };
      w.games++;
      if (m.win) w.wins++;
      else w.losses++;
      weeks.set(key, w);
      const c = champions.get(m.championId) ?? {
        championId: m.championId,
        champion: m.champion,
        games: 0,
        wins: 0,
      };
      c.games++;
      if (m.win) c.wins++;
      champions.set(c.championId, c);
    }
    return {
      activity: continuousActivity([...weeks.values()]),
      champions: [...champions.values()].sort((a, b) => b.games - a.games).slice(0, 8),
      uniqueGames: new Set(games.map((m) => m.matchId)).size,
      awardStats: roster.map((p): AwardMatchStats => {
        const valid = p.recent.filter((m) => !m.isRemake && m.duration > 0);
        const streaks = longestStreaks(valid.toReversed().map((m) => m.win));
        return {
          playerId: p.id,
          games: valid.length,
          champions: new Set(valid.map((m) => m.championId)).size,
          zeroKills: valid.filter((m) => m.kills === 0).length,
          winStreak: streaks.win,
          lossStreak: streaks.loss,
          cs: valid.reduce((n, m) => n + m.cs, 0),
          duration: valid.reduce((n, m) => n + m.duration, 0),
          damage: valid.reduce((n, m) => n + m.damage, 0),
          deaths: valid.reduce((n, m) => n + m.deaths, 0),
          assists: valid.reduce((n, m) => n + m.assists, 0),
        };
      }),
      lpIntervals:
        view === "5v5"
          ? []
          : roster.flatMap((p): AwardLpInterval[] => {
              const history = p.history.filter(
                (s) =>
                  Date.parse(s.timestamp) >= periodStart(p.platform, period, now).getTime() &&
                  Date.parse(s.timestamp) < now,
              );
              return history.flatMap((after, index) => {
                const before = history[index - 1];
                return before && comparableRankInterval(before, after)
                  ? [
                      {
                        playerId: p.id,
                        delta: after.leaguePoints - before.leaguePoints,
                        from: before.timestamp,
                        to: after.timestamp,
                      },
                    ]
                  : [];
              });
            }),
      recentForm: roster.map((p) => {
        const recent = p.recent.filter((m) => !m.isRemake).slice(0, RECENT_FORM_GAMES);
        return { playerId: p.id, games: recent.length, wins: recent.filter((m) => m.win).length };
      }),
      sequences: roster.map((p): ResultSequence => ({
        playerId: p.id,
        results: p.recent
          .filter((m) => !m.isRemake)
          .slice(0, RECENT_FORM_GAMES)
          .toReversed()
          .map((m) => m.win),
      })),
    };
  }
  const filter = and(
    eq(players.enabled, true),
    inArray(matches.queueId, queueIds(view)),
    seasonFilter(matches.timestamp, players.platform, period, now),
    sql`coalesce(${matches.isRemake},false) = false`,
  );
  const week = sql`date_trunc('week', ${matches.timestamp} at time zone 'UTC')`;
  const [activity, champions, unique, awardData, lpIntervals] = await Promise.all([
    db()
      .select({
        timestamp: sql<string>`${week}::text`,
        games: sql<number>`count(*)`.mapWith(Number),
        wins: sql<number>`count(*) filter (where ${playerMatches.win})`.mapWith(Number),
        losses: sql<number>`count(*) filter (where not ${playerMatches.win})`.mapWith(Number),
      })
      .from(playerMatches)
      .innerJoin(matches, eq(matches.id, playerMatches.matchId))
      .innerJoin(players, eq(players.id, playerMatches.playerId))
      .where(filter)
      .groupBy(week)
      .orderBy(week),
    db()
      .select({
        championId: playerMatches.championId,
        champion: playerMatches.champion,
        games: sql<number>`count(*)`.mapWith(Number),
        wins: sql<number>`count(*) filter (where ${playerMatches.win})`.mapWith(Number),
      })
      .from(playerMatches)
      .innerJoin(matches, eq(matches.id, playerMatches.matchId))
      .innerJoin(players, eq(players.id, playerMatches.playerId))
      .where(filter)
      .groupBy(playerMatches.championId, playerMatches.champion)
      .orderBy(sql`count(*) desc`)
      .limit(8),
    db()
      .select({ n: sql<number>`count(distinct ${matches.id})`.mapWith(Number) })
      .from(playerMatches)
      .innerJoin(matches, eq(matches.id, playerMatches.matchId))
      .innerJoin(players, eq(players.id, playerMatches.playerId))
      .where(filter),
    getAwardMatchStats(view, period, now),
    getAwardLpIntervals(view, period, now),
  ]);
  return {
    activity: continuousActivity(
      activity.map((w) => ({
        ...w,
        timestamp: new Date(w.timestamp.replace(" ", "T") + "Z").toISOString(),
      })),
    ),
    champions,
    uniqueGames: unique[0]?.n ?? 0,
    recentForm: awardData.sequences.map((s) => ({
      playerId: s.playerId,
      games: s.results.length,
      wins: s.results.filter(Boolean).length,
    })),
    sequences: awardData.sequences,
    awardStats: awardData.stats,
    lpIntervals,
  };
}
