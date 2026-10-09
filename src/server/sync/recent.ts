import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { matches, playerMatches, players } from "@/db/schema";
import { isStandardMatch } from "@/lib/queues";
import { seasonStart, seasonEnd } from "@/lib/season";
import { isRemake } from "@/lib/match-outcome";
import { RiotClient, RiotError } from "../riot/client";
import { normalizeParticipant } from "../riot/normalize";
import type { PlayerSyncAttempt } from "@/lib/player-sync-state";
import { finishPlayerSyncPhase } from "./player-state";

export const RECENT_BATCH_SIZE = 5;
export const RECENT_OVERLAP_MS = 86400_000;
export const RIOT_INDEXING_DELAY_MS = 120_000;

// Historical cursors never participate here. Persisted participants are the retry checkpoint.
export async function importRecent(
  player: typeof players.$inferSelect,
  client: RiotClient,
  budget = RECENT_BATCH_SIZE,
  attempt: PlayerSyncAttempt,
) {
  const end = new Date(
    Math.floor(
      Math.min(Date.now() - RIOT_INDEXING_DELAY_MS, seasonEnd()?.getTime() ?? Infinity) / 1000,
    ) * 1000,
  );
  const start = new Date(
    Math.floor(
      Math.max(
        seasonStart(player.platform).getTime(),
        (player.lastSyncedAt ?? player.createdAt).getTime() - RECENT_OVERLAP_MS,
      ) / 1000,
    ) * 1000,
  );
  let imported = 0;
  let offset = 0;
  if (end <= start)
    return {
      playerId: player.id,
      status: "partial" as const,
      imported,
      reason: "window_not_ready" as const,
    };
  for (;;) {
    client.assertBudget();
    const ids = await client.matchIds(
      player.platform,
      player.puuid,
      Math.floor(start.getTime() / 1000),
      end.getTime() / 1000,
      offset,
    );
    // This remains a successful IDs response marker, separate from scheduling opportunities.
    if (!offset)
      await db()
        .update(players)
        .set({ lastAttemptAt: new Date() })
        .where(eq(players.id, player.id));
    const unique = [...new Set(ids)];
    const existing = unique.length
      ? await db()
          .select({ id: playerMatches.matchId })
          .from(playerMatches)
          .where(and(eq(playerMatches.playerId, player.id), inArray(playerMatches.matchId, unique)))
      : [];
    const saved = new Set(existing.map((row) => row.id));
    for (const id of unique) {
      if (saved.has(id)) continue;
      client.assertBudget();
      if (imported >= budget)
        return {
          playerId: player.id,
          status: "partial" as const,
          imported,
          reason: "batch_limit" as const,
        };
      let match;
      try {
        match = await client.match(player.platform, id);
      } catch (error) {
        // Same recorded-gap policy as historical import; never fabricate missing details.
        if (error instanceof RiotError && error.status === 404) continue;
        throw error;
      }
      if (match.metadata.matchId !== id) throw new RiotError(502);
      if (!isStandardMatch(match.info.queueId, match.info.mapId, match.info.gameMode)) continue;
      if (
        match.info.gameStartTimestamp < start.getTime() ||
        match.info.gameStartTimestamp >= end.getTime()
      )
        throw new RiotError(502);
      const stats = normalizeParticipant(match, player.puuid);
      if (!stats) throw new RiotError(502);
      imported += await db().transaction(async (tx) => {
        await tx
          .insert(matches)
          .values({
            id,
            queueId: match.info.queueId,
            mapId: match.info.mapId,
            timestamp: new Date(match.info.gameStartTimestamp),
            duration: match.info.gameDuration,
            isRemake: isRemake(match),
          })
          .onConflictDoNothing();
        const inserted = await tx
          .insert(playerMatches)
          .values({ playerId: player.id, matchId: id, ...stats })
          .onConflictDoNothing()
          .returning({ id: playerMatches.matchId });
        return inserted.length;
      });
    }
    offset += ids.length;
    // Exactly 100 IDs still requires the next page, even when the import allowance is spent.
    if (ids.length >= 100) continue;
    await db()
      .update(players)
      .set({
        lastSyncedAt: end,
        updatedAt: new Date(),
        ...finishPlayerSyncPhase(attempt, "success"),
      })
      .where(eq(players.id, player.id));
    return { playerId: player.id, status: "complete" as const, imported };
  }
}
