import { z } from "zod";
import { allowLogin, createSession, secureEqual } from "@/server/auth";
import { isDemo, requiredSecret } from "@/server/env";
import { body, endpoint, HttpError, json, verifyOrigin } from "@/server/http";
export const POST = endpoint(async (request) => {
  verifyOrigin(request);
  if (isDemo())
    throw new HttpError(503, "El admin requiere DEMO_MODE=false y una base de datos configurada.");
  const { password } = await body(request, z.object({ password: z.string().min(1).max(256) }));
  const expected = requiredSecret("ADMIN_PASSWORD");
  requiredSecret("ADMIN_SESSION_SECRET");
  if (!(await allowLogin())) throw new HttpError(429, "Demasiados intentos. Espera 15 minutos.");
  if (!secureEqual(password, expected)) throw new HttpError(401, "Contraseña incorrecta.");
  await createSession();
  return json({ ok: true });
});
