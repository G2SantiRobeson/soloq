import { z } from "zod";
import { endpoint, HttpError, json, requireAdmin } from "@/server/http";
import { readSyncProgress } from "@/server/sync/progress";
export const dynamic = "force-dynamic";
export const GET = endpoint(async (request) => {
  await requireAdmin();
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = z
    .object({ requestId: z.uuid().optional(), runId: z.uuid().optional() })
    .strict()
    .refine((s) => !(s.runId && s.requestId))
    .safeParse(query);
  if (!parsed.success) throw new HttpError(400, "Selector de ejecución inválido.");
  return json(await readSyncProgress(parsed.data));
});
