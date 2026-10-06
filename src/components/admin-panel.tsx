"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, LogOut, Plus, RefreshCw, Trash2 } from "lucide-react";
import { PLATFORMS, PLATFORM_LABELS, type Platform } from "@/lib/routing";
import { CURRENT_SEASON, HISTORY_LABELS, type HistoryStatus } from "@/lib/season";
export type AdminPlayer = {
  id: string;
  gameName: string;
  tagLine: string;
  platform: Platform;
  enabled: boolean;
  lastSyncedAt: string | null;
  syncError: string | null;
  backfillSeason: string | null;
  backfillStatus: HistoryStatus["status"];
  backfillDiscovered: number;
  backfillProcessed: number;
  backfillUnavailable: number;
};
async function request(path: string, method: string, data?: unknown) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "No se pudo completar la solicitud.");
  return result as { message?: string; results?: { status: string }[] };
}
export function LoginForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = event.currentTarget;
    try {
      await request("/api/admin/login", "POST", { password: new FormData(form).get("password") });
      form.reset();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="login-card panel">
      <span className="login-icon">
        <LockKeyhole size={27} />
      </span>
      <div className="eyebrow">SOLOQ / CONTROL DE ACCESO</div>
      <h1>Detrás del ranking.</h1>
      <p>Inicia sesión para gestionar los jugadores y la sincronización de tu comunidad.</p>
      {demo && (
        <div className="notice">
          Modo demo: para administrar cuentas reales, configura PostgreSQL y las variables del
          servidor y establece DEMO_MODE=false.
        </div>
      )}
      <form onSubmit={submit}>
        <label htmlFor="password">Contraseña de administrador</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          disabled={demo || pending}
        />
        <button className="button primary full-width" disabled={demo || pending}>
          {pending ? "Verificando…" : "Entrar al panel"}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
      <span className="login-note">El ranking y los perfiles siempre son públicos.</span>
    </section>
  );
}
export function AdminPanel({ players }: { players: AdminPlayer[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState<AdminPlayer | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!deleting) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, [deleting]);
  async function act(path: string, method: string, data?: unknown, success = "Cambios guardados.") {
    setPending(true);
    setMessage("");
    setError(false);
    try {
      const result = await request(path, method, data);
      const summary = result.results
        ? `${result.results.filter((r) => r.status === "complete").length} completos, ${result.results.filter((r) => r.status === "partial").length} parciales, ${result.results.filter((r) => r.status === "error").length} con error.`
        : undefined;
      setMessage(result.message ?? summary ?? success);
      setDeleting(null);
      router.refresh();
      return true;
    } catch (error) {
      setError(true);
      setMessage(error instanceof Error ? error.message : "Error inesperado.");
      router.refresh();
      return false;
    } finally {
      setPending(false);
    }
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await act("/api/admin/players", "POST", Object.fromEntries(data))) form.reset();
  }
  return (
    <>
      <div className="admin-heading">
        <div>
          <div className="eyebrow">CENTRO DE CONTROL</div>
          <h1>Tu comunidad.</h1>
          <p className="muted">Gestiona el roster y mantén los datos al día.</p>
        </div>
        <button
          disabled={pending}
          className="button secondary"
          onClick={() => act("/api/admin/logout", "POST", undefined, "Sesión cerrada.")}
        >
          <LogOut size={16} /> Cerrar sesión
        </button>
      </div>
      <section className="panel add-player">
        <div className="panel-title">
          <h2>
            <Plus size={18} /> Añadir jugador
          </h2>
          <span>RIOT ID</span>
        </div>
        <form className="add-form" onSubmit={add}>
          <label>
            gameName
            <input
              name="gameName"
              placeholder="Nombre en Riot"
              required
              minLength={3}
              maxLength={16}
              disabled={pending}
            />
          </label>
          <label>
            tagLine
            <input
              name="tagLine"
              placeholder="LAS"
              required
              minLength={3}
              maxLength={5}
              disabled={pending}
            />
          </label>
          <label>
            Plataforma
            <select name="platform" defaultValue="LA2" disabled={pending}>
              {PLATFORMS.map((p) => (
                <option value={p} key={p}>
                  {PLATFORM_LABELS[p]} ({p})
                </option>
              ))}
            </select>
          </label>
          <button className="button primary" disabled={pending}>
            {pending ? "Procesando…" : "Añadir jugador"}
            <Plus size={16} />
          </button>
        </form>
        <p className="page-note">
          El alta guarda el perfil, el rango actual y comienza el historial de temporada. Los
          siguientes lotes continúan al sincronizar; cada lote conserva su progreso.
        </p>
      </section>
      {message && (
        <div
          role={error ? "alert" : "status"}
          className={error ? "notice form-error" : "notice success-notice"}
        >
          {message}
        </div>
      )}
      <section className="panel admin-roster">
        <div className="panel-title">
          <h2>
            Jugadores <span className="count-tag">{players.length}</span>
          </h2>
          <button
            className="button secondary"
            disabled={pending}
            onClick={() => act("/api/admin/sync", "POST")}
          >
            <RefreshCw size={15} />
            {pending ? "Procesando…" : "Sincronizar"}
          </button>
        </div>
        {players.length ? (
          players.map((p) => (
            <div className="admin-player" key={p.id}>
              <div>
                <strong>
                  {p.gameName}
                  <span className="muted">#{p.tagLine}</span>
                </strong>
                <p>
                  {PLATFORM_LABELS[p.platform]} ·{" "}
                  {p.lastSyncedAt
                    ? `Actualizado ${new Date(p.lastSyncedAt).toLocaleString("es-CL", { timeZone: "UTC" })} UTC`
                    : "Sincronización pendiente"}
                </p>
                <p className="history-status">
                  {CURRENT_SEASON.label}:{" "}
                  {
                    HISTORY_LABELS[
                      p.backfillSeason === CURRENT_SEASON.id ? p.backfillStatus : "not_started"
                    ]
                  }
                  <br />
                  {p.backfillSeason === CURRENT_SEASON.id &&
                    `${p.backfillProcessed} / ${p.backfillDiscovered} IDs procesados · ${p.backfillUnavailable} no disponibles`}
                </p>
                {p.syncError && <p className="sync-error">{p.syncError}</p>}
              </div>
              <div className="admin-actions">
                {(p.backfillStatus !== "completed" || p.backfillSeason !== CURRENT_SEASON.id) && (
                  <button
                    className="button secondary"
                    disabled={pending || !p.enabled}
                    onClick={() => act(`/api/admin/players/${p.id}/backfill`, "POST")}
                  >
                    {p.backfillStatus === "failed" ? "Reintentar historial" : "Continuar historial"}
                  </button>
                )}
                <button
                  className={`toggle-tracking ${p.enabled ? "enabled" : ""}`}
                  aria-pressed={p.enabled}
                  disabled={pending}
                  onClick={() =>
                    act(`/api/admin/players/${p.id}`, "PATCH", { enabled: !p.enabled })
                  }
                >
                  {p.enabled ? "Activo" : "Pausado"}
                </button>
                <button
                  className="icon-button danger"
                  aria-label={`Eliminar ${p.gameName}`}
                  disabled={pending}
                  onClick={() => setDeleting(p)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <p>Todavía no hay jugadores. Añade la primera cuenta arriba.</p>
          </div>
        )}
      </section>
      {deleting && (
        <dialog
          ref={dialogRef}
          className="panel confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-title"
          aria-describedby="delete-description"
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const buttons =
              event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          onCancel={(event) => {
            event.preventDefault();
            if (!pending) setDeleting(null);
          }}
        >
          <h2 id="delete-title">Eliminar {deleting.gameName}</h2>
          <p id="delete-description">
            Se eliminarán su perfil, sus snapshots y sus estadísticas. Las partidas compartidas con
            otros jugadores se conservarán. Esta acción no se puede deshacer.
          </p>
          <div>
            <button
              autoFocus
              className="button secondary"
              disabled={pending}
              onClick={() => setDeleting(null)}
            >
              Cancelar
            </button>
            <button
              className="button danger-button"
              disabled={pending}
              onClick={() =>
                act(
                  `/api/admin/players/${deleting.id}`,
                  "DELETE",
                  { confirm: true },
                  "Jugador eliminado.",
                )
              }
            >
              Eliminar jugador
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
