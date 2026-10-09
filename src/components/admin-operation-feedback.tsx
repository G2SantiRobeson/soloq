"use client";
import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, LoaderCircle } from "lucide-react";
import type { ProgressDto } from "@/lib/sync-progress";
import type { AdminPlayer } from "@/lib/admin-sync";
import { AdminRunFeedback } from "./admin-run-feedback";
import {
  elapsedLabel,
  waitingMessage,
  watchAdminClock,
  type AdminNotice,
} from "@/lib/admin-operation";

export type AdminWork = { key: string; title: string; startedAt: number };
export function AdminOperationFeedback({
  work,
  notice,
  progress,
  problem,
  players = [],
  refresh,
  correlated = false,
}: {
  work: AdminWork | null;
  notice: AdminNotice | null;
  progress?: ProgressDto | null;
  problem?: string | null;
  players?: AdminPlayer[];
  refresh?: () => void;
  correlated?: boolean;
}) {
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!work) return;
    return watchAdminClock(setClock);
  }, [work]);
  const elapsed = work ? Math.max(0, Math.floor((clock - work.startedAt) / 1000)) : 0;
  const Icon = work
    ? LoaderCircle
    : notice?.kind === "success"
      ? CheckCircle2
      : notice?.kind === "cooldown"
        ? Clock3
        : AlertCircle;
  if (progress?.run && (!work || /^(sync|player-sync:|backfill:|add)/.test(work.key)))
    return (
      <>
        {!correlated && notice && (
          <p className="notice" role={notice.kind === "error" ? "alert" : "status"}>
            {notice.title}: {notice.message}
          </p>
        )}
        <AdminRunFeedback
          dto={progress}
          names={new Map(players.map((p) => [p.id, `${p.gameName}#${p.tagLine}`]))}
          problem={problem}
          refresh={refresh}
          observed={!correlated}
        />
      </>
    );
  return (
    <div className={`admin-feedback ${work || notice ? "visible" : ""}`}>
      <div role="status" aria-live="polite" aria-atomic="true">
        {(work || (notice && notice.kind !== "error")) && (
          <div className={`admin-operation ${work ? "working" : notice?.kind}`}>
            <Icon className={work ? "sync-spinner" : ""} size={22} aria-hidden="true" />
            <div>
              <strong>{work?.title ?? notice?.title}</strong>
              <p>{work ? waitingMessage(elapsed) : notice?.message}</p>
            </div>
          </div>
        )}
      </div>
      <div role="alert" aria-atomic="true">
        {!work && notice?.kind === "error" && (
          <div className="admin-operation error">
            <AlertCircle size={22} aria-hidden="true" />
            <div>
              <strong>{notice.title}</strong>
              <p>{notice.message}</p>
            </div>
          </div>
        )}
      </div>
      {work && (
        <div className="admin-progress-meta">
          <span
            role="progressbar"
            aria-label={work.title}
            aria-valuetext="Progreso indeterminado; esperando la respuesta del servidor"
            className="indeterminate-track"
          />
          <span role="timer" aria-live="off">
            Tiempo en esta página: {elapsedLabel(elapsed)}
          </span>
        </div>
      )}
      {(problem || progress?.selection === "not_found") && (
        <div className="admin-run-details">
          <p className="muted">
            {problem ??
              "Todavía no hay una ejecución correlacionada. Enviar una solicitud no confirma su inicio; no se atribuye progreso anterior a esta acción."}
          </p>
          {progress?.control.until && (
            <p>Lease ocupado o en espera hasta {progress.control.until}.</p>
          )}
          {refresh && (
            <button type="button" className="button secondary" onClick={refresh}>
              Consultar estado
            </button>
          )}
        </div>
      )}
    </div>
  );
}
