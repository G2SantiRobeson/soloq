import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import type { AdminPlayer, AdminSyncContext } from "@/lib/admin-sync";
import { safeSyncError } from "@/lib/admin-sync";
import { requireAdmin } from "./http";
import { toPlayerSyncState } from "./sync/player-state";
import { readSyncProgress } from "./sync/progress";

export function toAdminPlayer(player: typeof players.$inferSelect): AdminPlayer {
  const state = toPlayerSyncState(player);
  const errors = [state.rank.error, state.recent.error, state.history.error];
  const legacyError =
    player.syncError && !errors.some((e) => e?.message === player.syncError)
      ? "Existe un error previo sin clasificar. Consulta el registro del servidor para revisarlo."
      : null;
  for (const phase of [state.rank, state.recent, state.history])
    if (phase.error) phase.error = safeSyncError(phase.error);
  return {
    id: player.id,
    gameName: player.gameName,
    tagLine: player.tagLine,
    platform: player.platform,
    enabled: player.enabled,
    lastSyncedAt: state.recent.coveredThrough,
    syncError:
      legacyError ??
      state.rank.error?.message ??
      state.recent.error?.message ??
      state.history.error?.message ??
      null,
    backfillSeason: player.backfillSeason,
    backfillStatus: player.backfillStatus,
    backfillDiscovered: player.backfillDiscovered,
    backfillProcessed: player.backfillProcessed,
    backfillUnavailable: player.backfillUnavailable,
    syncState: state,
    legacyError,
  };
}

export async function getAdminPlayers(): Promise<AdminPlayer[]> {
  await requireAdmin();
  return (await db().select().from(players).orderBy(desc(players.createdAt))).map(toAdminPlayer);
}

export async function getAdminSyncContext(): Promise<AdminSyncContext> {
  await requireAdmin();
  const progress = await readSyncProgress();
  return {
    serverNow: progress.serverNow,
    leaseUntil: progress.control.until,
    progress,
  };
}
