import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { syncLocks } from "@/db/schema";
import { isDemo } from "../env";
import { RiotClient, RiotError } from "../riot/client";
export class SyncBusy extends Error {
  constructor() {
    super("Ya hay una sincronización en curso o Riot está en espera. Inténtalo más tarde.");
  }
}
export async function withSyncLease<T>(work: (client: RiotClient) => Promise<T>): Promise<T> {
  if (isDemo()) throw new Error("La sincronización está deshabilitada en modo demo.");
  const owner = randomUUID();
  const acquired = await db()
    .insert(syncLocks)
    .values({ name: "riot", owner, expiresAt: new Date(Date.now() + 285_000) })
    .onConflictDoUpdate({
      target: syncLocks.name,
      set: { owner, expiresAt: new Date(Date.now() + 285_000) },
      setWhere: sql`${syncLocks.expiresAt} < now()`,
    })
    .returning();
  if (!acquired.length) throw new SyncBusy();
  let cooldown = 1300;
  try {
    return await work(new RiotClient());
  } catch (error) {
    if (error instanceof RiotError && error.status === 429)
      cooldown = Math.max(cooldown, error.retryAfterMs);
    throw error;
  } finally {
    await db()
      .update(syncLocks)
      .set({ expiresAt: new Date(Date.now() + cooldown) })
      .where(and(eq(syncLocks.name, "riot"), eq(syncLocks.owner, owner)));
  }
}
