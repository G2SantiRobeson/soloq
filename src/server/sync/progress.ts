import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { players, syncLocks } from "@/db/schema";
import {
  applyProgressEvent,
  progressDto,
  progressEnvelopeSchema,
  type ProgressEnvelope,
  type ProgressEvent,
  type ProgressSelector,
} from "@/lib/sync-progress";
import { CURRENT_SEASON } from "@/lib/season";
import { RiotClient } from "../riot/client";
import { HttpError } from "../http";
import { z } from "zod";
import { isDemo } from "../env";

export type SyncTransaction = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
export class LeaseLost extends Error {
  constructor() {
    super("La ejecución perdió su lease; no se han confirmado nuevas escrituras.");
  }
}
export type LeaseContext = {
  owner: string;
  runId: string | null;
  envelope: ProgressEnvelope | null;
};
// Per-client association, never an ambient/global current owner. Unleased domain calls
// retain their existing contract; every production entry point binds its leased client.
const leases = new WeakMap<RiotClient, LeaseContext>();
export function bindLease(client: RiotClient, context: LeaseContext) {
  leases.set(client, context);
}
export function leaseContext(client: RiotClient) {
  return leases.get(client);
}
export async function databaseNow(tx: SyncTransaction) {
  const [row] = await tx
    .select({
      now: sql`clock_timestamp()`.mapWith((v) => (v instanceof Date ? v : new Date(String(v)))),
    })
    .from(syncLocks)
    .where(eq(syncLocks.name, "riot"));
  return row.now;
}
export function parseEnvelope(value: unknown) {
  const parsed = progressEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
async function assertLease(tx: SyncTransaction, context: LeaseContext, lock: boolean) {
  const query = tx
    .select()
    .from(syncLocks)
    .where(
      and(
        eq(syncLocks.name, "riot"),
        eq(syncLocks.owner, context.owner),
        sql`${syncLocks.expiresAt} > clock_timestamp()`,
      ),
    );
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new LeaseLost();
  if (context.runId) {
    const saved = parseEnvelope(row.runProgress)?.latest;
    if (
      !saved ||
      saved.runId !== context.runId ||
      saved.status !== "running" ||
      saved.revision !== context.envelope?.latest.revision
    )
      throw new LeaseLost();
  }
}
export async function syncWrite<T>(
  client: RiotClient,
  work: (tx: SyncTransaction) => Promise<T>,
  events?: ProgressEvent | ((value: T) => ProgressEvent | ProgressEvent[]),
): Promise<T> {
  const context = leases.get(client);
  const committed = context?.envelope ? structuredClone(context.envelope) : null;
  const value = await db().transaction(async (tx) => {
    if (context) await assertLease(tx, context, true);
    const value = await work(tx);
    const changes = events ? (typeof events === "function" ? events(value) : events) : [];
    const list = Array.isArray(changes) ? changes : [changes];
    if (context?.runId && committed && list.length) {
      const now = await databaseNow(tx);
      const run = committed.latest;
      const force = list.some((e) => e.type !== "import" && e.type !== "history");
      const due =
        !run.lastCheckpointAt || now.getTime() - Date.parse(run.lastCheckpointAt) >= 15_000;
      for (const event of list) applyProgressEvent(run, event, now.toISOString());
      if (force || due) {
        const historyId = list.find(
          (e) =>
            e.type === "history" ||
            (e.type === "import" && e.pass === "history") ||
            (e.type === "result" && e.pass === "history"),
        );
        if (historyId) {
          const id =
            historyId.type === "result"
              ? historyId.result.playerId
              : "playerId" in historyId
                ? historyId.playerId
                : null;
          if (id) {
            const [p] = await tx.select().from(players).where(eq(players.id, id));
            const mode =
              run.players.find((r) => r.playerId === id)?.history?.history?.mode ??
              (p?.backfillStatus === "completed" ? "incremental_repair" : "season_backfill");
            const complete = historyId.type === "result" && historyId.result.status === "complete";
            const previous = run.players.find((r) => r.playerId === id)?.history?.history;
            if (p)
              applyProgressEvent(
                run,
                {
                  type: "history",
                  playerId: id,
                  history: {
                    season: CURRENT_SEASON.id,
                    mode,
                    discovered: mode === "incremental_repair" ? null : p.backfillDiscovered,
                    processed: mode === "incremental_repair" ? null : p.backfillProcessed,
                    unavailable: mode === "incremental_repair" ? null : p.backfillUnavailable,
                    cursorPending: p.scanPending.length,
                    scanExhausted: complete || p.scanExhausted,
                    scanThrough:
                      p.scanEnd?.toISOString() ??
                      (complete ? (previous?.scanThrough ?? null) : null),
                  },
                },
                now.toISOString(),
              );
          }
        }
        run.revision++;
        if (list.some((e) => e.type !== "phase")) run.lastCheckpointAt = now.toISOString();
        const updated = await tx
          .update(syncLocks)
          .set({ runProgress: committed })
          .where(
            and(
              eq(syncLocks.name, "riot"),
              eq(syncLocks.owner, context.owner),
              sql`${syncLocks.runProgress}->'latest'->>'runId' = ${context.runId}`,
              sql`(${syncLocks.runProgress}->'latest'->>'revision')::integer = ${context.envelope!.latest.revision}`,
            ),
          )
          .returning({ name: syncLocks.name });
        if (!updated.length) throw new LeaseLost();
      }
    }
    if (context) await assertLease(tx, { ...context, envelope: committed }, false);
    return value;
  });
  if (context) context.envelope = committed;
  return value;
}
export async function checkpoint(client: RiotClient, event: ProgressEvent) {
  if (leaseContext(client)?.runId) await syncWrite(client, async () => undefined, event);
}
export function requestCorrelation(request: Request) {
  const value = request.headers.get("X-SoloQ-Sync-Request-Id");
  if (value !== null && !z.uuid().safeParse(value).success)
    throw new HttpError(400, "Correlación inválida.");
  return value;
}
export async function readSyncProgress(selector: ProgressSelector = {}) {
  if (isDemo())
    throw new HttpError(503, "El progreso administrativo está deshabilitado en esta demo pública.");
  const [row] = await db()
    .select({
      owner: syncLocks.owner,
      expiresAt: syncLocks.expiresAt,
      runProgress: syncLocks.runProgress,
      now: sql`clock_timestamp()`.mapWith((v) => (v instanceof Date ? v : new Date(String(v)))),
    })
    .from(syncLocks)
    .where(eq(syncLocks.name, "riot"));
  // Empty table still needs a server time, but no second progress query.
  return progressDto(row, row?.now ?? new Date(), selector);
}
