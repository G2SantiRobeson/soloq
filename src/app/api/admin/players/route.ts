import { z } from "zod";
import { players } from "@/db/schema";
import { PLATFORMS } from "@/lib/routing";
import { body, endpoint, HttpError, json, requireAdmin, verifyOrigin } from "@/server/http";
import { runIdentity, withSyncLease } from "@/server/sync/lease";
import { requestCorrelation, syncWrite, LeaseLost } from "@/server/sync/progress";
import { syncPlayer, syncBackfillPlayer } from "@/server/sync/service";
import { CURRENT_SEASON, seasonStart } from "@/lib/season";
import { RiotError } from "@/server/riot/client";
import { getAdminPlayers } from "@/server/admin-queries";
export const maxDuration = 300;
export const GET = endpoint(async () => {
  await requireAdmin();
  return json(await getAdminPlayers());
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
  const requestId = requestCorrelation(request);
  return withSyncLease(
    async (client) => {
      const account = await client.account(values.platform, values.gameName, values.tagLine);
      const summoner = await client.summoner(values.platform, account.puuid);
      const [player] = await syncWrite(client, async (tx) =>
        tx
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
          .returning({ id: players.id }),
      );
      if (!player) throw new HttpError(409, "Esta cuenta ya está registrada (PUUID duplicado).");
      try {
        const result = await syncPlayer(player.id, client, { budget: 5 });
        const backfill = await syncBackfillPlayer(player.id, client, 5);
        return json(
          {
            ...runIdentity(client),
            id: player.id,
            message:
              result.status === "complete"
                ? backfill.status === "complete"
                  ? "Jugador añadido y sincronizado."
                  : "Jugador añadido. Partidas recientes al día; el historial continuará importándose."
                : "Jugador añadido. La sincronización reciente y el historial continuarán en la próxima ejecución.",
          },
          201,
        );
      } catch (error) {
        if (error instanceof LeaseLost) throw error;
        // Preserve rate-limit cooldown while returning the created account explicitly.
        if (error instanceof RiotError && error.status === 429) {
          error.message =
            "Jugador añadido. Riot ha limitado la sincronización; continuará más tarde.";
          throw error;
        }
        return json(
          {
            ...runIdentity(client),
            id: player.id,
            message:
              "Jugador añadido. La sincronización quedó pendiente; puedes reintentar desde el panel.",
          },
          201,
        );
      }
    },
    35_000,
    undefined,
    { action: "player_add", requestId },
  );
});
