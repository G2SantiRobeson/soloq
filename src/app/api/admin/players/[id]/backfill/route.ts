import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { endpoint, HttpError, json, requireAdmin, verifyOrigin } from "@/server/http";
import { withSyncLease } from "@/server/sync/lease";
import { syncPlayer, syncBackfillPlayer } from "@/server/sync/service";
export const maxDuration = 300;
export const POST = endpoint(async (request) => {
  verifyOrigin(request);
  await requireAdmin();
  const parsed = z.uuid().safeParse(new URL(request.url).pathname.split("/").at(-2));
  if (!parsed.success) throw new HttpError(400, "ID inválido.");
  return withSyncLease(async (client) => {
    const [player] = await db()
      .select({ enabled: players.enabled })
      .from(players)
      .where(eq(players.id, parsed.data));
    if (!player) throw new HttpError(404, "Jugador no encontrado.");
    if (!player.enabled)
      throw new HttpError(409, "Activa el jugador antes de continuar el historial.");
    await syncPlayer(parsed.data, client);
    const result = await syncBackfillPlayer(parsed.data, client);
    return json({
      message:
        result.status === "complete"
          ? "Historial disponible importado; próximas sincronizaciones incrementales."
          : "Lote guardado. Continúa el siguiente lote o espera la próxima sincronización.",
      results: [result],
    });
  });
});
