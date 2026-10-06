import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { syncLocks } from "@/db/schema";
import { nextExpectedSyncAt, SYNC_LEASE_MS, type SyncStatus } from "@/lib/sync-status";
import { isDemo } from "../env";

export async function getSyncStatus(now = new Date()): Promise<SyncStatus> {
  const [row] = isDemo()
    ? []
    : await db()
        .select({
          lastSuccessfulSyncAt: syncLocks.lastSuccessfulSyncAt,
          lastStartedAt: syncLocks.lastStartedAt,
          lastFinishedAt: syncLocks.lastFinishedAt,
          lastOutcome: syncLocks.lastOutcome,
        })
        .from(syncLocks)
        .where(eq(syncLocks.name, "riot"));
  const last = row?.lastSuccessfulSyncAt?.toISOString() ?? null;
  const expired =
    row?.lastOutcome === "running" &&
    row.lastStartedAt &&
    now.getTime() >= row.lastStartedAt.getTime() + SYNC_LEASE_MS;
  return {
    lastSuccessfulSyncAt: last,
    nextExpectedSyncAt: nextExpectedSyncAt(last),
    updatedAt:
      (row?.lastFinishedAt && row.lastStartedAt && row.lastFinishedAt > row.lastStartedAt
        ? row.lastFinishedAt
        : row?.lastStartedAt
      )?.toISOString() ?? null,
    status: expired ? "failed" : (row?.lastOutcome ?? "never"),
    schedulerConfigured: !isDemo() && process.env.LADDER_SCHEDULER_ENABLED === "true",
    serverNow: now.toISOString(),
  };
}
