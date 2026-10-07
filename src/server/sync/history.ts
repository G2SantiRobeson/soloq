import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { matches, playerMatches, players } from "@/db/schema";
import { CURRENT_SEASON, seasonStart, seasonEnd } from "@/lib/season";
import { isStandardMatch } from "@/lib/queues";
import { isRemake } from "@/lib/match-outcome";
import { RiotClient, RiotError } from "../riot/client";
import { normalizeParticipant } from "../riot/normalize";

export const MATCH_PAGE_SIZE = 100;
export const HISTORY_BATCH_SIZE = 25;
// All callers hold the existing database-backed global Riot lease.
export async function importHistory(
  playerId: string,
  client: RiotClient,
  budget = HISTORY_BATCH_SIZE,
) {
  const [original] = await db().select().from(players).where(eq(players.id, playerId));
  const start = seasonStart(original.platform);
  if (original.backfillSeason !== CURRENT_SEASON.id) {
    await db()
      .update(players)
      .set({
        backfillSeason: CURRENT_SEASON.id,
        backfillStatus: "not_started",
        backfillStartedAt: null,
        lastBackfillAt: null,
        backfillDiscovered: 0,
        backfillProcessed: 0,
        backfillUnavailable: 0,
        scanStart: start,
        scanEnd: null,
        scanOffset: 0,
        scanPending: [],
        scanExhausted: false,
      })
      .where(eq(players.id, playerId));
  }
  const [player] = await db().select().from(players).where(eq(players.id, playerId));
  const backfill = player.backfillStatus !== "completed";
  // Freeze both ends until this scan has exhausted every page, even across requests.
  const end =
    player.scanEnd ?? new Date(Math.min(Date.now() - 120_000, seasonEnd()?.getTime() ?? Infinity));
  if (end <= start) return { playerId, status: "partial" as const, imported: 0 };
  let pending = player.scanPending;
  let exhausted = player.scanExhausted;
  let offset = player.scanOffset;
  let imported = 0;
  let processed = 0;
  await db()
    .update(players)
    .set({
      scanEnd: end,
      syncError: null,
      ...(backfill
        ? {
            backfillStatus: "running" as const,
            backfillStartedAt: player.backfillStartedAt ?? new Date(),
            backfillUpdatedAt: new Date(),
          }
        : {}),
    })
    .where(eq(players.id, playerId));
  for (;;) {
    if (!pending.length && exhausted) {
      await db()
        .update(players)
        .set({
          // One-day overlap covers late indexing; constraints prevent duplicate participants.
          scanStart: new Date(Math.max(start.getTime(), end.getTime() - 86400_000)),
          scanEnd: null,
          scanOffset: 0,
          scanPending: [],
          scanExhausted: false,
          syncError: null,
          updatedAt: new Date(),
          ...(backfill
            ? {
                backfillStatus: "completed" as const,
                lastBackfillAt: new Date(),
                backfillUpdatedAt: new Date(),
              }
            : {}),
        })
        .where(eq(players.id, playerId));
      return { playerId, status: "complete" as const, imported };
    }
    if (processed >= budget) return { playerId, status: "partial" as const, imported };
    if (!pending.length) {
      const ids = await client.matchIds(
        player.platform,
        player.puuid,
        Math.floor(player.scanStart.getTime() / 1000),
        Math.floor(end.getTime() / 1000),
        offset,
      );
      pending = [...new Set(ids)];
      exhausted = ids.length < MATCH_PAGE_SIZE;
      offset += ids.length;
      await db()
        .update(players)
        .set({
          scanPending: pending,
          scanOffset: offset,
          scanExhausted: exhausted,
          ...(backfill
            ? {
                backfillDiscovered: sql`${players.backfillDiscovered} + ${pending.length}`,
                backfillUpdatedAt: new Date(),
              }
            : {}),
        })
        .where(eq(players.id, playerId));
      continue;
    }
    const matchId = pending[0];
    const [existing] = await db()
      .select({ id: playerMatches.matchId })
      .from(playerMatches)
      .where(and(eq(playerMatches.playerId, playerId), eq(playerMatches.matchId, matchId)))
      .limit(1);
    let unavailable = false;
    let normalized: {
      match: Awaited<ReturnType<RiotClient["match"]>>;
      stats: NonNullable<ReturnType<typeof normalizeParticipant>>;
    } | null = null;
    if (!existing) {
      try {
        const match = await client.match(player.platform, matchId);
        if (match.metadata.matchId !== matchId) throw new RiotError(502);
        if (
          isStandardMatch(match.info.queueId, match.info.mapId, match.info.gameMode) &&
          match.info.gameStartTimestamp >= start.getTime() &&
          match.info.gameStartTimestamp < (seasonEnd()?.getTime() ?? Infinity)
        ) {
          const stats = normalizeParticipant(match, player.puuid);
          if (!stats) throw new RiotError(502);
          normalized = { match, stats };
        }
      } catch (error) {
        // Missing Riot details are a recorded gap, not a fabricated match or a blocked season.
        if (!(error instanceof RiotError) || error.status !== 404) throw error;
        unavailable = true;
      }
    }
    const next = pending.slice(1);
    // Participant and cursor are atomic: termination cannot lose or double-count progress.
    await db().transaction(async (tx) => {
      if (normalized) {
        const { match, stats } = normalized;
        await tx
          .insert(matches)
          .values({
            id: matchId,
            queueId: match.info.queueId,
            mapId: match.info.mapId,
            timestamp: new Date(match.info.gameStartTimestamp),
            duration: match.info.gameDuration,
            isRemake: isRemake(match),
          })
          .onConflictDoNothing();
        const inserted = await tx
          .insert(playerMatches)
          .values({ playerId, matchId, ...stats })
          .onConflictDoNothing()
          .returning({ id: playerMatches.matchId });
        imported += inserted.length;
      }
      await tx
        .update(players)
        .set({
          scanPending: next,
          ...(backfill
            ? {
                backfillProcessed: sql`${players.backfillProcessed} + 1`,
                backfillUnavailable: sql`${players.backfillUnavailable} + ${unavailable ? 1 : 0}`,
                backfillUpdatedAt: new Date(),
              }
            : {}),
        })
        .where(eq(players.id, playerId));
    });
    pending = next;
    processed++;
  }
}
