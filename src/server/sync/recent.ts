import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { playerMatches, players } from "@/db/schema";
import { isStandardMatch } from "@/lib/queues";
import { seasonStart, seasonEnd } from "@/lib/season";
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
  type MatchScan,
} from "./match-evidence";

export const RECENT_BATCH_SIZE = 5;
export const RECENT_OVERLAP_MS = 86400_000;
export const RIOT_INDEXING_DELAY_MS = 120_000;

// Historical cursors never participate here. Persisted participants are the retry checkpoint.
export async function importRecent(
  player: typeof players.$inferSelect,
  client: RiotClient,
  budget = RECENT_BATCH_SIZE,
  attempt: PlayerSyncAttempt,
) {
  const end = new Date(
    Math.floor(
      Math.min(Date.now() - RIOT_INDEXING_DELAY_MS, seasonEnd()?.getTime() ?? Infinity) / 1000,
    ) * 1000,
  );
  const start = new Date(
    Math.floor(
      Math.max(
        seasonStart(player.platform).getTime(),
        (player.lastSyncedAt ?? player.createdAt).getTime() - RECENT_OVERLAP_MS,
      ) / 1000,
    ) * 1000,
  );
  let imported = 0;
  let offset = 0;
  if (end <= start)
    return {
      playerId: player.id,
      status: "partial" as const,
      imported,
      reason: "window_not_ready" as const,
    };
  let scan: MatchScan | undefined;
  const binding = { playerId: player.id, platform: player.platform, puuid: player.puuid };
  for (;;) {
    client.assertBudget();
    const observed = await client.observeMatchIds(binding, {
      startTime: Math.floor(start.getTime() / 1000),
      endTime: end.getTime() / 1000,
      start: offset,
      count: 100,
    });
    // This remains a successful IDs response marker, separate from scheduling opportunities.
    scan = await syncWrite(client, async (tx) => {
      const current = scan ?? (await openMatchScansInTx(tx, client, player, "recent", start, end));
      await capturePageInTx(tx, client, current, player, observed.capture);
      if (!offset && observed.error === undefined)
        await tx
          .update(players)
          .set({ lastAttemptAt: new Date() })
          .where(eq(players.id, player.id));
      return current;
    });
    if (observed.error !== undefined) throw observed.error;
    const ids = observed.value!;
    const unique = [...new Set(ids)];
    const existing = unique.length
      ? await db()
          .select({ id: playerMatches.matchId })
          .from(playerMatches)
          .where(and(eq(playerMatches.playerId, player.id), inArray(playerMatches.matchId, unique)))
      : [];
    const saved = new Set(existing.map((row) => row.id));
    // One fenced write for reused IDs from this page, no fabricated HTTP timestamps.
    if (saved.size)
      await syncWrite(client, (tx) =>
        captureReusedInTx(tx, client, scan!, [...saved], observed.capture.key),
      );
    for (const id of unique) {
      if (saved.has(id)) continue;
      client.assertBudget();
      if (imported >= budget)
        return {
          playerId: player.id,
          status: "partial" as const,
          imported,
          reason: "batch_limit" as const,
        };
      const detail = await client.observeMatchDetail(binding, id);
      if (detail.error !== undefined) {
        const error = detail.error;
        await syncWrite(client, (tx) =>
          captureDispositionInTx(
            tx,
            client,
            scan!,
            player,
            id,
            error instanceof RiotError && error.status === 404 ? "unavailable_404" : "unknown",
            detail.capture,
            detail.capture.key,
          ),
        );
        // Same recorded-gap policy as historical import; never fabricate missing details.
        if (error instanceof RiotError && error.status === 404) continue;
        throw error;
      }
      const match = detail.value!;
      if (match.metadata.matchId !== id) {
        await syncWrite(client, (tx) =>
          captureDispositionInTx(
            tx,
            client,
            scan!,
            player,
            id,
            "unknown",
            detail.capture,
            detail.capture.key,
          ),
        );
        throw new RiotError(502);
      }
      if (!isStandardMatch(match.info.queueId, match.info.mapId, match.info.gameMode)) {
        await syncWrite(client, (tx) =>
          captureDispositionInTx(
            tx,
            client,
            scan!,
            player,
            id,
            "excluded_with_basis",
            detail.capture,
            detail.capture.key,
          ),
        );
        continue;
      }
      if (
        match.info.gameStartTimestamp < start.getTime() ||
        match.info.gameStartTimestamp >= end.getTime()
      ) {
        await syncWrite(client, (tx) =>
          captureDispositionInTx(
            tx,
            client,
            scan!,
            player,
            id,
            "unknown",
            detail.capture,
            detail.capture.key,
          ),
        );
        throw new RiotError(502);
      }
      const stats = normalizeParticipant(match, player.puuid);
      if (!stats) {
        await syncWrite(client, (tx) =>
          captureDispositionInTx(
            tx,
            client,
            scan!,
            player,
            id,
            "unknown",
            detail.capture,
            detail.capture.key,
          ),
        );
        throw new RiotError(502);
      }
      imported += await syncWrite(
        client,
        async (tx) => {
          const added = await insertMatchParticipation(
            tx,
            {
              id,
              queueId: match.info.queueId,
              mapId: match.info.mapId,
              timestamp: new Date(match.info.gameStartTimestamp),
              duration: match.info.gameDuration,
              isRemake: isRemake(match),
            },
            { playerId: player.id, matchId: id, ...stats },
          );
          await captureDispositionInTx(
            tx,
            client,
            scan!,
            player,
            id,
            "resolved",
            detail.capture,
            detail.capture.key,
          );
          return added;
        },
        (added) => ({ type: "import", pass: "recent", playerId: player.id, imported: added }),
      );
    }
    offset += ids.length;
    // Exactly 100 IDs still requires the next page, even when the import allowance is spent.
    if (ids.length >= 100) continue;
    await syncWrite(
      client,
      async (tx) => {
        await updateSourcePlayer(tx, player.id, {
          lastSyncedAt: end,
          updatedAt: new Date(),
          ...finishPlayerSyncPhase(attempt, "success"),
        });
        await finishMatchScansInTx(tx, client, scan!);
      },
      {
        type: "result",
        pass: "recent",
        result: { playerId: player.id, status: "complete" },
        coveredThrough: end.toISOString(),
      },
    );
    return { playerId: player.id, status: "complete" as const, imported };
  }
}
