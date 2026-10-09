import type { Metadata } from "next";
import { authenticated } from "@/server/auth";
import { isDemo } from "@/server/env";
import { getAdminPlayers, getAdminSyncContext } from "@/server/admin-queries";
import { AdminPanel, LoginForm } from "@/components/admin-panel";
export const metadata: Metadata = {
  title: "Administración",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const demo = isDemo();
  if (demo || !(await authenticated())) return <LoginForm demo={demo} />;
  const [list, context] = await Promise.all([getAdminPlayers(), getAdminSyncContext()]);
  return <AdminPanel players={list} context={context} />;
}
