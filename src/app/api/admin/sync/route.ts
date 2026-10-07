import { endpoint, json, requireAdmin, verifyOrigin } from "@/server/http";
import { syncAllPlayers } from "@/server/sync/service";
export const maxDuration = 300;
export const POST = endpoint(async (request) => {
  verifyOrigin(request);
  await requireAdmin();
  const { results, recent, backfill, outcome } = await syncAllPlayers();
  return json({
    results,
    recent,
    backfill,
    outcome,
    message: `${recent.complete} de ${recent.eligible} jugadores con recientes al día; ${recent.pending} pendientes. Historial: ${backfill.pending} pendientes, ${backfill.errors} con error.`,
  });
});
