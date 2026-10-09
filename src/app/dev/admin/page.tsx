import { notFound } from "next/navigation";
import { AdminPanel } from "@/components/admin-panel";
import { adminFixture } from "./fixtures";

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
  const fixtures = [
    adminFixture(0, "completed"),
    adminFixture(1, "running", false),
    adminFixture(2, "failed"),
  ];
  fixtures[0].syncState.rank.checkedAt = "2026-10-09T00:00:00Z";
  fixtures[0].syncState.recent.coveredThrough = "2026-10-01T00:00:00Z";
  fixtures[0].syncState.recent.error = {
    occurredAt: "2026-10-08T00:00:00Z",
    code: 503,
    step: "recent",
    message: "Riot no está disponible temporalmente.",
  };
  fixtures[1].legacyError = "Existe un error previo sin clasificar.";
  fixtures[2].syncState.lastAttempt = {
    phase: "history",
    startedAt: "2026-01-09T00:00:00Z",
    finishedAt: null,
    outcome: "running",
  };
  return (
    <>
      <p className="notice">
        Datos ficticios, solo desarrollo. Sin sesión de administración, cada acción se rechaza antes
        de consultar la base de datos o Riot.
      </p>
      <AdminPanel
        players={fixtures}
        context={{ serverNow: new Date().toISOString(), leaseUntil: null }}
      />
    </>
  );
}
