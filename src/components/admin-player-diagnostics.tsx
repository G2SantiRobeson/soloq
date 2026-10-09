import type { AdminPlayer, AdminSyncContext } from "@/lib/admin-sync";
import { attemptActivity } from "@/lib/admin-sync";
import type { PlayerSyncError } from "@/lib/player-sync-state";
import { HISTORY_LABELS } from "@/lib/season";
import { PENDING_LABELS, type SyncPlayerResult } from "@/lib/sync-scheduling";

const phaseLabels = { rank: "Rango", recent: "Recientes", history: "Histórico" };
const outcomes = {
  running: "Inicio sin finalización registrada",
  success: "Éxito de esta fase",
  partial: "Parcial",
  failed: "Fallido",
};
function date(value: string | null, compact = false) {
  return value
    ? `${new Date(value).toLocaleString("es-CL", {
        timeZone: "UTC",
        hour12: false,
        ...(compact ? { dateStyle: "short", timeStyle: "short" } : {}),
      })} UTC`
    : "Desconocido";
}
function ErrorDetail({
  error,
  startedAt,
}: {
  error: PlayerSyncError | null;
  startedAt: string | null;
}) {
  if (!error) return <p className="muted">Sin error registrado; esto no certifica éxito.</p>;
  const previous = startedAt && Date.parse(error.occurredAt) < Date.parse(startedAt);
  return (
    <p className="sync-error">
      {previous ? "Error anterior aún pendiente" : "Error registrado"}: {error.message}
      <br />
      Código: {error.code} · Paso: {error.step} · {date(error.occurredAt)}
    </p>
  );
}

export function AdminPlayerDiagnostics({
  player,
  context,
  recentResult,
  historyResult,
}: {
  player: AdminPlayer;
  context: AdminSyncContext;
  recentResult?: SyncPlayerResult;
  historyResult?: SyncPlayerResult;
}) {
  const s = player.syncState;
  const hasErrors = !!(
    s.rank.error ||
    s.recent.error ||
    s.history.error ||
    player.legacyError ||
    recentResult?.status === "error" ||
    historyResult?.status === "error"
  );
  const unknown = !s.rank.checkedAt || !s.recent.coveredThrough;
  const pendingReason = recentResult?.reason ?? s.lastAttempt?.pendingReason;
  const unfinishedAttempt = s.lastAttempt && s.lastAttempt.outcome !== "success";
  const historyLabel =
    s.history.status === "running" ? "En progreso; reanudable" : HISTORY_LABELS[s.history.status];
  return (
    <div className="admin-diagnostics">
      {(recentResult || historyResult) && (
        <details className="admin-batch-summary">
          <summary>Resultado global de este panel</summary>
          <p className="muted">
            Última ejecución global solicitada desde este panel:
            {recentResult && (
              <>
                <br />
                Rango/recientes:{" "}
                {recentResult.reason
                  ? PENDING_LABELS[recentResult.reason]
                  : recentResult.status === "complete"
                    ? "Cobertura completada"
                    : recentResult.status === "error"
                      ? "Error registrado"
                      : "Parcial o sin actualización"}
                .
              </>
            )}
            {historyResult && (
              <>
                <br />
                Histórico:{" "}
                {historyResult.reason
                  ? PENDING_LABELS[historyResult.reason]
                  : historyResult.status === "complete"
                    ? "Exploración completada"
                    : historyResult.status === "error"
                      ? "Error registrado"
                      : "Parcial o sin actualización"}
                .
              </>
            )}
          </p>
        </details>
      )}
      <div className="admin-sync-summary">
        <p>
          <b>Rango</b>
          <span>
            {s.rank.error ? "Error pendiente · " : ""}
            {s.rank.checkedAt ? "Verificación oficial registrada" : "Verificación desconocida"}
          </span>
        </p>
        <p>
          <b>Recientes</b>
          <span>
            {s.recent.error ? "Error pendiente · " : ""}
            {s.recent.coveredThrough
              ? "Cobertura registrada · ver corte en detalles"
              : "Cobertura desconocida"}
          </span>
        </p>
        <p>
          <b>Histórico · {s.history.season}</b>
          <span>
            {historyLabel}
            {s.history.error ? " · Error pendiente" : ""}
            {s.history.unavailable > 0 ? ` · ${s.history.unavailable} detalles no disponibles` : ""}
            {s.history.discovered > 0 && (
              <small>
                {s.history.processed} / {s.history.discovered} IDs descubiertos
              </small>
            )}
          </span>
        </p>
      </div>
      <p
        className={`admin-player-state ${hasErrors ? "error" : pendingReason || unfinishedAttempt || s.history.status !== "completed" ? "partial" : unknown ? "unknown" : "success"}`}
      >
        {hasErrors
          ? "Errores pendientes de revisión"
          : pendingReason
            ? PENDING_LABELS[pendingReason]
            : unfinishedAttempt
              ? "Última fase parcial, fallida o sin finalización; revisión pendiente"
              : unknown
                ? "Datos pendientes o desconocidos"
                : s.history.status !== "completed"
                  ? "Histórico incompleto; puede continuar"
                  : "Verificaciones y cobertura registradas"}
      </p>
      <details className="admin-sync-details">
        <summary>Ver diagnóstico y fechas</summary>
        <div className="admin-phase-details">
          <section>
            <h3>Rango oficial</h3>
            <p>Última verificación: {date(s.rank.checkedAt)}</p>
            <ErrorDetail error={s.rank.error} startedAt={s.lastAttempt?.startedAt ?? null} />
          </section>
          <section>
            <h3>Partidas recientes</h3>
            <p>Cobertura completa hasta: {date(s.recent.coveredThrough)}</p>
            <p>Última respuesta de IDs: {date(s.recent.lastIdsResponseAt)}</p>
            <ErrorDetail error={s.recent.error} startedAt={s.lastAttempt?.startedAt ?? null} />
          </section>
          <section>
            <h3>Histórico · {s.history.season}</h3>
            <p>
              {historyLabel} · Última actividad: {date(s.history.updatedAt)}
            </p>
            <p>Finalización: {date(s.history.completedAt)}</p>
            <p>
              {s.history.processed} / {s.history.discovered} IDs procesados entre los descubiertos
              hasta ahora. No es un porcentaje de toda la temporada.
            </p>
            <p>
              {s.history.unavailable} detalles no disponibles en Riot.
              {s.history.status === "completed" && s.history.unavailable > 0
                ? " La exploración terminó, pero esos detalles no pudieron importarse."
                : ""}
            </p>
            <ErrorDetail error={s.history.error} startedAt={s.lastAttempt?.startedAt ?? null} />
            {(s.history.status !== "completed" ||
              s.history.cursor.pending > 0 ||
              s.history.cursor.through) && (
              <details>
                <summary>Cursor histórico guardado</summary>
                <p>Temporada del cursor: {s.history.cursor.season ?? "Desconocida"}</p>
                <p>
                  Desde: {date(s.history.cursor.from)} · Corte: {date(s.history.cursor.through)}
                </p>
                <p>
                  Offset: {s.history.cursor.offset} · IDs pendientes: {s.history.cursor.pending} ·
                  Exploración agotada: {s.history.cursor.exhausted ? "Sí" : "No"}
                </p>
              </details>
            )}
          </section>
          <section>
            <h3>Última fase iniciada</h3>
            {s.lastAttempt ? (
              <>
                <p>
                  {phaseLabels[s.lastAttempt.phase]} · {outcomes[s.lastAttempt.outcome]}
                </p>
                <p>
                  Inicio: {date(s.lastAttempt.startedAt)} · Finalización:{" "}
                  {date(s.lastAttempt.finishedAt)}
                </p>
                <p>{attemptActivity(s, context)}</p>
                {s.lastAttempt.pendingReason && (
                  <p>{PENDING_LABELS[s.lastAttempt.pendingReason]}</p>
                )}
              </>
            ) : (
              <p>Desconocida; sin intento registrado.</p>
            )}
            <p className="muted">
              Este resultado describe una sola fase, no la sincronización completa del jugador.
              Actividad evaluada al cargar el panel: {date(context.serverNow)}.
            </p>
          </section>
          {player.legacyError && (
            <section>
              <h3>Error previo sin clasificar</h3>
              <p className="sync-error">{player.legacyError}</p>
              <p>Sin fase ni fecha verificable. No se ha atribuido a ninguna fase.</p>
            </section>
          )}
        </div>
      </details>
    </div>
  );
}
