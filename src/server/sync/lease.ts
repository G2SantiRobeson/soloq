import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { syncLocks } from "@/db/schema";
import { isDemo } from "../env";
import { RiotClient, RiotError, SyncDeadline } from "../riot/client";
import { SYNC_LEASE_MS } from "@/lib/sync-status";
import { CURRENT_SEASON } from "@/lib/season";
import { finishRun, newRun, type RunMeta } from "@/lib/sync-progress";
import { bindLease, databaseNow, LeaseLost, parseEnvelope, type LeaseContext } from "./progress";
const runErrors = new WeakMap<Error, { runId: string; requestId: string | null }>();
export function runErrorIdentity(error: unknown): { runId?: string; requestId?: string | null } {
  return error instanceof Error ? (runErrors.get(error) ?? {}) : {};
}
export function runIdentity(client: RiotClient): { runId?: string; requestId?: string | null } {
  return identities.get(client) ?? {};
}
const identities = new WeakMap<RiotClient, { runId: string; requestId: string | null }>();
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
  meta?: RunMeta,
): Promise<T> {
  if (isDemo()) throw new Error("La sincronización está deshabilitada en modo demo.");
  const owner = randomUUID();
  const context: LeaseContext = await db().transaction(async (tx) => {
    const acquired = await tx
      .insert(syncLocks)
      .values({
        name: "riot",
        owner,
        expiresAt: sql`clock_timestamp() + ${SYNC_LEASE_MS} * interval '1 millisecond'`,
        ...(ladder
          ? { lastStartedAt: sql`clock_timestamp()`, lastOutcome: "running" as const }
          : {}),
      })
      .onConflictDoUpdate({
        target: syncLocks.name,
        set: {
          owner,
          expiresAt: sql`clock_timestamp() + ${SYNC_LEASE_MS} * interval '1 millisecond'`,
          ...(ladder
            ? { lastStartedAt: sql`clock_timestamp()`, lastOutcome: "running" as const }
            : {}),
        },
        setWhere: sql`${syncLocks.expiresAt} < clock_timestamp()`,
      })
      .returning();
    if (!acquired.length) throw new SyncBusy();
    const now = (await databaseNow(tx)).toISOString();
    let envelope = parseEnvelope(acquired[0].runProgress);
    if (
      meta?.requestId &&
      [envelope?.latest, envelope?.previous].some((r) => r?.requestId === meta.requestId)
    )
      throw new SyncBusy();
    if (envelope?.latest.status === "running") {
      envelope.latest.status = "interrupted";
      envelope.latest.interruptionObservedAt = now;
      envelope.latest.revision++;
    }
    const runId = meta ? randomUUID() : null;
    if (meta && runId)
      envelope = {
        version: 1,
        latest: newRun(meta, owner, runId, now, CURRENT_SEASON.id),
        previous: envelope?.latest ?? null,
      };
    await tx.update(syncLocks).set({ runProgress: envelope }).where(eq(syncLocks.name, "riot"));
    return { owner, runId, envelope };
  });
  const client = new RiotClient(Date.now() + budgetMs);
  bindLease(client, context);
  if (context.runId)
    identities.set(client, { runId: context.runId, requestId: meta?.requestId ?? null });
  let cooldown = 1300;
  let outcome: "success" | "partial" | "failed" = "failed";
  let failure: unknown;
  try {
    const result = await work(client);
    cooldown = Math.max(cooldown, ladder?.cooldown?.(result) ?? 0);
    outcome =
      ladder?.outcome?.(result) ?? (!ladder || ladder.successful(result) ? "success" : "partial");
    return result;
  } catch (error) {
    failure = error;
    if (error instanceof Error && context.runId)
      runErrors.set(error, { runId: context.runId, requestId: meta?.requestId ?? null });
    if (error instanceof RiotError && error.status === 429)
      cooldown = Math.max(cooldown, error.retryAfterMs);
    throw error;
  } finally {
    await db().transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(syncLocks)
        .where(
          and(
            eq(syncLocks.name, "riot"),
            eq(syncLocks.owner, owner),
            sql`${syncLocks.expiresAt} > clock_timestamp()`,
          ),
        )
        .for("update");
      if (!row) {
        if (context.runId && !(failure instanceof LeaseLost)) throw new LeaseLost();
        return;
      }
      const now = await databaseNow(tx);
      const envelope = context.envelope ? structuredClone(context.envelope) : null;
      if (context.runId && envelope) {
        const saved = parseEnvelope(row.runProgress)?.latest;
        if (
          saved?.runId !== context.runId ||
          saved.revision !== envelope.latest.revision ||
          saved.status !== "running"
        )
          throw new LeaseLost();
        finishRun(
          envelope.latest,
          now.toISOString(),
          !!failure && !(failure instanceof SyncDeadline),
          failure instanceof RiotError && [401, 403, 429].includes(failure.status)
            ? "riot_backoff"
            : failure instanceof SyncDeadline
              ? "execution_budget"
              : "aborted",
        );
        envelope.latest.cooldownReason =
          (failure instanceof RiotError && failure.status === 429) || cooldown > 1300
            ? "riot_retry_after"
            : "pacing";
      }
      const released = await tx
        .update(syncLocks)
        .set({
          expiresAt: sql`clock_timestamp() + ${cooldown} * interval '1 millisecond'`,
          ...(context.runId ? { runProgress: envelope } : {}),
          ...(ladder
            ? {
                lastFinishedAt: now,
                lastOutcome: outcome,
                ...(outcome === "success" ? { lastSuccessfulSyncAt: now } : {}),
              }
            : {}),
        })
        .where(
          and(
            eq(syncLocks.name, "riot"),
            eq(syncLocks.owner, owner),
            sql`${syncLocks.expiresAt} > clock_timestamp()`,
          ),
        )
        .returning({ name: syncLocks.name });
      if (!released.length && context.runId) throw new LeaseLost();
    });
  }
}
