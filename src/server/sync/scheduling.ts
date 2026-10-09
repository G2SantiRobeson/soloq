import type { PlayerSyncAttempt, PlayerSyncError } from "@/lib/player-sync-state";

type Candidate = {
  id: string;
  createdAt: Date;
  lastSyncedAt: Date | null;
  lastAttemptAt: Date | null;
  rankCheckedAt: Date | null;
  rankError: PlayerSyncError | null;
  recentError: PlayerSyncError | null;
  lastSyncAttempt: PlayerSyncAttempt | null;
};
function timestamp(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

// Most recent opportunity, including failures before the first IDs response.
// History activity must never move a player to the end of the recent pass.
export function recentOpportunity(player: Candidate) {
  return Math.max(
    player.lastAttemptAt?.getTime() ?? 0,
    player.rankCheckedAt?.getTime() ?? 0,
    timestamp(player.rankError?.occurredAt),
    timestamp(player.recentError?.occurredAt),
    player.lastSyncAttempt?.phase !== "history" ? timestamp(player.lastSyncAttempt?.startedAt) : 0,
  );
}
export function compareRecent(a: Candidate, b: Candidate) {
  return (
    recentOpportunity(a) - recentOpportunity(b) ||
    (a.lastSyncedAt?.getTime() ?? 0) - (b.lastSyncedAt?.getTime() ?? 0) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}
export function compareHistory(
  a: { id: string; createdAt: Date; backfillUpdatedAt: Date | null },
  b: { id: string; createdAt: Date; backfillUpdatedAt: Date | null },
) {
  return (
    (a.backfillUpdatedAt?.getTime() ?? 0) - (b.backfillUpdatedAt?.getTime() ?? 0) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}
