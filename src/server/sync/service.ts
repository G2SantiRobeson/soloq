import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { matches, playerMatches, players, rankedSnapshots } from "@/db/schema";
import { isStandardMatch, RANKED_QUEUES } from "@/lib/queues";
import { RiotClient, RiotError, SyncDeadline } from "../riot/client";
import { normalizeParticipant } from "../riot/normalize";
import { isRemake } from "@/lib/match-outcome";
import { withSyncLease } from "./lease";
export async function syncPlayer(playerId: string, client: RiotClient) {
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
          state.tier !== last.tier ||
          state.division !== last.division ||
          state.leaguePoints !== last.leaguePoints ||
          state.wins !== last.wins ||
          state.losses !== last.losses
        )
          await tx.insert(rankedSnapshots).values({ playerId, queue, ...state });
      }
    });
    // Freeze the query window across invocations so new matches cannot shift pagination.
    const end = player.scanEnd ?? new Date(Date.now() - 120_000);
    await db().update(players).set({ scanEnd: end }).where(eq(players.id, playerId));
    let offset = player.scanOffset;
    let imported = 0;
    for (let page = 0; page < 5; page++) {
      const pageIds = await client.matchIds(
        player.platform,
        player.puuid,
        Math.floor(player.scanStart.getTime() / 1000),
        Math.floor(end.getTime() / 1000),
        offset,
      );
      for (const matchId of new Set(pageIds)) {
        const [existing] = await db()
          .select({ id: playerMatches.matchId })
          .from(playerMatches)
          .where(and(eq(playerMatches.playerId, playerId), eq(playerMatches.matchId, matchId)))
          .limit(1);
        if (existing) continue;
        const match = await client.match(player.platform, matchId);
        if (!isStandardMatch(match.info.queueId, match.info.mapId, match.info.gameMode)) continue;
        const stats = normalizeParticipant(match, player.puuid);
        if (!stats) throw new RiotError(502);
        await db().transaction(async (tx) => {
          await tx
            .insert(matches)
            .values({
              id: matchId,
              queueId: match.info.queueId,
              mapId: match.info.mapId,
              timestamp: new Date(match.info.gameStartTimestamp),
              duration: match.info.gameDuration,
              isRemake: isRemake(match),
            })
            .onConflictDoNothing();
          const inserted = await tx
            .insert(playerMatches)
            .values({ playerId, matchId, ...stats })
            .onConflictDoNothing()
            .returning({ id: playerMatches.matchId });
          imported += inserted.length;
        });
      }
      offset += pageIds.length;
      if (pageIds.length < 20) {
        // Ten-minute overlap covers delayed indexing. Unique constraints make overlap safe.
        await db()
          .update(players)
          .set({
            scanStart: new Date(end.getTime() - 600_000),
            scanEnd: null,
            scanOffset: 0,
            lastSyncedAt: new Date(),
            syncError: null,
            updatedAt: new Date(),
          })
          .where(eq(players.id, playerId));
        return { status: "complete" as const, playerId, imported };
      }
      await db().update(players).set({ scanOffset: offset }).where(eq(players.id, playerId));
    }
    await db()
      .update(players)
      .set({ syncError: "Historial parcial; continuará en la próxima ejecución." })
      .where(eq(players.id, playerId));
    return { status: "partial" as const, playerId, imported };
  } catch (error) {
    const message =
      error instanceof RiotError || error instanceof SyncDeadline
        ? error.message
        : "Error de sincronización; consulta el registro del servidor.";
    await db().update(players).set({ syncError: message }).where(eq(players.id, playerId));
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
  return withSyncLease(async (client) => {
    const pending = await db()
      .select({ id: players.id })
      .from(players)
      .where(eq(players.enabled, true))
      .orderBy(sql`${players.lastAttemptAt} asc nulls first`, asc(players.createdAt))
      .limit(50);
    const results: { playerId: string; status: string }[] = [];
    for (const player of pending) {
      try {
        results.push(await syncPlayer(player.id, client));
      } catch (error) {
        if (error instanceof RiotError && [401, 403, 429].includes(error.status)) throw error;
        results.push({
          playerId: player.id,
          status: error instanceof SyncDeadline ? "partial" : "error",
        });
        if (error instanceof SyncDeadline) break;
      }
    }
    return results;
  });
}
