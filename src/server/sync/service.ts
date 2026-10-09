import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { players, rankedSnapshots } from "@/db/schema";
import { RANKED_QUEUES } from "@/lib/queues";
import { RiotClient, RiotError, SyncBudget, SyncDeadline } from "../riot/client";
import { importHistory } from "./history";
import { CURRENT_SEASON, seasonStart } from "@/lib/season";
import { withSyncLease } from "./lease";
import { importRecent, RECENT_OVERLAP_MS } from "./recent";
import type { PlayerSyncStep } from "@/lib/player-sync-state";
import { beginPlayerSyncPhase, finishPlayerSyncPhase, playerSyncError } from "./player-state";
import {
  SYNC_RUN_MS,
  RECENT_PASS_MS,
  RECENT_PLAYER_MS,
  RECENT_PLAYER_REQUESTS,
  HISTORY_PLAYER_MS,
  HISTORY_PLAYER_REQUESTS,
  type SyncPlayerResult,
} from "@/lib/sync-scheduling";
import { compareHistory, compareRecent } from "./scheduling";
export async function syncPlayer(
  playerId: string,
  client: RiotClient,
  options: { rankOnly?: boolean; budget?: number } = {},
) {
  const [player] = await db().select().from(players).where(eq(players.id, playerId));
  if (!player?.enabled) return { status: "skipped" as const, playerId, imported: 0 };
  const rankAttempt = await beginPlayerSyncPhase(playerId, "rank");
  let step: PlayerSyncStep = "identity";
  try {
    const identity = await client.identity(player.platform, player.puuid);
    step = "summoner";
    const summoner = await client.summoner(player.platform, player.puuid);
    step = "league";
    const leagues = await client.leagues(player.platform, player.puuid);
    const checkedAt = new Date();
    step = "snapshots";
    await db().transaction(async (tx) => {
      await tx
        .update(players)
        .set({
          gameName: identity.gameName,
          tagLine: identity.tagLine,
          profileIconId: summoner.profileIconId,
          updatedAt: new Date(),
          rankCheckedAt: checkedAt,
          ...finishPlayerSyncPhase(rankAttempt, "success"),
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
  } catch (error) {
    const failure = playerSyncError(error, step);
    await db()
      .update(players)
      .set(
        finishPlayerSyncPhase(
          rankAttempt,
          error instanceof SyncDeadline ? "partial" : "failed",
          error instanceof SyncBudget ? undefined : failure,
          error instanceof SyncBudget ? error.reason : undefined,
        ),
      )
      .where(eq(players.id, playerId));
    console.warn(error instanceof SyncBudget ? "player_sync_pending" : "player_sync_failed", {
      playerId,
      phase: "rank",
      code: error instanceof SyncBudget ? error.reason : failure.code,
    });
    throw error;
  }
  if (options.rankOnly) return { status: "partial" as const, playerId, imported: 0 };
  const recentAttempt = await beginPlayerSyncPhase(playerId, "recent");
  try {
    const result = await importRecent(player, client, options.budget, recentAttempt);
    if (result.status === "partial")
      await db()
        .update(players)
        .set(finishPlayerSyncPhase(recentAttempt, "partial", undefined, result.reason))
        .where(eq(players.id, playerId));
    return result;
  } catch (error) {
    const failure = playerSyncError(error, "recent");
    await db()
      .update(players)
      .set(
        finishPlayerSyncPhase(
          recentAttempt,
          error instanceof SyncDeadline ? "partial" : "failed",
          error instanceof SyncBudget ? undefined : failure,
          error instanceof SyncBudget ? error.reason : undefined,
        ),
      )
      .where(eq(players.id, playerId));
    console.warn(error instanceof SyncBudget ? "player_sync_pending" : "player_sync_failed", {
      playerId,
      phase: "recent",
      code: error instanceof SyncBudget ? error.reason : failure.code,
    });
    throw error;
  }
}
export async function syncBackfillPlayer(playerId: string, client: RiotClient, budget?: number) {
  const [player] = await db()
    .select({ enabled: players.enabled })
    .from(players)
    .where(eq(players.id, playerId));
  if (!player?.enabled) return { playerId, status: "skipped" as const, imported: 0 };
  const attempt = await beginPlayerSyncPhase(playerId, "history");
  try {
    const result = await importHistory(playerId, client, budget, attempt);
    await db()
      .update(players)
      .set({
        backfillUpdatedAt: new Date(),
        ...(result.status === "partial"
          ? finishPlayerSyncPhase(attempt, "partial", undefined, result.reason)
          : {}),
      })
      .where(eq(players.id, playerId));
    return result;
  } catch (error) {
    await db()
      .update(players)
      .set({
        ...finishPlayerSyncPhase(
          attempt,
          error instanceof SyncDeadline ? "partial" : "failed",
          error instanceof SyncBudget ? undefined : playerSyncError(error, "history"),
          error instanceof SyncBudget ? error.reason : undefined,
        ),
        backfillStatus: sql`case when ${players.backfillStatus} = 'completed' then 'completed' else ${error instanceof SyncDeadline ? "running" : "failed"} end`,
        backfillUpdatedAt: new Date(),
      })
      .where(eq(players.id, playerId));
    throw error;
  }
}

export async function syncAllPlayers() {
  return withSyncLease(
    async (client) => {
      const recentDeadline = Math.min(client.deadlineAt, Date.now() + RECENT_PASS_MS);
      const pending = await db()
        .select({
          id: players.id,
          backfillSeason: players.backfillSeason,
          backfillStatus: players.backfillStatus,
          backfillUpdatedAt: players.backfillUpdatedAt,
          scanStart: players.scanStart,
          scanEnd: players.scanEnd,
          lastSyncedAt: players.lastSyncedAt,
          createdAt: players.createdAt,
          lastAttemptAt: players.lastAttemptAt,
          rankCheckedAt: players.rankCheckedAt,
          rankError: players.rankError,
          recentError: players.recentError,
          lastSyncAttempt: players.lastSyncAttempt,
        })
        .from(players)
        .where(eq(players.enabled, true));
      pending.sort(compareRecent);
      const results: SyncPlayerResult[] = [];
      let deadline = false;
      for (const player of pending) {
        const slotDeadline = Math.min(recentDeadline, Date.now() + RECENT_PLAYER_MS);
        if (!client.canStart(slotDeadline)) break;
        try {
          const result = await client.withBudget(
            {
              deadline: slotDeadline,
              requests: RECENT_PLAYER_REQUESTS,
            },
            () => syncPlayer(player.id, client),
          );
          results.push(result);
        } catch (error) {
          results.push({
            playerId: player.id,
            status: error instanceof SyncDeadline ? "partial" : "error",
            ...(error instanceof SyncBudget ? { reason: error.reason } : {}),
          });
          if (error instanceof RiotError && [401, 403, 429].includes(error.status)) {
            console.warn("recent_sync_aborted", {
              eligible: pending.length,
              complete: results.filter((r) => r.status === "complete").length,
              pending: pending.length - results.filter((r) => r.status === "complete").length,
              code: error.status,
              pendingPlayers: pending
                .filter((p) => !results.some((r) => r.playerId === p.id))
                .map((p) => ({ playerId: p.id, reason: "riot_backoff" })),
            });
            throw error;
          }
          if (error instanceof SyncDeadline && !(error instanceof SyncBudget)) {
            deadline = true;
            break;
          }
        }
      }
      const visited = results.length;
      for (const player of pending.slice(visited))
        results.push({
          playerId: player.id,
          status: "partial",
          attempted: false,
          reason: "execution_budget",
        });
      const complete = results.filter((r) => r.status === "complete").length;
      const recent = {
        eligible: pending.length,
        visited,
        complete,
        pending: pending.length - complete,
        errors: results.filter((r) => r.status === "error").length,
        budgetPending: results.filter(
          (r) =>
            r.reason &&
            ["execution_budget", "time_budget", "request_budget", "batch_limit"].includes(r.reason),
        ).length,
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
        .sort(compareHistory);
      const backfillResults: SyncPlayerResult[] = [];
      let cooldownMs = 0;
      // Recent work goes first, but cannot consume the reserved historical time indefinitely.
      for (const player of historical) {
        const slotDeadline = Math.min(client.deadlineAt, Date.now() + HISTORY_PLAYER_MS);
        if (results.find((r) => r.playerId === player.id)?.status === "error") {
          backfillResults.push({
            playerId: player.id,
            status: "partial",
            attempted: false,
            reason: "recent_error",
          });
          continue;
        }
        if (cooldownMs) {
          backfillResults.push({
            playerId: player.id,
            status: "partial",
            attempted: false,
            reason: "riot_backoff",
          });
          continue;
        }
        if (deadline || !client.canStart(slotDeadline)) {
          backfillResults.push({
            playerId: player.id,
            status: "partial",
            attempted: false,
            reason: "execution_budget",
          });
          continue;
        }
        try {
          backfillResults.push(
            await client.withBudget(
              {
                deadline: slotDeadline,
                requests: HISTORY_PLAYER_REQUESTS,
              },
              () => syncBackfillPlayer(player.id, client),
            ),
          );
        } catch (error) {
          backfillResults.push({
            playerId: player.id,
            status: error instanceof SyncDeadline ? "partial" : "error",
            ...(error instanceof SyncBudget ? { reason: error.reason } : {}),
          });
          if (error instanceof RiotError && [401, 403, 429].includes(error.status)) {
            cooldownMs = Math.max(1300, error.retryAfterMs);
            continue;
          }
          if (error instanceof SyncDeadline && !(error instanceof SyncBudget)) deadline = true;
        }
      }
      const backfill = {
        eligible: historical.length,
        results: backfillResults,
        complete: backfillResults.filter((r) => r.status === "complete").length,
        pending: historical.length - backfillResults.filter((r) => r.status === "complete").length,
        errors: backfillResults.filter((r) => r.status === "error").length,
        visited: backfillResults.filter((r) => r.attempted !== false).length,
      };
      console.info("sync_batch_finished", {
        recent,
        backfill: { ...backfill, results: undefined },
        pendingPlayers: results
          .filter((r) => r.status !== "complete")
          .map(({ playerId, status, reason }) => ({ playerId, status, reason })),
        historyPending: backfillResults.filter((r) => r.status !== "complete"),
      });
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
    SYNC_RUN_MS,
    {
      successful: (result) => result.recent.pending === 0,
      cooldown: (result) => result.cooldownMs,
      outcome: (result) => result.outcome,
    },
  );
}
