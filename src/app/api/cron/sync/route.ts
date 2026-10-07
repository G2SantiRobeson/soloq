import { secureEqual } from "@/server/auth";
import { requiredSecret } from "@/server/env";
import { endpoint, HttpError, json } from "@/server/http";
import { syncAllPlayers } from "@/server/sync/service";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const GET = endpoint(async (request) => {
  const expected = `Bearer ${requiredSecret("CRON_SECRET")}`;
  if (!secureEqual(request.headers.get("authorization") ?? "", expected))
    throw new HttpError(401, "No autorizado.");
  const { results, recent, backfill, outcome } = await syncAllPlayers();
  console.info("cron_sync_complete", {
    ...recent,
    backfillComplete: backfill.complete,
    backfillPending: backfill.pending,
    backfillErrors: backfill.errors,
  });
  return json({ results, recent, backfill, outcome });
});
