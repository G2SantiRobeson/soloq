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
  const results = await syncAllPlayers();
  console.info("cron_sync_complete", {
    complete: results.filter((r) => r.status === "complete").length,
    partial: results.filter((r) => r.status === "partial").length,
    errors: results.filter((r) => r.status === "error").length,
  });
  return json({ results });
});
