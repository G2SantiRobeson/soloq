import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { body, endpoint, HttpError, json, requireAdmin, verifyOrigin } from "@/server/http";
import { withSyncLease } from "@/server/sync/lease";
function playerId(request: Request) {
  const id = new URL(request.url).pathname.split("/").pop();
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) throw new HttpError(400, "ID inválido.");
  return parsed.data;
}
export const PATCH = endpoint(async (request) => {
  verifyOrigin(request);
  await requireAdmin();
  const id = playerId(request);
  const { enabled } = await body(request, z.object({ enabled: z.boolean() }));
  return withSyncLease(async () => {
    const result = await db()
      .update(players)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(players.id, id))
      .returning({ id: players.id });
    if (!result.length) throw new HttpError(404, "Jugador no encontrado.");
    return json({ ok: true });
  });
});
export const DELETE = endpoint(async (request) => {
  verifyOrigin(request);
  await requireAdmin();
  const id = playerId(request);
  const { confirm } = await body(request, z.object({ confirm: z.literal(true) }));
  if (!confirm) throw new HttpError(400, "Confirma la eliminación.");
  return withSyncLease(async () => {
    await db().transaction(async (tx) => {
      const result = await tx
        .delete(players)
        .where(eq(players.id, id))
        .returning({ id: players.id });
      if (!result.length) throw new HttpError(404, "Jugador no encontrado.");
      await tx.execute(
        sql`delete from matches m where not exists (select 1 from player_matches pm where pm.match_id = m.id)`,
      );
    });
    return json({ ok: true });
  });
});
