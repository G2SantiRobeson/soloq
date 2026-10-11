import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { body, endpoint, HttpError, json, requireAdmin, verifyOrigin } from "@/server/http";
import { CURRENT_SEASON } from "@/lib/season";
import { runIdentity, withSyncLease } from "@/server/sync/lease";
import { checkpoint, requestCorrelation } from "@/server/sync/progress";
import { syncPlayer, syncBackfillPlayer } from "@/server/sync/service";
export const maxDuration = 300;
export const POST = endpoint(async (request) => {
  verifyOrigin(request);
  await requireAdmin();
  const parsed = z.uuid().safeParse(new URL(request.url).pathname.split("/").at(-2));
  if (!parsed.success) throw new HttpError(400, "ID inválido.");
  const requestId = requestCorrelation(request);
  // Opt-in only. Existing manual callers retain the recent + history operation.
  const automatic =
    request.body !== null
      ? await body(
          request,
          z.object({ historyOnly: z.literal(true), season: z.literal(CURRENT_SEASON.id) }).strict(),
        )
      : null;
  return withSyncLease(
    async (client) => {
      const [player] = await db()
        .select({
          enabled: players.enabled,
          season: players.backfillSeason,
          status: players.backfillStatus,
        })
        .from(players)
        .where(eq(players.id, parsed.data));
      if (!player) throw new HttpError(404, "Jugador no encontrado.");
      if (!player.enabled)
        throw new HttpError(409, "Activa el jugador antes de continuar el historial.");
      const recent = automatic ? null : await syncPlayer(parsed.data, client);
      const alreadyComplete =
        automatic && player.season === CURRENT_SEASON.id && player.status === "completed";
      const result = alreadyComplete
        ? { playerId: parsed.data, status: "complete" as const, imported: 0 }
        : await syncBackfillPlayer(parsed.data, client);
      if (alreadyComplete) {
        await checkpoint(client, { type: "result", pass: "history", result });
      }
      return json({
        ...runIdentity(client),
        outcome:
          (!recent || recent.status === "complete") && result.status === "complete"
            ? "success"
            : "partial",
        message:
          result.status === "complete"
            ? "Historial disponible importado; próximas sincronizaciones incrementales."
            : "Lote guardado. Continúa el siguiente lote o espera la próxima sincronización.",
        results: [result],
      });
    },
    undefined,
    undefined,
    { action: "player_history", playerId: parsed.data, requestId },
  );
});
