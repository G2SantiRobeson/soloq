"use client";
import { useCallback, useRef } from "react";
import { SyncCountdown } from "./sync-countdown";
import { nextExpectedSyncAt, type SyncStatus } from "@/lib/sync-status";

/** Development fixture; no HTTP/Riot requests or database writes. */
export function SyncCountdownAudit({ initial }: { initial: SyncStatus }) {
  const started = useRef(Date.parse(initial.serverNow));
  const readStatus = useCallback(async () => {
    const now = new Date();
    if (now.getTime() - started.current < 8000) return initial;
    const successful = new Date(started.current + 8000).toISOString();
    return {
      ...initial,
      lastSuccessfulSyncAt: successful,
      nextExpectedSyncAt: nextExpectedSyncAt(successful),
      updatedAt: successful,
      serverNow: now.toISOString(),
    };
  }, [initial]);
  return <SyncCountdown initial={initial} readStatus={readStatus} />;
}
