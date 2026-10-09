import { notFound } from "next/navigation";
import { AdminPanel } from "@/components/admin-panel";
import { HistoryStatusLabel } from "@/components/history-status";
import { CURRENT_SEASON, type HistoryStatus } from "@/lib/season";
import { adminFixture } from "../admin/fixtures";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Auditoría de historial",
  robots: { index: false, follow: false },
};

export default function HistoryAudit() {
  if (process.env.NODE_ENV !== "development") notFound();
  const statuses: HistoryStatus["status"][] = ["not_started", "running", "completed", "failed"];
  const fixtures = statuses.map((status, i) => adminFixture(i, status));
  return (
    <>
      <h1>Auditoría de historial</h1>
      <p className="notice">
        Datos ficticios. Controles deshabilitados; no se consulta ni modifica la base de datos. Solo
        desarrollo.
      </p>
      <fieldset disabled style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <AdminPanel
          players={fixtures}
          context={{ serverNow: new Date().toISOString(), leaseUntil: null }}
        />
      </fieldset>
      <h2>Estados públicos</h2>
      {fixtures.map((player) => (
        <HistoryStatusLabel
          key={player.id}
          history={{
            season: CURRENT_SEASON.id,
            status: player.backfillStatus,
            discovered: player.backfillDiscovered,
            processed: player.backfillProcessed,
            unavailable: player.backfillUnavailable,
            completedAt: null,
          }}
        />
      ))}
    </>
  );
}
