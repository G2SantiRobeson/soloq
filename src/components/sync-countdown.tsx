"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { countdown, type SyncStatus } from "@/lib/sync-status";
import { watchSync } from "@/lib/sync-polling";

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
  const meta = (initial.updatedAt ?? "") > (observed.updatedAt ?? "") ? initial : observed;
  const due =
    !meta.nextExpectedSyncAt ||
    now >= Date.parse(meta.nextExpectedSyncAt) ||
    meta.status === "running";
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!due) return;
    return watchSync({
      baseline: meta.lastSuccessfulSyncAt,
      request: readStatus,
      onStatus: setObserved,
      onRefresh: () => router.refresh(),
      visible: () => document.visibilityState !== "hidden",
    });
  }, [due, meta.lastSuccessfulSyncAt, router, readStatus]);
  return (
    <span
      className="sync-countdown"
      title="Objetivo desde la última sincronización completa de la ladder. Los lotes incompletos y errores no reinician el contador."
    >
      <span>{countdown(meta, now)}</span>
      {!meta.schedulerConfigured && <small>Programación automática pendiente</small>}
    </span>
  );
}
