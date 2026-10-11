import type { AutoBackfillState } from "@/lib/auto-backfill";
import type { ProgressDto } from "@/lib/sync-progress";

export function AdminBackfillProgress({
  dto,
  playerId,
  name,
  automatic,
  stop,
}: {
  dto: ProgressDto | null;
  playerId: string;
  name: string;
  automatic?: AutoBackfillState | null;
  stop?: () => void;
}) {
  const run = dto?.run;
  const work =
    run?.action === "player_history" && run.playerId === playerId
      ? run.players.find((p) => p.playerId === playerId)?.history
      : null;
  const h = work?.history;
  const valid =
    h?.mode === "season_backfill" &&
    h.processed != null &&
    h.discovered != null &&
    h.processed <= h.discovered;
  const determinate = valid && h.scanExhausted && h.discovered! > 0;
  const percent = determinate ? (100 * h.processed!) / h.discovered! : null;
  const waiting =
    (dto?.control.state === "cooldown" && dto.control.reason === "riot_retry_after") ||
    !!(run?.riotRetryAt && dto && Date.parse(run.riotRetryAt) > Date.parse(dto.serverNow));
  return (
    <section className="admin-backfill-progress panel" aria-label={`Progreso histórico de ${name}`}>
      <h2>Historial · {name}</h2>
      <p role="status">
        {waiting && automatic?.active
          ? "Esperando por Riot; el avance permanece confirmado"
          : (automatic?.message ??
            (waiting
              ? "Esperando por Riot"
              : work?.status === "complete"
                ? "Historial disponible importado"
                : run?.state === "running"
                  ? "Procesando; esperando el siguiente checkpoint"
                  : "Último progreso confirmado"))}
      </p>
      {automatic?.active && run && automatic.requestId !== run.requestId && (
        <p className="muted">
          Mostrando el último checkpoint del lote anterior; la nueva ejecución aún no confirmó
          progreso.
        </p>
      )}
      <progress
        aria-label="IDs descubiertos procesados"
        {...(determinate ? { value: h.processed!, max: h.discovered! } : {})}
      />
      <p>
        {valid
          ? `${h.processed} / ${h.discovered} IDs procesados`
          : `IDs procesados: ${h?.processed ?? "desconocidos"} · IDs descubiertos: ${h?.discovered ?? "desconocidos"}; sin denominador verificable`}
        {percent !== null &&
          ` · ${percent.toLocaleString("es-CL", { maximumFractionDigits: 1 })} % de los IDs descubiertos`}
      </p>
      {valid && (
        <p>
          Posición confirmada: {h.processed} de {h.discovered} · {h.discovered! - h.processed!}{" "}
          pendientes descubiertos · {h.unavailable ?? "—"} no disponibles (404).
        </p>
      )}
      {work && (
        <p>
          {work.imported} participaciones nuevas guardadas en esta ejecución. Los IDs procesados
          también incluyen registros previos y partidas excluidas.
        </p>
      )}
      <p>Match ID en curso: desconocido. Esperando resultado del siguiente checkpoint.</p>
      <p>
        Último ID confirmado:{" "}
        <span className="backfill-match-id">
          {work?.lastConfirmedMatchId ?? "Sin ID registrado en esta ejecución"}
        </span>
      </p>
      <p>Último checkpoint: {run?.lastCheckpointAt ?? "Sin checkpoint registrado"}</p>
      {run && (
        <p>
          Última ejecución: <span className="backfill-match-id">{run.runId}</span>
        </p>
      )}
      {(automatic?.retryAt || waiting) && (
        <p>
          Espera compartida hasta {automatic?.retryAt ?? run?.riotRetryAt ?? dto?.control.until}{" "}
          (hora del servidor).
        </p>
      )}
      <p className="muted">
        Actualización por checkpoint (aproximadamente 15 s) y final de lote. El denominador puede
        crecer y el porcentaje disminuir. No representa el total de Riot ni cobertura exhaustiva de
        la temporada.
        {!determinate &&
          " Progreso indeterminado mientras se descubre el historial o falta un denominador verificable."}
      </p>
      {automatic?.active && stop && (
        <button type="button" className="button secondary" onClick={stop}>
          Detener continuación automática
        </button>
      )}
      {automatic && !automatic.active && (
        <p>
          Continuación automática detenida. Puedes volver a activarla desde el jugador; el progreso
          persistido se conserva.
        </p>
      )}
      {automatic?.active && (
        <p className="muted">
          Solo este jugador · {automatic.batches}/100 lotes · máximo una hora. La pestaña oculta
          pausa nuevas continuaciones; cerrar o recargar no reanuda automáticamente el modo.
        </p>
      )}
    </section>
  );
}
