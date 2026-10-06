import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { players, rankedSnapshots } from "@/db/schema";
import { RANKED_QUEUES } from "@/lib/queues";
import { RiotClient, RiotError, SyncDeadline } from "../riot/client";
import { importHistory } from "./history";
import { seasonStart } from "@/lib/season";
import { withSyncLease } from "./lease";
export async function syncPlayer(
  playerId: string,
  client: RiotClient,
  options: { rankOnly?: boolean; budget?: number } = {},
) {
  const [player] = await db().select().from(players).where(eq(players.id, playerId));
  if (!player?.enabled) return { status: "skipped" as const, playerId };
  await db().update(players).set({ lastAttemptAt: new Date() }).where(eq(players.id, playerId));
  try {
    const identity = await client.identity(player.platform, player.puuid);
    const summoner = await client.summoner(player.platform, player.puuid);
    const leagues = await client.leagues(player.platform, player.puuid);
    await db().transaction(async (tx) => {
      await tx
        .update(players)
        .set({
          gameName: identity.gameName,
          tagLine: identity.tagLine,
          profileIconId: summoner.profileIconId,
          updatedAt: new Date(),
        })
        .where(eq(players.id, playerId));
      for (const queue of RANKED_QUEUES) {
        const league = leagues.find((l) => l.queueType === queue);
        const state = {
          tier: league?.tier ?? "UNRANKED",
          division: league?.rank ?? "",
          leaguePoints: league?.leaguePoints ?? 0,
          wins: league?.wins ?? 0,
          losses: league?.losses ?? 0,
        };
        const [last] = await tx
          .select()
          .from(rankedSnapshots)
          .where(and(eq(rankedSnapshots.playerId, playerId), eq(rankedSnapshots.queue, queue)))
          .orderBy(desc(rankedSnapshots.timestamp))
          .limit(1);
        if (
          !last ||
          last.timestamp < seasonStart(player.platform) ||
          state.tier !== last.tier ||
          state.division !== last.division ||
          state.leaguePoints !== last.leaguePoints ||
          state.wins !== last.wins ||
          state.losses !== last.losses
        )
          await tx.insert(rankedSnapshots).values({ playerId, queue, ...state });
      }
    });
    if (options.rankOnly) return { status: "partial" as const, playerId, imported: 0 };
    return await importHistory(playerId, client, options.budget);
  } catch (error) {
    const message =
      error instanceof RiotError || error instanceof SyncDeadline
        ? error.message
        : "Error de sincronización; consulta el registro del servidor.";
    await db()
      .update(players)
      .set({
        syncError: message,
        backfillStatus: sql`case when ${players.backfillStatus} = 'completed' then 'completed' else ${error instanceof SyncDeadline ? "running" : "failed"} end`,
        backfillUpdatedAt: new Date(),
      })
      .where(eq(players.id, playerId));
    console.warn("player_sync_failed", {
      playerId,
      code:
        error instanceof RiotError
          ? error.status
          : error instanceof SyncDeadline
            ? "deadline"
            : "internal",
    });
    throw error;
  }
}
export async function syncAllPlayers() {
  const run = await withSyncLease(
    async (client) => {
      const pending = await db()
        .select({ id: players.id })
        .from(players)
        .where(eq(players.enabled, true))
        .orderBy(sql`${players.lastAttemptAt} asc nulls first`, asc(players.createdAt))
        .limit(51);
      const results: { playerId: string; status: string }[] = [];
      let successful = pending.length <= 50;
      for (const player of pending.slice(0, 50)) {
        try {
          const result = await syncPlayer(player.id, client);
          results.push(result);
          if (result.status !== "complete") successful = false;
        } catch (error) {
          successful = false;
          if (error instanceof RiotError && [401, 403, 429].includes(error.status)) throw error;
          results.push({
            playerId: player.id,
            status: error instanceof SyncDeadline ? "partial" : "error",
          });
          if (error instanceof SyncDeadline) break;
        }
      }
      return { results, successful };
    },
    230_000,
    { successful: (result) => result.successful },
  );
  return run.results;
}
