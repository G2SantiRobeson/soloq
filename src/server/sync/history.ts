import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { playerMatches, players } from "@/db/schema";
import { CURRENT_SEASON, seasonStart, seasonEnd } from "@/lib/season";
import { isStandardMatch } from "@/lib/queues";
import { isRemake } from "@/lib/match-outcome";
import { RiotClient, RiotError } from "../riot/client";
import { normalizeParticipant } from "../riot/normalize";
import type { PlayerSyncAttempt } from "@/lib/player-sync-state";
import { finishPlayerSyncPhase } from "./player-state";
import { syncWrite } from "./progress";
import { insertMatchParticipation, updateSourcePlayer } from "./source-revision";
import {
  openMatchScansInTx,
  capturePageInTx,
  captureDispositionInTx,
  captureReusedInTx,
  finishMatchScansInTx,
} from "./match-evidence";
import type { MatchCaptureHandle } from "../riot/match-capture";

export const MATCH_PAGE_SIZE = 100;
export const HISTORY_BATCH_SIZE = 25;
// All callers hold the existing database-backed global Riot lease.
export async function importHistory(
  playerId: string,
  client: RiotClient,
  budget = HISTORY_BATCH_SIZE,
  attempt: PlayerSyncAttempt,
) {
  const [original] = await db().select().from(players).where(eq(players.id, playerId));
  const start = seasonStart(original.platform);
  if (original.backfillSeason !== CURRENT_SEASON.id) {
    await syncWrite(client, async (tx) => {
      await updateSourcePlayer(tx, playerId, {
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
      });
    });
  }
  const [player] = await db().select().from(players).where(eq(players.id, playerId));
  const backfill = player.backfillStatus !== "completed";
  // Freeze both ends until this scan has exhausted every page, even across requests.
  const end =
    player.scanEnd ?? new Date(Math.min(Date.now() - 120_000, seasonEnd()?.getTime() ?? Infinity));
  if (end <= start)
    return {
      playerId,
      status: "partial" as const,
      imported: 0,
      reason: "window_not_ready" as const,
    };
  let pending = player.scanPending;
  let exhausted = player.scanExhausted;
  let offset = player.scanOffset;
  let imported = 0;
  let processed = 0;
  const scan = await syncWrite(
    client,
    async (tx) => {
      await updateSourcePlayer(tx, playerId, {
        scanEnd: end,
        ...(backfill
          ? {
              backfillStatus: "running" as const,
              backfillStartedAt: player.backfillStartedAt ?? new Date(),
              backfillUpdatedAt: new Date(),
            }
          : {}),
      });
      return openMatchScansInTx(
        tx,
        client,
        player,
        backfill ? "season_backfill" : "incremental_repair",
        player.scanStart,
        end,
        offset,
        pending,
        exhausted,
      );
    },
    {
      type: "history",
      playerId,
      history: {
        season: CURRENT_SEASON.id,
        mode: backfill ? "season_backfill" : "incremental_repair",
        discovered: backfill ? player.backfillDiscovered : null,
        processed: backfill ? player.backfillProcessed : null,
        unavailable: backfill ? player.backfillUnavailable : null,
        cursorPending: pending.length,
        scanExhausted: exhausted,
        scanThrough: end.toISOString(),
      },
    },
  );
  for (;;) {
    if (!pending.length && exhausted) {
      await syncWrite(
        client,
        async (tx) => {
          await updateSourcePlayer(tx, playerId, {
            // One-day overlap covers late indexing; constraints prevent duplicate participants.
            scanStart: new Date(Math.max(start.getTime(), end.getTime() - 86400_000)),
            scanEnd: null,
            scanOffset: 0,
            scanPending: [],
            scanExhausted: false,
            ...finishPlayerSyncPhase(attempt, "success"),
            updatedAt: new Date(),
            ...(backfill
              ? {
                  backfillStatus: "completed" as const,
                  lastBackfillAt: new Date(),
                  backfillUpdatedAt: new Date(),
                }
              : {}),
          });
          await finishMatchScansInTx(tx, client, scan);
        },
        { type: "result", pass: "history", result: { playerId, status: "complete" } },
      );
      return { playerId, status: "complete" as const, imported };
    }
    client.assertBudget();
    if (processed >= budget)
      return { playerId, status: "partial" as const, imported, reason: "batch_limit" as const };
    if (!pending.length) {
      const observed = await client.observeMatchIds(
        { playerId, platform: player.platform, puuid: player.puuid },
        {
          startTime: Math.floor(player.scanStart.getTime() / 1000),
          endTime: Math.floor(end.getTime() / 1000),
          start: offset,
          count: 100,
        },
      );
      if (observed.error !== undefined) {
        await syncWrite(client, (tx) =>
          capturePageInTx(tx, client, scan, player, observed.capture),
        );
        throw observed.error;
      }
      const ids = observed.value!;
      pending = [...new Set(ids)];
      exhausted = ids.length < MATCH_PAGE_SIZE;
      offset += ids.length;
      await syncWrite(
        client,
        async (tx) => {
          await capturePageInTx(tx, client, scan, player, observed.capture);
          await updateSourcePlayer(tx, playerId, {
            scanPending: pending,
            scanOffset: offset,
            scanExhausted: exhausted,
            ...(backfill
              ? {
                  backfillDiscovered: sql`${players.backfillDiscovered} + ${pending.length}`,
                  backfillUpdatedAt: new Date(),
                }
              : {}),
          });
        },
        { type: "import", pass: "history", playerId, imported: 0 },
      );
      continue;
    }
    const matchId = pending[0];
    const [existing] = await db()
      .select({ id: playerMatches.matchId })
      .from(playerMatches)
      .where(and(eq(playerMatches.playerId, playerId), eq(playerMatches.matchId, matchId)))
      .limit(1);
    let unavailable = false;
    let capture: MatchCaptureHandle | null = null;
    const reuseKey = randomUUID();
    let normalized: {
      match: Awaited<ReturnType<RiotClient["match"]>>;
      stats: NonNullable<ReturnType<typeof normalizeParticipant>>;
    } | null = null;
    if (!existing) {
      try {
        const observed = await client.observeMatchDetail(
          { playerId, platform: player.platform, puuid: player.puuid },
          matchId,
        );
        capture = observed.capture;
        if (observed.error !== undefined) throw observed.error;
        const match = observed.value!;
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
        if (!(error instanceof RiotError) || error.status !== 404) {
          if (capture)
            await syncWrite(client, (tx) =>
              captureDispositionInTx(
                tx,
                client,
                scan,
                player,
                matchId,
                "unknown",
                capture,
                capture!.key,
              ),
            );
          throw error;
        }
        unavailable = true;
      }
    }
    const next = pending.slice(1);
    // Participant and cursor are atomic: termination cannot lose or double-count progress.
    imported += await syncWrite(
      client,
      async (tx) => {
        let added = 0;
        if (normalized) {
          const { match, stats } = normalized;
          added = await insertMatchParticipation(
            tx,
            {
              id: matchId,
              queueId: match.info.queueId,
              mapId: match.info.mapId,
              timestamp: new Date(match.info.gameStartTimestamp),
              duration: match.info.gameDuration,
              isRemake: isRemake(match),
            },
            { playerId, matchId, ...stats },
          );
        }
        if (existing) await captureReusedInTx(tx, client, scan, [matchId], reuseKey);
        else
          await captureDispositionInTx(
            tx,
            client,
            scan,
            player,
            matchId,
            normalized ? "resolved" : unavailable ? "unavailable_404" : "excluded_with_basis",
            capture,
            capture!.key,
          );
        await updateSourcePlayer(tx, playerId, {
          scanPending: next,
          ...(backfill
            ? {
                backfillProcessed: sql`${players.backfillProcessed} + 1`,
                backfillUnavailable: sql`${players.backfillUnavailable} + ${unavailable ? 1 : 0}`,
                backfillUpdatedAt: new Date(),
              }
            : {}),
        });
        return added;
      },
      (added) => ({
        type: "import",
        pass: "history",
        playerId,
        imported: added,
        confirmedMatchId: matchId,
      }),
    );
    pending = next;
    processed++;
  }
}
