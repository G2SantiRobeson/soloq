import { notFound } from "next/navigation";
import { AdminPanel, type AdminPlayer } from "@/components/admin-panel";
import { CURRENT_SEASON } from "@/lib/season";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Auditoría de administración",
  robots: { index: false, follow: false },
};

/**
 * Interactive admin fixture for UI QA. Without an admin session every action is
 * rejected by requireAdmin() before any database or Riot call, which exercises the
 * pending, error and focus states safely.
 */
export default function AdminAudit() {
  if (process.env.NODE_ENV !== "development") notFound();
  const fixtures: AdminPlayer[] = [true, false].map((enabled, i) => ({
    id: `fixture-${i}`,
    gameName: enabled ? "Jugador activo" : "Jugador pausado",
    tagLine: "DEMO",
    platform: "LA2",
    enabled,
    lastSyncedAt: null,
    syncError: null,
    backfillSeason: CURRENT_SEASON.id,
    backfillStatus: "running",
    backfillDiscovered: 205,
    backfillProcessed: 75,
    backfillUnavailable: 0,
  }));
  return (
    <>
      <p className="notice">
        Datos ficticios, solo desarrollo. Sin sesión de administración, cada acción se rechaza antes
        de consultar la base de datos o Riot.
      </p>
      <AdminPanel players={fixtures} />
    </>
  );
}
