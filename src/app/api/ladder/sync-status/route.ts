import { endpoint, json } from "@/server/http";
import { getSyncStatus } from "@/server/sync/status";
export const dynamic = "force-dynamic";
// Read-only metadata. Visiting/polling the ladder never starts a Riot request.
export const GET = endpoint(async () => json(await getSyncStatus()));
