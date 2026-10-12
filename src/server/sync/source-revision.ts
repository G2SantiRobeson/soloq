import "server-only";
import { and, asc, eq, getTableColumns, inArray, SQL, sql } from "drizzle-orm";
import { matches, playerMatches, players } from "@/db/schema";
import type { SyncTransaction } from "./progress";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

// Transaction-local bookkeeping, never a lease or a revision calculated in JS.
const changed = new WeakMap<SyncTransaction, Set<string>>();
const contextKeys = new Set([
  "puuid",
  "platform",
  "enabled",
  "rankCheckedAt",
  "lastSyncedAt",
  "backfillSeason",
  "backfillStatus",
  "backfillStartedAt",
  "lastBackfillAt",
  "backfillDiscovered",
  "backfillProcessed",
  "backfillUnavailable",
  "scanStart",
  "scanEnd",
  "scanOffset",
  "scanPending",
  "scanExhausted",
]);
type PlayerPatch = Omit<PgUpdateSetSource<typeof players>, "id" | "sourceRevision">;

export async function lockSourcePlayers(tx: SyncTransaction, ids: string[]) {
  const ordered = [...new Set(ids)].sort();
  if (!ordered.length) return [];
  return tx
    .select({ id: players.id })
    .from(players)
    .where(inArray(players.id, ordered))
    .orderBy(asc(players.id))
    .for("update");
}
// Caller must hold the player row lock, including for newly created rows.
export function markSourceChanged(tx: SyncTransaction, id: string) {
  let ids = changed.get(tx);
  if (!ids) {
    ids = new Set();
    changed.set(tx, ids);
  }
  ids.add(id);
}
export async function flushSourceRevisions(tx: SyncTransaction) {
  const ids = changed.get(tx);
  if (!ids?.size) return;
  await tx
    .update(players)
    .set({ sourceRevision: sql`${players.sourceRevision} + 1` })
    .where(inArray(players.id, [...ids].sort()));
  changed.delete(tx);
}

/** Compare source context before UPDATE under its row lock; diagnostic fields are excluded. */
export async function updateSourcePlayer(tx: SyncTransaction, id: string, patch: PlayerPatch) {
  const columns = getTableColumns(players);
  const differences = Object.entries(patch)
    .filter(([key, value]) => contextKeys.has(key) && value !== undefined)
    .map(([key, value]) => {
      const column = columns[key as keyof typeof columns];
      return sql`${column} is distinct from ${value instanceof SQL ? value : sql.param(value, column)}`;
    });
  if (differences.length) {
    const [before] = await tx
      .select({
        changed: sql<boolean>`(${sql.join(differences, sql` or `)})`,
      })
      .from(players)
      .where(eq(players.id, id))
      .for("update");
    if (!before) return [];
    if (before.changed) markSourceChanged(tx, id);
  }
  return tx.update(players).set(patch).where(eq(players.id, id)).returning({ id: players.id });
}

export class SourceConflict extends Error {
  constructor() {
    super("La fuente recibida no coincide con los registros almacenados; requiere revisión.");
  }
}
type MatchSource = typeof matches.$inferInsert;
type ParticipantSource = typeof playerMatches.$inferInsert;

function participationFloat4(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new SourceConflict();
  return Math.fround(value);
}

/** Match-row lock is also used by remake classification: no association can slip past its fanout. */
export async function insertMatchParticipation(
  tx: SyncTransaction,
  source: MatchSource,
  participant: ParticipantSource,
) {
  const incomingParticipation = participationFloat4(participant.killParticipation);
  if (source.id !== participant.matchId) throw new SourceConflict();
  await tx.insert(matches).values(source).onConflictDoNothing();
  const [stored] = await tx.select().from(matches).where(eq(matches.id, source.id)).for("update");
  if (
    !stored ||
    stored.queueId !== source.queueId ||
    stored.mapId !== source.mapId ||
    stored.timestamp.getTime() !== source.timestamp.getTime() ||
    stored.duration !== source.duration ||
    stored.isRemake !== (source.isRemake ?? null)
  )
    throw new SourceConflict();
  const owners = await lockSourcePlayers(tx, [participant.playerId]);
  if (!owners.length) throw new SourceConflict();
  const inserted = await tx
    .insert(playerMatches)
    .values(participant)
    .onConflictDoNothing()
    .returning({ id: playerMatches.matchId });
  if (inserted.length) {
    markSourceChanged(tx, participant.playerId);
    return 1;
  }
  const [previous] = await tx
    .select()
    .from(playerMatches)
    .where(
      and(eq(playerMatches.playerId, participant.playerId), eq(playerMatches.matchId, source.id)),
    );
  // PostgreSQL real stores float4: compare the same representation, not a rounded percentage.
  const identical =
    previous &&
    Object.entries(participant).every(([key, value]) => {
      const saved = previous[key as keyof typeof previous];
      if (key === "killParticipation") return participationFloat4(saved) === incomingParticipation;
      return saved === value;
    });
  if (!identical) throw new SourceConflict();
  // Identical reuse is deduplication, never a new Riot provenance attestation.
  return 0;
}

export async function classifyStoredRemake(tx: SyncTransaction, matchId: string, remake: boolean) {
  const [stored] = await tx
    .select({ isRemake: matches.isRemake })
    .from(matches)
    .where(eq(matches.id, matchId))
    .for("update");
  if (!stored || stored.isRemake === remake) return false;
  // Discover only after the match lock; every new association uses that same lock first.
  const owners = await tx
    .select({ id: playerMatches.playerId })
    .from(playerMatches)
    .where(eq(playerMatches.matchId, matchId));
  const locked = await lockSourcePlayers(
    tx,
    owners.map((p) => p.id),
  );
  await tx.update(matches).set({ isRemake: remake }).where(eq(matches.id, matchId));
  for (const p of locked) markSourceChanged(tx, p.id);
  return true;
}
