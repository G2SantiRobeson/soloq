import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, getTableColumns, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { matches, playerMatches, players, rankedSnapshots } from "@/db/schema";
import { queueIds, rankedQueue, type View } from "@/lib/queues";
import { emptyTotals } from "@/lib/stats";
import type { PlayerProfile, PublicPlayer } from "@/lib/types";
import { LP_WINDOW, summarizeLp } from "@/lib/lp-metrics";
import { isDemo } from "./env";
import { demoPlayers } from "./demo";
const totals = {
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
export const getLeaderboard = cache(async (view: View): Promise<PublicPlayer[]> => {
  if (isDemo()) return demoPlayers(view);
  const database = db();
  const selected = await database.select().from(players).where(eq(players.enabled, true));
  if (!selected.length) return [];
  const ids = selected.map((p) => p.id);
  const queue = rankedQueue(view);
  const latestResults = database
    .select({
      playerId: playerMatches.playerId,
      win: playerMatches.win,
      matchId: playerMatches.matchId,
      champion: playerMatches.champion,
      championId: playerMatches.championId,
      isRemake: matches.isRemake,
      position:
        sql<number>`row_number() over (partition by ${playerMatches.playerId} order by ${matches.timestamp} desc, ${matches.id} desc)`.as(
          "position",
        ),
    })
    .from(playerMatches)
    .innerJoin(matches, eq(matches.id, playerMatches.matchId))
    .where(and(inArray(playerMatches.playerId, ids), inArray(matches.queueId, queueIds(view))))
    .as("latest_results");
  const recentSnapshots = database
    .select({
      ...getTableColumns(rankedSnapshots),
      observationIndex:
        sql<number>`row_number() over (partition by ${rankedSnapshots.playerId} order by ${rankedSnapshots.timestamp} desc, ${rankedSnapshots.id} desc)`.as(
          "observation_index",
        ),
    })
    .from(rankedSnapshots)
    .where(
      and(
        inArray(rankedSnapshots.playerId, ids),
        queue ? eq(rankedSnapshots.queue, queue) : undefined,
      ),
    )
    .as("recent_snapshots");
  const [ranks, stats, recent] = await Promise.all([
    queue
      ? database
          .select()
          .from(recentSnapshots)
          .where(lte(recentSnapshots.observationIndex, LP_WINDOW))
          .orderBy(recentSnapshots.playerId, asc(recentSnapshots.observationIndex))
      : [],
    database
      .select({ playerId: playerMatches.playerId, ...totals })
      .from(playerMatches)
      .innerJoin(matches, eq(matches.id, playerMatches.matchId))
      .where(
        and(
          inArray(playerMatches.playerId, ids),
          inArray(matches.queueId, queueIds(view)),
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
      })
      .from(latestResults)
      .where(lte(latestResults.position, 5))
      .orderBy(latestResults.playerId, asc(latestResults.position)),
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
    rank: ranks.find((r) => r.playerId === p.id) ?? null,
    stats: stats.find((s) => s.playerId === p.id) ?? emptyTotals(),
    recent: recent
      .filter((m) => m.playerId === p.id)
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
});
export const getProfile = cache(async (id: string, view: View): Promise<PlayerProfile | null> => {
  if (isDemo()) {
    const player = demoPlayers(view).find((p) => p.id === id);
    return player ? { ...player, recent: player.recent.slice(0, 40) } : null;
  }
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return null;
  const player = (await getLeaderboard(view)).find((p) => p.id === id);
  if (!player) return null;
  const filter = and(eq(playerMatches.playerId, id), inArray(matches.queueId, queueIds(view)));
  const queue = rankedQueue(view);
  const [champions, recent, history] = await Promise.all([
    db()
      .select({ champion: playerMatches.champion, championId: playerMatches.championId, ...totals })
      .from(playerMatches)
      .innerJoin(matches, eq(matches.id, playerMatches.matchId))
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
      .where(filter)
      .orderBy(desc(matches.timestamp), desc(matches.id))
      .limit(40),
    queue
      ? db()
          .select()
          .from(rankedSnapshots)
          .where(and(eq(rankedSnapshots.playerId, id), eq(rankedSnapshots.queue, queue)))
          .orderBy(desc(rankedSnapshots.timestamp), desc(rankedSnapshots.id))
          .limit(180)
      : [],
  ]);
  return {
    ...player,
    champions,
    recent: recent.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() })),
    history: history.reverse().map((s) => ({ ...s, timestamp: s.timestamp.toISOString() })),
  };
});
