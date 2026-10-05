import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { authenticated } from "@/server/auth";
import { isDemo } from "@/server/env";
import { db } from "@/db";
import { players } from "@/db/schema";
import { AdminPanel, LoginForm } from "@/components/admin-panel";
export const metadata: Metadata = {
  title: "Administración",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const demo = isDemo();
  if (demo || !(await authenticated())) return <LoginForm demo={demo} />;
  const list = await db()
    .select({
      id: players.id,
      gameName: players.gameName,
      tagLine: players.tagLine,
      platform: players.platform,
      enabled: players.enabled,
      lastSyncedAt: players.lastSyncedAt,
      syncError: players.syncError,
    })
    .from(players)
    .orderBy(desc(players.createdAt));
  return (
    <AdminPanel
      players={list.map((p) => ({ ...p, lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null }))}
    />
  );
}
