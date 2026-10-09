import { endpoint, json, requireAdmin, verifyOrigin } from "@/server/http";
import { syncAllPlayers } from "@/server/sync/service";
import { requestCorrelation } from "@/server/sync/progress";
export const maxDuration = 300;
export const POST = endpoint(async (request) => {
  verifyOrigin(request);
  await requireAdmin();
  const { results, recent, backfill, outcome, runId, requestId } = await syncAllPlayers({
    action: "global",
    requestId: requestCorrelation(request),
  });
  return json({
    runId,
    requestId,
    results,
    recent,
    backfill,
    outcome,
    message: `${recent.complete} de ${recent.eligible} jugadores con recientes al día; ${recent.budgetPending} pendientes por presupuesto, ${recent.errors} con error. Historial: ${backfill.pending} pendientes, ${backfill.errors} con error.`,
  });
});
