import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { syncLocks } from "@/db/schema";
import { progressEnvelopeSchema, type PersistedRun } from "@/lib/sync-progress";
import type { RiotClient } from "../riot/client";
import type { EvidenceTransaction } from "../achievements/verification/evidence-in-tx";
import { leaseContext, LeaseLost } from "./progress";

// Zod strips unknown keys. Refuse an unfamiliar format rather than silently
// discarding another checkpoint or retaining an unreviewed personal field.
function sameShape(input: unknown, parsed: unknown): boolean {
  if (Array.isArray(input))
    return (
      Array.isArray(parsed) &&
      input.length === parsed.length &&
      input.every((value, index) => sameShape(value, parsed[index]))
    );
  if (input !== null && typeof input === "object") {
    if (parsed === null || typeof parsed !== "object") return false;
    const original = input as Record<string, unknown>;
    const known = parsed as Record<string, unknown>;
    return (
      Object.keys(original).length === Object.keys(known).length &&
      Object.keys(original).every(
        (key) => Object.hasOwn(known, key) && sameShape(original[key], known[key]),
      )
    );
  }
  return true;
}

function redactRun(run: PersistedRun, playerId: string) {
  if (run.playerId === playerId) run.playerId = null;
  if (run.currentPlayerId === playerId) run.currentPlayerId = null;
  // Also removes the player's lastConfirmedMatchId, counters and phase errors.
  run.players = run.players.filter((player) => player.playerId !== playerId);
  // Aggregate results describe the original execution, not the remaining roster.
  // Do not call summarizeRun or change its outcome, times, revision or run ID.
}

/** Only inside the administrative DELETE's existing maintenance syncWrite. */
export async function redactDeletedPlayerProgressInTx(
  tx: Pick<EvidenceTransaction, "select" | "update">,
  client: RiotClient,
  playerId: string,
) {
  const context = leaseContext(client);
  // A tracked sync holds an in-memory envelope which it will later persist.
  // DELETE instead acquires a fresh, untracked lease, whose finalizer never
  // writes that envelope. Expired writers fail their existing owner fencing.
  if (!context || context.runId !== null) throw new LeaseLost();
  const [row] = await tx
    .select()
    .from(syncLocks)
    .where(
      and(
        eq(syncLocks.name, "riot"),
        eq(syncLocks.owner, context.owner),
        sql`${syncLocks.expiresAt} > clock_timestamp()`,
      ),
    )
    .for("update");
  if (!row) throw new LeaseLost();
  if (row.runProgress === null) return;
  const parsed = progressEnvelopeSchema.safeParse(row.runProgress);
  if (!parsed.success || !sameShape(row.runProgress, parsed.data))
    throw new Error("Formato de progreso no compatible con la eliminación segura.");
  const envelope = parsed.data;
  if (
    ![envelope.latest, envelope.previous].some(
      (run) =>
        run &&
        (run.playerId === playerId ||
          run.currentPlayerId === playerId ||
          run.players.some((player) => player.playerId === playerId)),
    )
  )
    return;
  redactRun(envelope.latest, playerId);
  if (envelope.previous) redactRun(envelope.previous, playerId);
  await tx.update(syncLocks).set({ runProgress: envelope }).where(eq(syncLocks.name, "riot"));
}
