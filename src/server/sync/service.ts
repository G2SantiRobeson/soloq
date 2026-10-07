import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { players, rankedSnapshots } from "@/db/schema";
import { RANKED_QUEUES } from "@/lib/queues";
import { RiotClient, RiotError, SyncDeadline } from "../riot/client";
import { importHistory } from "./history";
import { CURRENT_SEASON, seasonStart } from "@/lib/season";
import { withSyncLease } from "./lease";
import { importRecent, RECENT_OVERLAP_MS } from "./recent";
export async function syncPlayer(
  playerId: string,
  client: RiotClient,
  options: { rankOnly?: boolean; budget?: number } = {},
) {
  const [player] = await db().select().from(players).where(eq(players.id, playerId));
  if (!player?.enabled) return { status: "skipped" as const, playerId, imported: 0 };
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
    return await importRecent(player, client, options.budget);
  } catch (error) {
    const message =
      error instanceof RiotError || error instanceof SyncDeadline
        ? error.message
        : "Error de sincronización; consulta el registro del servidor.";
    await db()
      .update(players)
      .set({
        syncError: message,
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
export async function syncBackfillPlayer(playerId: string, client: RiotClient, budget?: number) {
  try {
    const result = await importHistory(playerId, client, budget);
    await db()
      .update(players)
      .set({ backfillUpdatedAt: new Date() })
      .where(eq(players.id, playerId));
    return result;
  } catch (error) {
    await db()
      .update(players)
      .set({
        syncError:
          error instanceof RiotError || error instanceof SyncDeadline
            ? error.message
            : "Error de importación histórica; consulta el registro del servidor.",
        backfillStatus: sql`case when ${players.backfillStatus} = 'completed' then 'completed' else ${error instanceof SyncDeadline ? "running" : "failed"} end`,
        backfillUpdatedAt: new Date(),
      })
      .where(eq(players.id, playerId));
    throw error;
  }
}

type PlayerResult = {
  playerId: string;
  status: "complete" | "partial" | "error" | "skipped";
  imported?: number;
};
export async function syncAllPlayers() {
  return withSyncLease(
    async (client) => {
      const pending = await db()
        .select({
          id: players.id,
          backfillSeason: players.backfillSeason,
          backfillStatus: players.backfillStatus,
          backfillUpdatedAt: players.backfillUpdatedAt,
          scanStart: players.scanStart,
          scanEnd: players.scanEnd,
          lastSyncedAt: players.lastSyncedAt,
        })
        .from(players)
        .where(eq(players.enabled, true))
        .orderBy(sql`${players.lastAttemptAt} asc nulls first`, asc(players.createdAt));
      const results: PlayerResult[] = [];
      let deadline = false;
      for (const player of pending) {
        try {
          const result = await syncPlayer(player.id, client);
          results.push(result);
        } catch (error) {
          results.push({
            playerId: player.id,
            status: error instanceof SyncDeadline ? "partial" : "error",
          });
          if (error instanceof RiotError && [401, 403, 429].includes(error.status)) {
            console.warn("recent_sync_aborted", {
              eligible: pending.length,
              complete: results.filter((r) => r.status === "complete").length,
              pending: pending.length - results.filter((r) => r.status === "complete").length,
              code: error.status,
            });
            throw error;
          }
          if (error instanceof SyncDeadline) {
            deadline = true;
            break;
          }
        }
      }
      const complete = results.filter((r) => r.status === "complete").length;
      const recent = {
        eligible: pending.length,
        visited: results.length,
        complete,
        pending: pending.length - complete,
        errors: results.filter((r) => r.status === "error").length,
      };
      const historical = pending
        .filter(
          (p) =>
            p.backfillSeason !== CURRENT_SEASON.id ||
            p.backfillStatus !== "completed" ||
            p.scanEnd !== null ||
            // Legacy lastSyncedAt described finishing a frozen scan, not its covered end.
            // Repair a gap preceding the recent overlap without restarting a completed season.
            (p.lastSyncedAt !== null &&
              p.scanStart.getTime() + RECENT_OVERLAP_MS <
                p.lastSyncedAt.getTime() - RECENT_OVERLAP_MS),
        )
        .sort(
          (a, b) => (a.backfillUpdatedAt?.getTime() ?? 0) - (b.backfillUpdatedAt?.getTime() ?? 0),
        );
      const backfillResults: PlayerResult[] = [];
      let cooldownMs = 0;
      // No historical request until every eligible player has had a place in the recent pass.
      if (!deadline && results.length === pending.length) {
        for (const player of historical) {
          if (results.find((r) => r.playerId === player.id)?.status === "error") continue;
          try {
            backfillResults.push(await syncBackfillPlayer(player.id, client));
          } catch (error) {
            backfillResults.push({
              playerId: player.id,
              status: error instanceof SyncDeadline ? "partial" : "error",
            });
            if (error instanceof RiotError && [401, 403, 429].includes(error.status)) {
              cooldownMs = error.retryAfterMs;
              break;
            }
            if (error instanceof SyncDeadline) break;
          }
        }
      }
      const backfill = {
        eligible: historical.length,
        results: backfillResults,
        complete: backfillResults.filter((r) => r.status === "complete").length,
        pending: historical.length - backfillResults.filter((r) => r.status === "complete").length,
        errors: backfillResults.filter((r) => r.status === "error").length,
      };
      return {
        results,
        recent,
        backfill,
        cooldownMs,
        outcome: recent.errors
          ? ("failed" as const)
          : recent.pending === 0
            ? ("success" as const)
            : ("partial" as const),
      };
    },
    230_000,
    {
      successful: (result) => result.recent.pending === 0,
      cooldown: (result) => result.cooldownMs,
      outcome: (result) => result.outcome,
    },
  );
}
