import type { HistoryStatus } from "./season";

export type PlayerSyncPhase = "rank" | "recent" | "history";
export type PlayerSyncStep =
  "identity" | "summoner" | "league" | "snapshots" | "recent" | "history";
export type PlayerSyncError = {
  occurredAt: string;
  code: number | "deadline" | "internal";
  step: PlayerSyncStep;
  message: string;
};
// Null is unknown, not a successful attempt inferred from old timestamps.
export type PlayerSyncAttempt = {
  phase: PlayerSyncPhase;
  startedAt: string;
} & (
  | { outcome: "running"; finishedAt: null }
  | { outcome: "success" | "partial" | "failed"; finishedAt: string }
);
export type PlayerSyncState = {
  rank: { checkedAt: string | null; error: PlayerSyncError | null };
  recent: {
    coveredThrough: string | null;
    lastIdsResponseAt: string | null;
    error: PlayerSyncError | null;
  };
  history: HistoryStatus & {
    updatedAt: string | null;
    error: PlayerSyncError | null;
    cursor: {
      season: string | null;
      from: string;
      through: string | null;
      offset: number;
      pending: number;
      exhausted: boolean;
    };
  };
  // Most recently started phase for this player, not the outcome of the global batch.
  lastAttempt: PlayerSyncAttempt | null;
};
