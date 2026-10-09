"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { watchAdminProgress } from "@/lib/admin-progress-polling";
import { syncActionSchema, type ProgressDto, type SyncRunAction } from "@/lib/sync-progress";
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
export function useAdminProgress(initial: ProgressDto | undefined, onFinished: () => void) {
  // Do not show a previous SSR run before checking the browser's saved correlation.
  const [observation, setObservation] = useState<ProgressDto | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [correlated, setCorrelated] = useState(false);
  const [awaiting, setAwaiting] = useState(!!initial && initial.control.state !== "available");
  const watcher = useRef<ReturnType<typeof watchAdminProgress> | null>(null);
  const finished = useRef<string | null>(null);
  const notify = useRef(onFinished);
  useEffect(() => {
    notify.current = onFinished;
  }, [onFinished]);
  const observe = useCallback((requestId?: string, startedAt?: number) => {
    watcher.current?.stop();
    watcher.current = watchAdminProgress({
      selector: requestId ? { requestId } : {},
      startedAt,
      onStatus(dto) {
        setCorrelated(!!requestId);
        setObservation(dto);
        setProblem(null);
        if (!requestId) setAwaiting(false);
        else if (!dto.run) setAwaiting(Date.now() - (startedAt ?? Date.now()) < 330_000);
      },
      onProblem(message) {
        setProblem(message);
        if (message.startsWith("Sin ejecución")) setAwaiting(false);
      },
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
    observe(saved.requestId, saved.startedAt);
    return saved.requestId;
  }
  function cancel() {
    watcher.current?.stop();
    setObservation(null);
    setProblem(null);
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
    refresh: () => watcher.current?.refresh(),
    blocked: awaiting || (observation !== null && observation.control.state !== "available"),
  };
}
