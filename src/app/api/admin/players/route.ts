import { z } from "zod";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { PLATFORMS } from "@/lib/routing";
import { body, endpoint, HttpError, json, requireAdmin, verifyOrigin } from "@/server/http";
import { withSyncLease } from "@/server/sync/lease";
import { syncPlayer } from "@/server/sync/service";
import { CURRENT_SEASON, seasonStart } from "@/lib/season";
import { RiotError } from "@/server/riot/client";
export const maxDuration = 300;
export const GET = endpoint(async () => {
  await requireAdmin();
  return json(
    await db()
      .select({
        id: players.id,
        gameName: players.gameName,
        tagLine: players.tagLine,
        platform: players.platform,
        enabled: players.enabled,
        lastSyncedAt: players.lastSyncedAt,
        syncError: players.syncError,
        backfillSeason: players.backfillSeason,
        backfillStatus: players.backfillStatus,
        backfillDiscovered: players.backfillDiscovered,
        backfillProcessed: players.backfillProcessed,
        backfillUnavailable: players.backfillUnavailable,
      })
      .from(players)
      .orderBy(desc(players.createdAt)),
  );
});
const input = z.object({
  gameName: z
    .string()
    .trim()
    .min(3)
    .max(16)
    .regex(/^[^#\p{Cc}]+$/u),
  tagLine: z
    .string()
    .trim()
    .min(3)
    .max(5)
    .regex(/^[\p{L}\p{N}]+$/u),
  platform: z.enum(PLATFORMS),
});
export const POST = endpoint(async (request) => {
  verifyOrigin(request);
  await requireAdmin();
  const values = await body(request, input);
  return withSyncLease(async (client) => {
    const account = await client.account(values.platform, values.gameName, values.tagLine);
    const summoner = await client.summoner(values.platform, account.puuid);
    const [player] = await db()
      .insert(players)
      .values({
        gameName: account.gameName,
        tagLine: account.tagLine,
        puuid: account.puuid,
        platform: values.platform,
        profileIconId: summoner.profileIconId,
        scanStart: seasonStart(values.platform),
        backfillSeason: CURRENT_SEASON.id,
      })
      .onConflictDoNothing({ target: players.puuid })
      .returning({ id: players.id });
    if (!player) throw new HttpError(409, "Esta cuenta ya está registrada (PUUID duplicado).");
    try {
      const result = await syncPlayer(player.id, client, { budget: 5 });
      return json(
        {
          id: player.id,
          message:
            result.status === "complete"
              ? "Jugador añadido y sincronizado."
              : "Jugador añadido. El historial continuará importándose en la próxima sincronización.",
        },
        201,
      );
    } catch (error) {
      // Preserve rate-limit cooldown while returning the created account explicitly.
      if (error instanceof RiotError && error.status === 429) {
        error.message =
          "Jugador añadido. Riot ha limitado la sincronización; continuará más tarde.";
        throw error;
      }
      return json(
        {
          id: player.id,
          message:
            "Jugador añadido. La sincronización quedó pendiente; puedes reintentar desde el panel.",
        },
        201,
      );
    }
  }, 35_000);
});
