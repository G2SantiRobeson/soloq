import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { endpoint, HttpError, json, requireAdmin, verifyOrigin } from "@/server/http";
import { withSyncLease, SyncBusy, runIdentity, runErrorIdentity } from "@/server/sync/lease";
import { requestCorrelation } from "@/server/sync/progress";
import { syncPlayer } from "@/server/sync/service";
import { RiotError, SyncDeadline } from "@/server/riot/client";
import { toAdminPlayer } from "@/server/admin-queries";
import type { IndividualSyncResult } from "@/lib/admin-sync";

export const maxDuration = 300;
export const POST = endpoint(async (request) => {
  verifyOrigin(request);
  await requireAdmin();
  const parsed = z.uuid().safeParse(new URL(request.url).pathname.split("/").at(-2));
  if (!parsed.success) throw new HttpError(400, "ID inválido.");
  const id = parsed.data;
  const requestId = requestCorrelation(request);
  let identity = {};
  async function load() {
    const [player] = await db().select().from(players).where(eq(players.id, id));
    if (!player) throw new HttpError(404, "Jugador no encontrado.");
    return player;
  }
  const player = await load();
  if (!player.enabled) throw new HttpError(409, "Activa el jugador antes de actualizarlo.");
  const startedAt = Date.now();
  try {
    // No ladder callbacks: preserve the last outcome/success of the global synchronization.
    const result: IndividualSyncResult = await withSyncLease(
      async (client) => {
        identity = runIdentity(client);
        const synced = await syncPlayer(id, client);
        return { ...synced, syncState: toAdminPlayer(await load()).syncState };
      },
      undefined,
      undefined,
      { action: "player_recent", playerId: id, requestId },
    );
    return json({
      ...identity,
      result,
      message:
        result.status === "complete"
          ? "Rango verificado y cobertura reciente completada. El historial no se ha modificado."
          : result.status === "skipped"
            ? "Jugador omitido: su seguimiento dejó de estar habilitado."
            : "Actualización parcial: el progreso está guardado; la cobertura reciente sigue pendiente.",
    });
  } catch (error) {
    // Let the shared lease persist Retry-After before translating the result.
    if (error instanceof SyncBusy || error instanceof HttpError) throw error;
    const state = toAdminPlayer(await load()).syncState;
    const status = error instanceof SyncDeadline ? "partial" : "error";
    const result: IndividualSyncResult = { playerId: id, status, syncState: state };
    const message =
      error instanceof SyncDeadline
        ? "Actualización parcial por límite de tiempo; el progreso está guardado."
        : error instanceof RiotError
          ? new RiotError(error.status).message
          : "No se pudo completar la actualización. Consulta el registro del servidor.";
    const currentAttempt =
      state.lastAttempt && Date.parse(state.lastAttempt.startedAt) >= startedAt;
    const phaseMessage =
      currentAttempt &&
      state.lastAttempt?.phase === "rank" &&
      state.lastAttempt.outcome !== "success"
        ? " No se alcanzó la importación de recientes."
        : currentAttempt &&
            state.lastAttempt?.phase === "recent" &&
            state.lastAttempt.outcome !== "success" &&
            state.rank.checkedAt &&
            Date.parse(state.rank.checkedAt) >= startedAt
          ? " El rango se verificó; la cobertura reciente quedó pendiente."
          : "";
    const response = json(
      {
        ...runErrorIdentity(error),
        result,
        error: message + phaseMessage,
        message: message + phaseMessage,
      },
      error instanceof SyncDeadline
        ? 200
        : error instanceof RiotError && error.status === 429
          ? 429
          : error instanceof RiotError && error.status === 404
            ? 404
            : error instanceof RiotError
              ? 503
              : 500,
    );
    if (error instanceof RiotError && error.status === 429)
      response.headers.set(
        "Retry-After",
        String(Math.ceil(Math.max(1300, error.retryAfterMs) / 1000)),
      );
    return response;
  }
});
