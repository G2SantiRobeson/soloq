import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, getTableColumns, inArray, lte, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { matches, playerMatches, players, rankedSnapshots } from "@/db/schema";
import { queueIds, rankedQueue, type View } from "@/lib/queues";
import { emptyTotals } from "@/lib/stats";
import type { PlayerProfile, PublicPlayer } from "@/lib/types";
import { LP_WINDOW, summarizeLp, lastFiveRankDelta } from "@/lib/lp-metrics";
import { CURRENT_SEASON, periodStart, seasonEnd, type MetricsPeriod } from "@/lib/season";
import { lpObservations } from "@/lib/history";
import { seasonFilter } from "./season-filter";
import { getPerformance } from "./season-queries";
import { isDemo } from "./env";
import { demoPlayers } from "./demo";
import { getWeeklyLpSummary } from "./weekly-lp";
export const totals = {
  games: sql<number>`count(*)`.mapWith(Number),
  wins: sql<number>`sum(case when ${playerMatches.win} then 1 else 0 end)`.mapWith(Number),
  losses: sql<number>`sum(case when ${playerMatches.win} then 0 else 1 end)`.mapWith(Number),
  kills: sql<number>`sum(${playerMatches.kills})`.mapWith(Number),
  deaths: sql<number>`sum(${playerMatches.deaths})`.mapWith(Number),
  assists: sql<number>`sum(${playerMatches.assists})`.mapWith(Number),
  cs: sql<number>`sum(${playerMatches.cs})`.mapWith(Number),
  duration: sql<number>`sum(${matches.duration})`.mapWith(Number),
  damage: sql<number>`sum(${playerMatches.damage})`.mapWith(Number),
};
export const getLeaderboard = cache(
  async (
    view: View,
    period: MetricsPeriod = "season",
    playerId?: string,
  ): Promise<PublicPlayer[]> => {
    if (isDemo()) return demoPlayers(view, period).filter((p) => !playerId || p.id === playerId);
    const database = db();
    const selected = await database
      .select()
      .from(players)
      .where(and(eq(players.enabled, true), playerId ? eq(players.id, playerId) : undefined));
    if (!selected.length) return [];
    const ids = selected.map((p) => p.id);
    const queue = rankedQueue(view);
    const now = new Date();
    const latestResults = database
      .select({
        playerId: playerMatches.playerId,
        win: playerMatches.win,
        matchId: playerMatches.matchId,
        champion: playerMatches.champion,
        championId: playerMatches.championId,
        isRemake: matches.isRemake,
        timestamp: matches.timestamp,
        duration: matches.duration,
        queueId: matches.queueId,
        position:
          sql<number>`row_number() over (partition by ${playerMatches.playerId} order by ${matches.timestamp} desc, ${matches.id} desc)`.as(
            "position",
          ),
      })
      .from(playerMatches)
      .innerJoin(matches, eq(matches.id, playerMatches.matchId))
      .innerJoin(players, eq(players.id, playerMatches.playerId))
      .where(
        and(
          inArray(playerMatches.playerId, ids),
          inArray(matches.queueId, queueIds(view)),
          seasonFilter(matches.timestamp, players.platform),
        ),
      )
      .as("latest_results");
    // Keep every intervening official observation and the nearest pre-form snapshot,
    // even when more than 30 checks occurred since the oldest displayed match.
    const formStarts = database
      .select({ playerId: latestResults.playerId, timestamp: latestResults.timestamp })
      .from(latestResults)
      .where(eq(latestResults.position, 5))
      .as("form_starts");
    const formBoundary = sql`coalesce(${formStarts.timestamp}, ${now.toISOString()}::timestamptz)`;
    const recentSnapshots = database
      .select({
        ...getTableColumns(rankedSnapshots),
        beforeForm: sql<boolean>`${rankedSnapshots.timestamp} < ${formBoundary}`.as("before_form"),
        boundaryIndex:
          sql<number>`row_number() over (partition by ${rankedSnapshots.playerId}, (${rankedSnapshots.timestamp} < ${formBoundary}) order by ${rankedSnapshots.timestamp} desc, ${rankedSnapshots.id} desc)`.as(
            "boundary_index",
          ),
        observationIndex:
          sql<number>`row_number() over (partition by ${rankedSnapshots.playerId} order by ${rankedSnapshots.timestamp} desc, ${rankedSnapshots.id} desc)`.as(
            "observation_index",
          ),
      })
      .from(rankedSnapshots)
      .innerJoin(players, eq(players.id, rankedSnapshots.playerId))
      .leftJoin(formStarts, eq(formStarts.playerId, rankedSnapshots.playerId))
      .where(
        and(
          inArray(rankedSnapshots.playerId, ids),
          queue ? eq(rankedSnapshots.queue, queue) : undefined,
          seasonFilter(rankedSnapshots.timestamp, players.platform),
        ),
      )
      .as("recent_snapshots");
    const [ranks, stats, recent, weekly] = await Promise.all([
      queue
        ? database
            .select()
            .from(recentSnapshots)
            .where(
              sql`${recentSnapshots.observationIndex} <= ${LP_WINDOW} or not ${recentSnapshots.beforeForm} or ${recentSnapshots.boundaryIndex} = 1`,
            )
            .orderBy(recentSnapshots.playerId, asc(recentSnapshots.observationIndex))
        : [],
      database
        .select({ playerId: playerMatches.playerId, ...totals })
        .from(playerMatches)
        .innerJoin(matches, eq(matches.id, playerMatches.matchId))
        .innerJoin(players, eq(players.id, playerMatches.playerId))
        .where(
          and(
            inArray(playerMatches.playerId, ids),
            inArray(matches.queueId, queueIds(view)),
            seasonFilter(matches.timestamp, players.platform, period),
            sql`coalesce(${matches.isRemake}, false) = false`,
          ),
        )
        .groupBy(playerMatches.playerId),
      database
        .select({
          playerId: latestResults.playerId,
          win: latestResults.win,
          matchId: latestResults.matchId,
          champion: latestResults.champion,
          championId: latestResults.championId,
          isRemake: latestResults.isRemake,
          timestamp: latestResults.timestamp,
          duration: latestResults.duration,
          queueId: latestResults.queueId,
        })
        .from(latestResults)
        .where(lte(latestResults.position, 6))
        .orderBy(latestResults.playerId, asc(latestResults.position)),
      getWeeklyLpSummary(ids, view, now),
    ]);
    return selected.map((p) => ({
      id: p.id,
      gameName: p.gameName,
      tagLine: p.tagLine,
      platform: p.platform,
      profileIconId: p.profileIconId,
      createdAt: p.createdAt.toISOString(),
      lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null,
      observedAt: new Date().toISOString(),
      seasonHistory: {
        season: CURRENT_SEASON.id,
        status: p.backfillSeason === CURRENT_SEASON.id ? p.backfillStatus : "not_started",
        processed: p.backfillSeason === CURRENT_SEASON.id ? p.backfillProcessed : 0,
        discovered: p.backfillSeason === CURRENT_SEASON.id ? p.backfillDiscovered : 0,
        unavailable: p.backfillSeason === CURRENT_SEASON.id ? p.backfillUnavailable : 0,
        completedAt:
          p.backfillSeason === CURRENT_SEASON.id ? (p.lastBackfillAt?.toISOString() ?? null) : null,
      },
      rank: ranks.find((r) => r.playerId === p.id) ?? null,
      weeklyLp: weekly.get(p.id)?.net ?? null,
      weeklySummary: weekly.get(p.id) ?? null,
      lastFiveLp: lastFiveRankDelta(
        ranks
          .filter((r) => r.playerId === p.id)
          .map((r) => ({ ...r, timestamp: r.timestamp.toISOString() })),
        recent.filter(
          (m) =>
            m.playerId === p.id &&
            m.timestamp.getTime() >= periodStart(p.platform, period, now.getTime()).getTime(),
        ).length >= 5
          ? recent
              .filter((m) => m.playerId === p.id)
              .map((m) => ({ ...m, timestamp: m.timestamp.toISOString() }))
          : [],
        view,
        p.platform,
        now,
      ),
      stats: stats.find((s) => s.playerId === p.id) ?? emptyTotals(),
      recent: recent
        .filter(
          (m) =>
            m.playerId === p.id &&
            m.timestamp.getTime() >= periodStart(p.platform, period, now.getTime()).getTime(),
        )
        .slice(0, 5)
        .map(({ win, matchId, champion, championId, isRemake }) => ({
          win,
          matchId,
          champion,
          championId,
          isRemake,
        })),
      momentum: queue
        ? summarizeLp(
            ranks
              .filter((r) => r.playerId === p.id)
              .reverse()
              .map((r) => ({ ...r, timestamp: r.timestamp.toISOString() })),
          )
        : null,
    }));
  },
);
export const getProfile = cache(async (id: string, view: View): Promise<PlayerProfile | null> => {
  if (isDemo()) {
    const player = demoPlayers(view).find((p) => p.id === id);
    return player ? { ...player, recent: player.recent.slice(0, 40) } : null;
  }
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return null;
  const [player] = await getLeaderboard(view, "season", id);
  if (!player) return null;
  const filter = and(
    eq(playerMatches.playerId, id),
    inArray(matches.queueId, queueIds(view)),
    seasonFilter(matches.timestamp, players.platform),
  );
  const queue = rankedQueue(view);
  const [champions, recent, history, performance] = await Promise.all([
    db()
      .select({ champion: playerMatches.champion, championId: playerMatches.championId, ...totals })
      .from(playerMatches)
      .innerJoin(matches, eq(matches.id, playerMatches.matchId))
      .innerJoin(players, eq(players.id, playerMatches.playerId))
      .where(and(filter, sql`coalesce(${matches.isRemake}, false) = false`))
      .groupBy(playerMatches.champion, playerMatches.championId)
      .orderBy(desc(sql`count(*)`)),
    db()
      .select({
        ...getTableColumns(playerMatches),
        timestamp: matches.timestamp,
        queueId: matches.queueId,
        duration: matches.duration,
        isRemake: matches.isRemake,
      })
      .from(playerMatches)
      .innerJoin(matches, eq(matches.id, playerMatches.matchId))
      .innerJoin(players, eq(players.id, playerMatches.playerId))
      .where(filter)
      .orderBy(desc(matches.timestamp), desc(matches.id))
      .limit(40),
    queue
      ? db()
          .select()
          .from(rankedSnapshots)
          .where(
            and(
              eq(rankedSnapshots.playerId, id),
              eq(rankedSnapshots.queue, queue),
              gte(rankedSnapshots.timestamp, periodStart(player.platform)),
              lt(rankedSnapshots.timestamp, seasonEnd() ?? new Date()),
            ),
          )
          .orderBy(desc(rankedSnapshots.timestamp), desc(rankedSnapshots.id))
      : [],
    getPerformance(id, view),
  ]);
  const observations = history
    .toReversed()
    .map((s) => ({ ...s, timestamp: s.timestamp.toISOString() }));
  const intervalHistory = observations.slice(-LP_WINDOW);
  const intervalMatches =
    intervalHistory.length > 1
      ? await db()
          .select({
            matchId: matches.id,
            timestamp: matches.timestamp,
            duration: matches.duration,
            win: playerMatches.win,
            isRemake: matches.isRemake,
          })
          .from(playerMatches)
          .innerJoin(matches, eq(matches.id, playerMatches.matchId))
          .innerJoin(players, eq(players.id, playerMatches.playerId))
          .where(
            and(
              filter,
              sql`${matches.timestamp} + ${matches.duration} * interval '1 second' > ${intervalHistory[0].timestamp}::timestamptz`,
              sql`${matches.timestamp} + ${matches.duration} * interval '1 second' <= ${intervalHistory.at(-1)!.timestamp}::timestamptz`,
            ),
          )
      : [];
  return {
    ...player,
    performance,
    trackingSince: observations[0]?.timestamp ?? null,
    lpObservations: lpObservations(
      intervalHistory,
      intervalMatches.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() })),
    ),
    champions,
    recent: recent.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() })),
    history: history.reverse().map((s) => ({ ...s, timestamp: s.timestamp.toISOString() })),
  };
});
