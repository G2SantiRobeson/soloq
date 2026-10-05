import "server-only";
import { z } from "zod";
import { authenticated } from "./auth";
import { RiotError, SyncDeadline } from "./riot/client";
import { SyncBusy } from "./sync/lease";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function requireAdmin() {
  if (!(await authenticated())) throw new HttpError(401, "Inicia sesión como administrador.");
}
export function verifyOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.APP_URL || request.url).origin;
  if (origin !== expected) throw new HttpError(403, "Origen de solicitud no permitido.");
}
export async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "Se requiere JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Faltan datos.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      throw new HttpError(413, "Solicitud demasiado grande.");
    }
    chunks.push(value);
  }
  try {
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    throw new HttpError(400, "Revisa los campos enviados.");
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function endpoint(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      if (error instanceof SyncBusy) return json({ error: error.message }, 409);
      if (error instanceof RiotError)
        return json({ error: error.message }, error.status === 404 ? 404 : 503);
      if (error instanceof SyncDeadline) return json({ error: error.message }, 503);
      console.error("request_failed", {
        type: error instanceof Error ? error.name : "UnknownError",
      });
      return json(
        { error: "No se pudo completar la solicitud. Verifica la configuración del servidor." },
        500,
      );
    }
  };
}
