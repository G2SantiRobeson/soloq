import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminSessions, loginAttempts } from "@/db/schema";
import { requiredSecret } from "./env";
export const sessionCookie =
  process.env.NODE_ENV === "production" ? "__Host-soloq_admin" : "soloq_admin";
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};
export function secureEqual(a: string, b: string) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
function hashToken(token: string) {
  return createHmac("sha256", requiredSecret("ADMIN_SESSION_SECRET")).update(token).digest("hex");
}
export async function authenticated() {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const [session] = await db()
    .select({ tokenHash: adminSessions.tokenHash })
    .from(adminSessions)
    .where(
      and(eq(adminSessions.tokenHash, hashToken(token)), gt(adminSessions.expiresAt, new Date())),
    )
    .limit(1);
  return Boolean(session);
}
export async function createSession() {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 8 * 3600_000);
  await db().delete(adminSessions).where(lt(adminSessions.expiresAt, new Date()));
  await db()
    .insert(adminSessions)
    .values({ tokenHash: hashToken(token), expiresAt });
  (await cookies()).set(sessionCookie, token, { ...cookieOptions, expires: expiresAt });
}
export async function destroySession() {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (token)
    await db()
      .delete(adminSessions)
      .where(eq(adminSessions.tokenHash, hashToken(token)));
  (await cookies()).set(sessionCookie, "", { ...cookieOptions, maxAge: 0 });
}
export async function allowLogin() {
  // A shared PostgreSQL bucket cannot be bypassed by changing IP or serverless instance.
  const [attempt] = await db()
    .insert(loginAttempts)
    .values({ key: "admin", count: 1, resetsAt: new Date(Date.now() + 15 * 60_000) })
    .onConflictDoUpdate({
      target: loginAttempts.key,
      set: {
        count: sql`case when ${loginAttempts.resetsAt} < now() then 1 else ${loginAttempts.count} + 1 end`,
        resetsAt: sql`case when ${loginAttempts.resetsAt} < now() then now() + interval '15 minutes' else ${loginAttempts.resetsAt} end`,
      },
    })
    .returning();
  return attempt.count <= 10;
}
