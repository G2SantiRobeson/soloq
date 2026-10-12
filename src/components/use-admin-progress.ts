"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { watchAdminProgress, type ManualProgressRead } from "@/lib/admin-progress-polling";
import { syncActionSchema, type ProgressDto, type SyncRunAction } from "@/lib/sync-progress";
import { createAdminProgressVisibility } from "@/lib/admin-progress-visibility";
const storageKey = "soloq-admin-sync-observation-v1";
const savedSchema = z.object({
  requestId: z.uuid(),
  action: syncActionSchema,
  startedAt: z.number().finite(),
});
export function restoreAdminObservation(storage: Pick<Storage, "getItem">) {
  try {
    const parsed = savedSchema.safeParse(JSON.parse(storage.getItem(storageKey) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function clearFinishedAdminObservation(
  storage: Pick<Storage, "getItem" | "removeItem">,
  dto: ProgressDto,
) {
  const run = dto.run;
  if (!run?.finishedAt || !["completed", "partial", "failed"].includes(run.state)) return;
  try {
    if (run.requestId && restoreAdminObservation(storage)?.requestId === run.requestId)
      storage.removeItem(storageKey);
  } catch {
    /* Keep the visibility policy even when browser storage is unavailable. */
  }
}
export function clearDeletedAdminObservation(
  storage: Pick<Storage, "getItem" | "removeItem">,
  dto: ProgressDto | null,
  playerId: string,
) {
  const run = dto?.run;
  if (!run || run.action === "global" || run.playerId !== playerId) return false;
  try {
    if (run.requestId && restoreAdminObservation(storage)?.requestId === run.requestId)
      storage.removeItem(storageKey);
  } catch {
    /* This browser's storage may be unavailable; no remote cleanup is implied. */
  }
  return true;
}
export function useAdminProgress(
  initial: ProgressDto | undefined,
  onFinished: () => void,
  onObservation?: (dto: ProgressDto) => void,
  onUnavailable?: () => void,
) {
  // Do not show a previous SSR run before checking the browser's saved correlation.
  const [observation, setObservation] = useState<ProgressDto | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [manualRead, setManualRead] = useState<ManualProgressRead | null>(null);
  const [correlated, setCorrelated] = useState(false);
  const [awaiting, setAwaiting] = useState(!!initial && initial.control.state !== "available");
  const watcher = useRef<ReturnType<typeof watchAdminProgress> | null>(null);
  const finished = useRef<string | null>(null);
  const notify = useRef(onFinished);
  const observed = useRef(onObservation);
  const unavailable = useRef(onUnavailable);
  const visibility = useRef(createAdminProgressVisibility());
  useEffect(() => {
    notify.current = onFinished;
    observed.current = onObservation;
    unavailable.current = onUnavailable;
  }, [onFinished, onObservation, onUnavailable]);
  const observe = useCallback((requestId?: string, startedAt?: number, live = false) => {
    watcher.current?.stop();
    const presentation = createAdminProgressVisibility(live);
    visibility.current = presentation;
    watcher.current = watchAdminProgress({
      selector: requestId ? { requestId } : {},
      startedAt,
      onManualRead: setManualRead,
      onStatus(dto) {
        setCorrelated(!!requestId);
        const view = presentation.observe(dto);
        if (view.terminal) clearFinishedAdminObservation(sessionStorage, dto);
        setObservation(view.progress);
        observed.current?.(dto);
        setProblem(null);
        if (!requestId) setAwaiting(false);
        else if (!dto.run) setAwaiting(Date.now() - (startedAt ?? Date.now()) < 330_000);
      },
      onProblem(message) {
        setProblem(message);
        if (message.startsWith("Sin ejecución")) setAwaiting(false);
      },
      onUnavailable: () => unavailable.current?.(),
      onFinished(dto) {
        setAwaiting(false);
        if (dto.run && finished.current !== dto.run.runId) {
          finished.current = dto.run.runId;
          notify.current();
        }
      },
    });
  }, []);
  useEffect(() => {
    const saved = restoreAdminObservation(sessionStorage);
    observe(saved?.requestId, saved?.startedAt);
    return () => watcher.current?.stop();
  }, [observe]);
  function begin(action: SyncRunAction) {
    setManualRead(null);
    const saved = { requestId: crypto.randomUUID(), action, startedAt: Date.now() };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      /* Live correlation remains available if storage is disabled. */
    }
    setObservation(null);
    setProblem(null);
    setAwaiting(true);
    setCorrelated(true);
    observe(saved.requestId, saved.startedAt, true);
    return saved.requestId;
  }
  function cancel() {
    watcher.current?.stop();
    setObservation(null);
    setProblem(null);
    setManualRead(null);
    setAwaiting(false);
    setCorrelated(false);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Storage can be unavailable. */
    }
  }
  function rejected() {
    cancel();
    observe();
  }
  return {
    observation,
    problem,
    correlated,
    begin,
    cancel,
    rejected,
    forgetDeletedPlayer: (playerId: string) => {
      // Called only after the server confirms DELETE. Other players and global
      // observations keep their correlation, even if their state is uncertain.
      const run = observation?.run;
      if (run && run.action !== "global" && run.playerId === playerId) {
        try {
          clearDeletedAdminObservation(sessionStorage, observation, playerId);
        } catch {
          /* Accessing the sessionStorage property itself can be disallowed. */
        }
        watcher.current?.stop();
        setObservation(null);
        setProblem(null);
        setManualRead(null);
        setAwaiting(false);
        setCorrelated(false);
        observe();
      }
    },
    refresh: () => watcher.current?.refresh(),
    refreshManual: () => {
      visibility.current.reveal();
      watcher.current?.refreshManual();
    },
    manualRead,
    blocked: awaiting || (observation !== null && observation.control.state !== "available"),
  };
}
