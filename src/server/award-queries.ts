import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { matches, playerMatches, players, rankedSnapshots } from "@/db/schema";
import { queueIds, rankedQueue, type View } from "@/lib/queues";
import type { MetricsPeriod } from "@/lib/season";
import { RECENT_FORM_GAMES } from "@/lib/global-metrics";
import { TIERS } from "@/lib/ranking";
import { MAX_RANK_INTERVAL_MS } from "@/lib/rank-trajectory";
import type { AwardMatchStats, AwardLpInterval, ResultSequence } from "@/lib/awards";
import { seasonFilter } from "./season-filter";

/** One grouped row per player. Full sequences never leave PostgreSQL. */
export async function getAwardMatchStats(view: View, period: MetricsPeriod, now = Date.now()) {
  const result = await db().execute(sql`
    with valid as (
      select ${playerMatches.playerId} as player_id, ${playerMatches.win} as win,
        ${playerMatches.championId} as champion_id, ${playerMatches.kills} as kills,
        ${playerMatches.deaths} as deaths, ${playerMatches.assists} as assists,
        ${playerMatches.cs} as cs, ${playerMatches.damage} as damage,
        ${matches.duration} as duration, ${matches.timestamp} as timestamp, ${matches.id} as match_id
      from ${playerMatches} join ${matches} on ${matches.id} = ${playerMatches.matchId}
      join ${players} on ${players.id} = ${playerMatches.playerId}
      where ${and(eq(players.enabled, true), inArray(matches.queueId, queueIds(view)), seasonFilter(matches.timestamp, players.platform, period, now))}
        and coalesce(${matches.isRemake}, false) = false and ${matches.duration} > 0
        and ${playerMatches.kills} >= 0 and ${playerMatches.deaths} >= 0
        and ${playerMatches.assists} >= 0 and ${playerMatches.cs} >= 0 and ${playerMatches.damage} >= 0
    ), ordered as (
      select *, row_number() over (partition by player_id order by timestamp, match_id)
        - row_number() over (partition by player_id, win order by timestamp, match_id) as run_id,
        row_number() over (partition by player_id order by timestamp desc, match_id desc) as recent_index
      from valid
    ), runs as (
      select player_id, win, count(*) as length from ordered group by player_id, win, run_id
    ), streaks as (
      select player_id, coalesce(max(length) filter (where win), 0) as win_streak,
        coalesce(max(length) filter (where not win), 0) as loss_streak from runs group by player_id
    )
    select o.player_id, count(*) as games, count(distinct champion_id) as champions,
      count(*) filter (where kills = 0) as zero_kills,
      sum(cs) as cs, sum(damage) as damage, sum(duration) as duration,
      sum(deaths) as deaths, sum(assists) as assists, s.win_streak, s.loss_streak,
      array_agg(win order by timestamp, match_id) filter (where recent_index <= ${RECENT_FORM_GAMES}) as results
    from ordered o join streaks s on o.player_id = s.player_id
    group by o.player_id, s.win_streak, s.loss_streak`);
  const rows = Array.isArray(result)
    ? result
    : (result as unknown as { rows: Record<string, unknown>[] }).rows;
  const stats: AwardMatchStats[] = rows.map((r) => ({
    playerId: String(r.player_id),
    games: Number(r.games),
    champions: Number(r.champions),
    zeroKills: Number(r.zero_kills),
    winStreak: Number(r.win_streak),
    lossStreak: Number(r.loss_streak),
    cs: Number(r.cs),
    damage: Number(r.damage),
    duration: Number(r.duration),
    deaths: Number(r.deaths),
    assists: Number(r.assists),
  }));
  const sequences: ResultSequence[] = rows.map((r) => ({
    playerId: String(r.player_id),
    results: (r.results as unknown[]).map((v) => v === true || v === "t" || v === "true"),
  }));
  return { stats, sequences };
}

/** Both endpoints are filtered before LAG: never attribute an outside baseline to a window. */
export async function getAwardLpIntervals(
  view: View,
  period: MetricsPeriod,
  now = Date.now(),
): Promise<AwardLpInterval[]> {
  const queue = rankedQueue(view);
  if (!queue) return [];
  const result = await db().execute(sql`
    with observations as (
      select ${rankedSnapshots.playerId} as player_id, ${rankedSnapshots.id} as id,
        ${rankedSnapshots.timestamp} as timestamp, ${rankedSnapshots.tier} as tier,
        ${rankedSnapshots.division} as division, ${rankedSnapshots.leaguePoints} as lp,
        ${rankedSnapshots.wins} as wins, ${rankedSnapshots.losses} as losses,
        count(*) over (partition by ${rankedSnapshots.playerId}, ${rankedSnapshots.timestamp}) as same_time
      from ${rankedSnapshots} join ${players} on ${players.id} = ${rankedSnapshots.playerId}
      where ${and(eq(players.enabled, true), eq(rankedSnapshots.queue, queue), seasonFilter(rankedSnapshots.timestamp, players.platform, period, now))}
    ), ordered as (
      select *, lag(timestamp) over w as previous_time, lag(tier) over w as previous_tier,
        lag(division) over w as previous_division, lag(lp) over w as previous_lp,
        lag(wins) over w as previous_wins, lag(losses) over w as previous_losses,
        lag(same_time) over w as previous_same_time
      from observations window w as (partition by player_id order by timestamp, id)
    ), comparable as (
      select *, lp - previous_lp as delta from ordered
      where previous_time < timestamp and timestamp - previous_time <= ${MAX_RANK_INTERVAL_MS / 1000} * interval '1 second'
        and same_time = 1 and previous_same_time = 1
        and tier = previous_tier and division = previous_division
        and tier in (${sql.join(
          TIERS.map((tier) => sql`${tier}`),
          sql`, `,
        )})
        and (tier in ('MASTER','GRANDMASTER','CHALLENGER') or division in ('I','II','III','IV'))
        and lp >= 0 and previous_lp >= 0 and previous_wins >= 0 and previous_losses >= 0
        and wins >= previous_wins and losses >= previous_losses
    ), extremes as (
      select *, row_number() over (partition by player_id, sign(delta)
        order by abs(delta) desc, timestamp desc, previous_time desc, id) as n from comparable
    ) select player_id, delta, previous_time, timestamp from extremes where n = 1`);
  const rows = Array.isArray(result)
    ? result
    : (result as unknown as { rows: Record<string, unknown>[] }).rows;
  return rows.map((r) => ({
    playerId: String(r.player_id),
    delta: Number(r.delta),
    from: new Date(r.previous_time as string).toISOString(),
    to: new Date(r.timestamp as string).toISOString(),
  }));
}
