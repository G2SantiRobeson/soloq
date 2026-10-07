"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, RefreshCw } from "lucide-react";
import { syncCountdownLabel, type SyncStatus } from "@/lib/sync-status";
import { watchSync } from "@/lib/sync-polling";
import { InfoTip } from "./info-tip";

const TICK_MS = 10_000;

async function readSyncStatus(signal: AbortSignal): Promise<SyncStatus> {
  const response = await fetch("/api/ladder/sync-status", { cache: "no-store", signal });
  if (!response.ok) throw new Error("Metadata temporarily unavailable");
  return response.json() as Promise<SyncStatus>;
}

export function SyncCountdown({
  initial,
  readStatus = readSyncStatus,
}: {
  initial: SyncStatus;
  readStatus?: (signal: AbortSignal) => Promise<SyncStatus>;
}) {
  const router = useRouter();
  const [observed, setObserved] = useState(initial);
  const [now, setNow] = useState(() => Date.parse(initial.serverNow));
  // New results wait for the reader: refreshing on its own would reorder the table under them.
  const [newResults, setNewResults] = useState(false);
  const meta = (initial.updatedAt ?? "") > (observed.updatedAt ?? "") ? initial : observed;
  const due =
    !meta.nextExpectedSyncAt ||
    now >= Date.parse(meta.nextExpectedSyncAt) ||
    meta.status === "running";
  const label = syncCountdownLabel(meta, now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!due) return;
    return watchSync({
      baseline: meta.lastSuccessfulSyncAt,
      request: readStatus,
      onStatus: setObserved,
      onRefresh: () => setNewResults(true),
      visible: () => document.visibilityState !== "hidden",
    });
  }, [due, meta.lastSuccessfulSyncAt, readStatus]);
  function applyResults() {
    setNewResults(false);
    router.refresh();
  }
  return (
    <div className="sync-area">
      <p className="sync-countdown">
        <Clock3 size={16} aria-hidden="true" />
        <span className="sync-countdown-label">Próxima actualización</span>
        <strong>{label ?? "sin programar"}</strong>
        <InfoTip label="Cómo se calcula la próxima actualización" align="start">
          Se cuenta desde la última actualización completa de la clasificación. Las actualizaciones
          parciales y los errores no reinician el contador.
        </InfoTip>
        {!label && (
          <small>
            {meta.status === "partial"
              ? "Último intento parcial"
              : meta.status === "failed"
                ? "Último intento fallido"
                : "Aún no hay una actualización completa"}
          </small>
        )}
        {!meta.schedulerConfigured && (
          <small>Las actualizaciones automáticas no están activas</small>
        )}
      </p>
      <div role="status" className="refresh-slot">
        {newResults && (
          <div className="refresh-notice">
            <p>
              <strong>Hay resultados nuevos.</strong> La tabla no se reordena sola mientras la usas.
            </p>
            <button type="button" className="button primary" onClick={applyResults}>
              <RefreshCw size={16} aria-hidden="true" />
              Actualizar tabla
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
