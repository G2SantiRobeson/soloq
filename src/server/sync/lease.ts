import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { syncLocks } from "@/db/schema";
import { isDemo } from "../env";
import { RiotClient, RiotError } from "../riot/client";
import { SYNC_LEASE_MS } from "@/lib/sync-status";
export class SyncBusy extends Error {
  constructor() {
    super("Ya hay una sincronización en curso o Riot está en espera. Inténtalo más tarde.");
  }
}
export async function withSyncLease<T>(
  work: (client: RiotClient) => Promise<T>,
  budgetMs = 230_000,
  ladder?: {
    successful: (result: T) => boolean;
    cooldown?: (result: T) => number;
    outcome?: (result: T) => "success" | "partial" | "failed";
  },
): Promise<T> {
  if (isDemo()) throw new Error("La sincronización está deshabilitada en modo demo.");
  const owner = randomUUID();
  const acquired = await db()
    .insert(syncLocks)
    .values({
      name: "riot",
      owner,
      expiresAt: new Date(Date.now() + SYNC_LEASE_MS),
      ...(ladder ? { lastStartedAt: new Date(), lastOutcome: "running" as const } : {}),
    })
    .onConflictDoUpdate({
      target: syncLocks.name,
      set: {
        owner,
        expiresAt: new Date(Date.now() + SYNC_LEASE_MS),
        ...(ladder ? { lastStartedAt: new Date(), lastOutcome: "running" as const } : {}),
      },
      setWhere: sql`${syncLocks.expiresAt} < now()`,
    })
    .returning();
  if (!acquired.length) throw new SyncBusy();
  let cooldown = 1300;
  let outcome: "success" | "partial" | "failed" = "failed";
  try {
    const result = await work(new RiotClient(Date.now() + budgetMs));
    cooldown = Math.max(cooldown, ladder?.cooldown?.(result) ?? 0);
    outcome =
      ladder?.outcome?.(result) ?? (!ladder || ladder.successful(result) ? "success" : "partial");
    return result;
  } catch (error) {
    if (error instanceof RiotError && error.status === 429)
      cooldown = Math.max(cooldown, error.retryAfterMs);
    throw error;
  } finally {
    await db()
      .update(syncLocks)
      .set({
        expiresAt: new Date(Date.now() + cooldown),
        ...(ladder
          ? {
              lastFinishedAt: new Date(),
              lastOutcome: outcome,
              ...(outcome === "success" ? { lastSuccessfulSyncAt: new Date() } : {}),
            }
          : {}),
      })
      .where(and(eq(syncLocks.name, "riot"), eq(syncLocks.owner, owner)));
  }
}
