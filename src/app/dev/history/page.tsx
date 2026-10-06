import { notFound } from "next/navigation";
import { AdminPanel, type AdminPlayer } from "@/components/admin-panel";
import { HistoryStatusLabel } from "@/components/history-status";
import { CURRENT_SEASON, type HistoryStatus } from "@/lib/season";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Auditoría de historial",
  robots: { index: false, follow: false },
};

export default function HistoryAudit() {
  if (process.env.NODE_ENV !== "development") notFound();
  const statuses: HistoryStatus["status"][] = ["not_started", "running", "completed", "failed"];
  const fixtures: AdminPlayer[] = statuses.map((status, i) => ({
    id: `fixture-${i}`,
    gameName: `Jugador ${status}`,
    tagLine: "DEMO",
    platform: "LA2",
    enabled: true,
    lastSyncedAt: null,
    syncError:
      status === "failed"
        ? "Riot rechazó la clave. Actualízala y reintenta sin perder el progreso."
        : null,
    backfillSeason: CURRENT_SEASON.id,
    backfillStatus: status,
    backfillDiscovered: status === "not_started" ? 0 : 205,
    backfillProcessed: status === "completed" ? 205 : status === "not_started" ? 0 : 75,
    backfillUnavailable: status === "completed" ? 1 : 0,
  }));
  return (
    <>
      <h1>Auditoría de historial</h1>
      <p className="notice">
        Datos ficticios. Controles deshabilitados; no se consulta ni modifica la base de datos. Solo
        desarrollo.
      </p>
      <fieldset disabled style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <AdminPanel players={fixtures} />
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
