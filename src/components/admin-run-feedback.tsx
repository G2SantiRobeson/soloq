import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import type { ProgressDto, ProgressRun } from "@/lib/sync-progress";
import { PENDING_LABELS } from "@/lib/sync-scheduling";
import type { ManualProgressRead } from "@/lib/admin-progress-polling";

export function AdminProgressQuery({
  refresh,
  result,
}: {
  refresh: () => void;
  result?: ManualProgressRead | null;
}) {
  const loading = result?.state === "loading";
  const messages = {
    loading: "Obteniendo el estado actualizado del servidor…",
    changed: "Estado actualizado",
    unchanged: "Consulta completada. Sin cambios desde la última consulta",
    error: "No se pudo consultar el estado",
  };
  return (
    <div>
      <button
        type="button"
        className="button secondary"
        onClick={refresh}
        disabled={loading}
        aria-busy={loading}
      >
        {loading && <LoaderCircle size={16} className="sync-spinner" aria-hidden="true" />}
        {loading ? "Consultando…" : "Consultar estado"}
      </button>
      <p role="status" aria-live="polite" aria-atomic="true">
        {result && messages[result.state]}
      </p>
      {result?.lastSuccessfulAt != null && (
        <p className="muted" aria-live="off">
          Última consulta exitosa (hora local):{" "}
          {new Date(result.lastSuccessfulAt).toLocaleString("es-CL", { hour12: false })}
        </p>
      )}
    </div>
  );
}

const actions = {
  global: "Actualización global",
  player_recent: "Rango y recientes",
  player_history: "Continuación histórica",
  player_add: "Alta de jugador",
};
const phases = {
  planning: "Planificación",
  identity: "Identidad",
  rank: "Rango oficial",
  recent: "Partidas recientes",
  history: "Histórico",
  finalizing: "Finalización",
};
const states = {
  running: "Inicio registrado · lease vigente",
  completed: "Completada",
  partial: "Finalizada con pendientes",
  failed: "Finalizada con errores",
  interrupted: "Interrumpida · perdió la propiedad",
  possibly_interrupted: "Posiblemente interrumpida · lease vencido",
};
const workStates = {
  queued: "Sin turno todavía",
  running: "Fase iniciada",
  complete: "Completada",
  partial: "Parcial",
  error: "Error",
  skipped: "Omitida",
};
function date(value: string | null) {
  return value
    ? `${new Date(value).toLocaleString("es-CL", { timeZone: "UTC", hour12: false })} UTC`
    : "Sin checkpoint registrado";
}
function Pass({ title, pass }: { title: string; pass: ProgressRun["recent"] }) {
  if (!pass) return null;
  return (
    <p>
      <b>{title}:</b> {pass.visited} con turno de {pass.eligible} elegibles · {pass.complete}{" "}
      completos · {pass.partial} parciales · {pass.errors} errores · {pass.unvisited} sin turno ·{" "}
      {pass.imported} participaciones nuevas guardadas.
    </p>
  );
}
export function AdminRunFeedback({
  dto,
  names,
  problem,
  refresh,
  observed = false,
  manualRead,
}: {
  dto: ProgressDto;
  names: Map<string, string>;
  problem?: string | null;
  refresh?: () => void;
  observed?: boolean;
  manualRead?: ManualProgressRead | null;
}) {
  const run = dto.run;
  if (!run) return null;
  const active = run.state === "running";
  const Icon = active ? LoaderCircle : run.state === "completed" ? CheckCircle2 : AlertCircle;
  return (
    <div className="admin-feedback visible admin-run-feedback">
      <div
        className={`admin-operation ${active ? "working" : run.state === "failed" ? "error" : "partial"}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <Icon size={22} aria-hidden="true" className={active ? "sync-spinner" : ""} />
        <div>
          <strong>
            {observed && "Ejecución observada · "}
            {actions[run.action]}
            {run.playerId ? ` · ${names.get(run.playerId) ?? "Jugador registrado"}` : ""}
          </strong>
          <p>
            {states[run.state]} · {phases[run.phase]}
          </p>
        </div>
      </div>
      <div className="admin-run-details" aria-live="off">
        {active && (
          <p className="muted">
            La fase fue iniciada; el lease vigente no acredita que el proceso siga avanzando. Solo
            los checkpoints confirman progreso.
          </p>
        )}
        <p>
          Inicio: {date(run.startedAt)}
          <br />
          Último checkpoint: {date(run.lastCheckpointAt)}
          {run.finishedAt && (
            <>
              <br />
              Finalización: {date(run.finishedAt)}
            </>
          )}
        </p>
        <Pass title="Recientes" pass={run.recent} />
        <Pass title="Histórico" pass={run.history} />
        {run.recentOutcome === "success" && run.state !== "completed" && (
          <p>
            La cobertura reciente fue completada; el histórico tiene un resultado independiente.
          </p>
        )}
        {run.players.length > 0 && (
          <details className="admin-batch-summary disclosure disclosure-inline">
            <summary>Checkpoints por jugador ({run.players.length})</summary>
            {run.players.map((p) => (
              <div className="admin-run-player" key={p.playerId}>
                <b>{names.get(p.playerId) ?? "Jugador registrado"}</b>
                <p>
                  Rango:{" "}
                  {p.rank
                    ? `verificado · ${date(p.rank.checkedAt)}`
                    : "sin verificación en esta ejecución"}
                </p>
                {(["recent", "history"] as const).map((pass) => {
                  const w = p[pass];
                  if (!w) return null;
                  return (
                    <p key={pass}>
                      {pass === "recent" ? "Recientes" : "Histórico"}: {workStates[w.status]} ·{" "}
                      {w.imported} participaciones nuevas guardadas
                      {w.reason &&
                        ` · ${w.reason === "aborted" ? "Ejecución detenida" : PENDING_LABELS[w.reason]}`}
                      {w.error && ` · Código ${w.error.code}, paso ${w.error.step}`}
                      {w.coveredThrough && (
                        <>
                          <br />
                          Cobertura confirmada: {date(w.coveredThrough)}
                        </>
                      )}
                      {w.history && (
                        <>
                          <br />
                          {w.history.mode === "season_backfill"
                            ? `${w.history.processed} IDs procesados de ${w.history.discovered} descubiertos · ${w.history.unavailable} no disponibles · `
                            : "Reparación incremental · "}
                          {w.history.cursorPending} IDs en cursor pendiente ·{" "}
                          {w.history.scanExhausted
                            ? "exploración agotada"
                            : "exploración pendiente"}
                          . No es el porcentaje definitivo de la temporada.
                        </>
                      )}
                    </p>
                  );
                })}
              </div>
            ))}
          </details>
        )}
        {dto.control.state !== "available" && (
          <p>
            {dto.control.state === "cooldown" ? "En cooldown" : "El lease compartido está ocupado"}{" "}
            hasta {date(dto.control.until)}
            {dto.control.reason === "riot_retry_after" ? " · Espera de Riot / Retry-After" : ""}.
          </p>
        )}
        {problem && <p className="notice">{problem}</p>}
        {refresh && <AdminProgressQuery refresh={refresh} result={manualRead} />}
      </div>
    </div>
  );
}
