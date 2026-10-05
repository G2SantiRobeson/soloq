import { destroySession } from "@/server/auth";
import { endpoint, json, requireAdmin, verifyOrigin } from "@/server/http";
export const POST = endpoint(async (request) => {
  verifyOrigin(request);
  await requireAdmin();
  await destroySession();
  return json({ ok: true });
});
