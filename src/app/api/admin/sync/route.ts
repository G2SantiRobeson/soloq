import { endpoint, json, requireAdmin, verifyOrigin } from "@/server/http";
import { syncAllPlayers } from "@/server/sync/service";
export const maxDuration = 300;
export const POST = endpoint(async (request) => {
  verifyOrigin(request);
  await requireAdmin();
  return json({ results: await syncAllPlayers() });
});
