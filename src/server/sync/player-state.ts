import "server-only";
import { eq, sql } from "drizzle-orm";
import { players } from "@/db/schema";
import { CURRENT_SEASON } from "@/lib/season";
import type {
  PlayerSyncAttempt,
  PlayerSyncError,
  PlayerSyncPhase,
  PlayerSyncState,
  PlayerSyncStep,
} from "@/lib/player-sync-state";
import { RiotClient, RiotError, SyncDeadline } from "../riot/client";
import { syncWrite } from "./progress";
import type { PendingReason } from "@/lib/sync-scheduling";

const errorColumns = {
  rank: players.rankError,
  recent: players.recentError,
  history: players.backfillError,
};

export async function beginPlayerSyncPhase(
  playerId: string,
  phase: PlayerSyncPhase,
  client: RiotClient,
) {
  const attempt: PlayerSyncAttempt = {
    phase,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    outcome: "running",
  };
  await syncWrite(
    client,
    async (tx) => {
      await tx.update(players).set({ lastSyncAttempt: attempt }).where(eq(players.id, playerId));
    },
    { type: "phase", phase, playerId },
  );
  return attempt;
}

export function playerSyncError(error: unknown, step: PlayerSyncStep): PlayerSyncError {
  return {
    occurredAt: new Date().toISOString(),
    code:
      error instanceof RiotError
        ? error.status
        : error instanceof SyncDeadline
          ? "deadline"
          : "internal",
    step,
    message:
      error instanceof RiotError || error instanceof SyncDeadline
        ? error.message
        : "Error de sincronización; consulta el registro del servidor.",
  };
}

// Can be included in the same transaction as snapshots/cursor writes.
export function finishPlayerSyncPhase(
  attempt: PlayerSyncAttempt,
  outcome: Exclude<PlayerSyncAttempt["outcome"], "running">,
  error?: PlayerSyncError,
  pendingReason?: PendingReason,
) {
  const phase = attempt.phase;
  const complete = outcome === "success";
  const otherErrors = Object.entries(errorColumns)
    .filter(([key]) => key !== phase)
    .map(([, column]) => sql`${column}->>'message'`);
  // Keep unclassified pre-migration errors. Only retire the legacy mirror of an
  // error this phase actually resolved; another phase's unresolved error survives.
  const legacyError = error
    ? sql<string | null>`${error.message}`
    : complete
      ? sql<
          string | null
        >`coalesce(${sql.join(otherErrors, sql`, `)}, case when ${players.syncError} = ${errorColumns[phase]}->>'message' then null else ${players.syncError} end)`
      : undefined;
  return {
    lastSyncAttempt: {
      ...attempt,
      finishedAt: new Date().toISOString(),
      outcome,
      ...(pendingReason ? { pendingReason } : {}),
    },
    rankError: phase === "rank" ? (error ?? (complete ? null : undefined)) : undefined,
    recentError: phase === "recent" ? (error ?? (complete ? null : undefined)) : undefined,
    backfillError: phase === "history" ? (error ?? (complete ? null : undefined)) : undefined,
    syncError: legacyError,
  };
}

export function toPlayerSyncState(player: typeof players.$inferSelect): PlayerSyncState {
  const current = player.backfillSeason === CURRENT_SEASON.id;
  return {
    rank: { checkedAt: player.rankCheckedAt?.toISOString() ?? null, error: player.rankError },
    recent: {
      coveredThrough: player.lastSyncedAt?.toISOString() ?? null,
      lastIdsResponseAt: player.lastAttemptAt?.toISOString() ?? null,
      error: player.recentError,
    },
    history: {
      season: CURRENT_SEASON.id,
      status: current ? player.backfillStatus : "not_started",
      processed: current ? player.backfillProcessed : 0,
      discovered: current ? player.backfillDiscovered : 0,
      unavailable: current ? player.backfillUnavailable : 0,
      completedAt: current ? (player.lastBackfillAt?.toISOString() ?? null) : null,
      updatedAt: current ? (player.backfillUpdatedAt?.toISOString() ?? null) : null,
      error: player.backfillError,
      cursor: {
        season: player.backfillSeason,
        from: player.scanStart.toISOString(),
        through: player.scanEnd?.toISOString() ?? null,
        offset: player.scanOffset,
        pending: player.scanPending.length,
        exhausted: player.scanExhausted,
      },
    },
    lastAttempt: player.lastSyncAttempt,
  };
}
