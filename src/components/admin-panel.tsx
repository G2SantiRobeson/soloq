"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, LogOut, Plus, RefreshCw, Trash2 } from "lucide-react";
import { PLATFORMS, PLATFORM_LABELS } from "@/lib/routing";
import { CURRENT_SEASON } from "@/lib/season";
import type { AdminPlayer, AdminSyncContext, IndividualSyncResult } from "@/lib/admin-sync";
import { AdminPlayerDiagnostics } from "./admin-player-diagnostics";
export type { AdminPlayer } from "@/lib/admin-sync";
import {
  AdminRequestError,
  describeAdminError,
  splitRiotId,
  type AdminAction,
  type AdminError,
} from "@/lib/admin-errors";
type Result = { message?: string; results?: { status: string }[]; result?: IndividualSyncResult };
async function request(path: string, method: string, data?: unknown): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new AdminRequestError(0, null);
  }
  // A proxy or crash page may not be JSON; never show the parser's message.
  const result = (await response.json().catch(() => null)) as (Result & { error?: string }) | null;
  if (!response.ok) throw new AdminRequestError(response.status, result?.error ?? null);
  return result ?? {};
}
export function LoginForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const ids = useId();
  const [error, setError] = useState<AdminError | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const form = event.currentTarget;
    try {
      await request("/api/admin/login", "POST", { password: new FormData(form).get("password") });
      form.reset();
      router.refresh();
    } catch (caught) {
      setError(describeAdminError(caught, "login"));
    } finally {
      setPending(false);
    }
  }
  const errorId = `${ids}-error`;
  return (
    <section className="login-card panel">
      <span className="login-icon">
        <LockKeyhole size={27} aria-hidden="true" />
      </span>
      <div className="eyebrow">SOLOQ / ACCESO DE ADMINISTRACIÓN</div>
      <h1>Detrás del ranking.</h1>
      <p>Inicia sesión para gestionar los jugadores y las actualizaciones de tu comunidad.</p>
      {demo && (
        <div className="notice">
          Estás en el modo demo: el acceso de administración está desactivado. Para gestionar
          cuentas reales, el responsable del servidor debe configurar la base de datos y desactivar
          el modo demo.
        </div>
      )}
      <form onSubmit={submit}>
        <label htmlFor={`${ids}-password`}>Contraseña de administrador</label>
        <input
          id={`${ids}-password`}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          disabled={demo}
          readOnly={pending}
          aria-invalid={error?.field === "password" || undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <button
          className="button primary full-width"
          disabled={demo}
          aria-disabled={pending || undefined}
        >
          {pending ? "Verificando…" : "Entrar al panel"}
        </button>
        <p id={errorId} className="form-error" role="alert">
          {error?.message}
        </p>
      </form>
      <span className="login-note">La clasificación y los perfiles siempre son públicos.</span>
    </section>
  );
}
export function AdminPanel({
  players,
  context,
}: {
  players: AdminPlayer[];
  context: AdminSyncContext;
}) {
  const router = useRouter();
  const ids = useId();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
    partial?: boolean;
  } | null>(null);
  const [addError, setAddError] = useState<AdminError | null>(null);
  const [gameName, setGameName] = useState("");
  const [tagLine, setTagLine] = useState("");
  const [deleting, setDeleting] = useState<AdminPlayer | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const rosterHeading = useRef<HTMLHeadingElement>(null);
  const gameNameInput = useRef<HTMLInputElement>(null);
  const deleted = useRef(false);
  const actionInFlight = useRef(false);
  const pending = pendingAction !== null;
  const fullRiotId = splitRiotId(gameName);
  useEffect(() => {
    if (!deleting) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const heading = rosterHeading.current;
    deleted.current = false;
    dialog?.showModal();
    return () => {
      dialog?.close();
      // The trigger disappears with the deleted player, so focus the roster heading instead.
      (deleted.current ? heading : previous)?.focus();
    };
  }, [deleting]);
  async function act(
    key: string,
    action: AdminAction,
    path: string,
    method: string,
    data?: unknown,
    success = "Cambios guardados.",
  ) {
    // Controls stay focusable while busy (aria-disabled); this guard prevents double actions.
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    setPendingAction(key);
    setNotice(null);
    try {
      const result = await request(path, method, data);
      const summary = result.results
        ? `${result.results.filter((r) => r.status === "complete").length} completos, ${result.results.filter((r) => r.status === "partial").length} parciales, ${result.results.filter((r) => r.status === "error").length} con error.`
        : undefined;
      setNotice({
        message: result.message ?? summary ?? success,
        error: false,
        partial: result.result?.status === "partial",
      });
      if (action === "delete") deleted.current = true;
      setDeleting(null);
      router.refresh();
      return true;
    } catch (caught) {
      const described = describeAdminError(caught, action);
      if (action === "add" && described.field) setAddError(described);
      else setNotice({ message: described.message, error: true });
      // A modal dialog hides the page notice, so close it and show the error there.
      if (action === "delete") setDeleting(null);
      router.refresh();
      return false;
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
    }
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setAddError(null);
    if (fullRiotId) {
      setAddError({
        message: "El nombre no puede incluir «#». Escribe el tag en su propio campo.",
        field: "riotId",
      });
      gameNameInput.current?.focus();
      return;
    }
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (await act("add", "add", "/api/admin/players", "POST", data)) {
      form.reset();
      setGameName("");
      setTagLine("");
    }
  }
  function applySplit() {
    if (!fullRiotId) return;
    setGameName(fullRiotId.gameName);
    setTagLine(fullRiotId.tagLine);
    setAddError(null);
    gameNameInput.current?.focus();
  }
  const riotIdInvalid = addError?.field === "riotId";
  const describedBy = [
    fullRiotId ? `${ids}-split` : null,
    addError ? `${ids}-add-error` : null,
    `${ids}-riot-id-help`,
  ]
    .filter(Boolean)
    .join(" ");
  const busyLabel = (key: string, idle: string) => (pendingAction === key ? "Procesando…" : idle);
  return (
    <>
      <div className="admin-heading">
        <div>
          <div className="eyebrow">CENTRO DE CONTROL</div>
          <h1>Tu comunidad.</h1>
          <p className="muted">Gestiona los jugadores y mantén los datos al día.</p>
        </div>
        <button
          type="button"
          aria-disabled={pending || undefined}
          className="button secondary"
          onClick={() =>
            act("logout", "logout", "/api/admin/logout", "POST", undefined, "Sesión cerrada.")
          }
        >
          <LogOut size={16} aria-hidden="true" /> {busyLabel("logout", "Cerrar sesión")}
        </button>
      </div>
      <section className="panel add-player" aria-labelledby={`${ids}-add-title`}>
        <div className="panel-title">
          <h2 id={`${ids}-add-title`}>
            <Plus size={18} aria-hidden="true" /> Añadir jugador
          </h2>
          <span>RIOT ID</span>
        </div>
        <form className="add-form" onSubmit={add}>
          <label>
            Nombre del Riot ID
            <input
              ref={gameNameInput}
              name="gameName"
              placeholder="Nombre"
              required
              minLength={3}
              maxLength={22}
              autoComplete="off"
              value={gameName}
              onChange={(event) => setGameName(event.target.value)}
              readOnly={pending}
              aria-invalid={riotIdInvalid || Boolean(fullRiotId) || undefined}
              aria-describedby={describedBy}
            />
          </label>
          <label>
            Tag (sin #)
            <input
              name="tagLine"
              placeholder="LAS"
              required
              minLength={3}
              maxLength={5}
              autoComplete="off"
              value={tagLine}
              onChange={(event) => setTagLine(event.target.value)}
              readOnly={pending}
              aria-invalid={riotIdInvalid || undefined}
              aria-describedby={describedBy}
            />
          </label>
          <label>
            Región
            <select name="platform" defaultValue="LA2">
              {PLATFORMS.map((p) => (
                <option value={p} key={p}>
                  {PLATFORM_LABELS[p]} ({p})
                </option>
              ))}
            </select>
          </label>
          <button className="button primary" aria-disabled={pending || undefined}>
            {busyLabel("add", "Añadir jugador")}
            <Plus size={16} aria-hidden="true" />
          </button>
        </form>
        {fullRiotId && (
          <div id={`${ids}-split`} className="field-hint" role="status">
            <p>
              Parece que escribiste el Riot ID completo. El nombre es «{fullRiotId.gameName}» y el
              tag «{fullRiotId.tagLine}».
            </p>
            <button type="button" className="button secondary" onClick={applySplit}>
              Separar nombre y tag
            </button>
          </div>
        )}
        <p id={`${ids}-add-error`} className="form-error field-error" role="alert">
          {addError?.message}
        </p>
        <p id={`${ids}-riot-id-help`} className="page-note">
          El Riot ID es «Nombre#TAG»: el nombre tiene de 3 a 16 caracteres y el tag, de 3 a 5. Al
          añadirlo se guardan su perfil y su rango actual, y empieza a importarse su historial de la
          temporada; las siguientes actualizaciones continúan desde donde quedó.
        </p>
      </section>
      <div role="status" className="notice-slot">
        {pending && (
          <div className="notice">
            Procesando… Las consultas pueden tardar debido a los límites de Riot. Espera antes de
            iniciar otra acción.
          </div>
        )}
        {notice && !notice.error && (
          <div className={`notice ${notice.partial ? "partial-notice" : "success-notice"}`}>
            {notice.message}
          </div>
        )}
      </div>
      <div role="alert" className="notice-slot">
        {notice?.error && <div className="notice form-error">{notice.message}</div>}
      </div>
      <section className="panel admin-roster" aria-labelledby={`${ids}-roster-title`}>
        <div className="panel-title">
          <h2 id={`${ids}-roster-title`} ref={rosterHeading} tabIndex={-1}>
            Jugadores <span className="count-tag">{players.length}</span>
          </h2>
          <button
            type="button"
            className="button secondary"
            aria-disabled={pending || undefined}
            onClick={() => act("sync", "sync", "/api/admin/sync", "POST")}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {busyLabel("sync", "Actualizar todos")}
          </button>
        </div>
        {players.length ? (
          players.map((p) => {
            const nameId = `${ids}-${p.id}-name`;
            return (
              <div className="admin-player" key={p.id}>
                <div>
                  <strong id={nameId}>
                    {p.gameName}
                    <span className="muted">#{p.tagLine}</span>
                  </strong>
                  <p>
                    {PLATFORM_LABELS[p.platform]} ({p.platform}) ·{" "}
                    {p.enabled ? "Seguimiento activo" : "Seguimiento pausado"}
                  </p>
                  <AdminPlayerDiagnostics player={p} context={context} />
                </div>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!p.enabled}
                    aria-disabled={pending || undefined}
                    aria-describedby={nameId}
                    onClick={() =>
                      act(`player-sync:${p.id}`, "sync", `/api/admin/players/${p.id}/sync`, "POST")
                    }
                  >
                    <RefreshCw size={15} aria-hidden="true" />
                    {busyLabel(`player-sync:${p.id}`, "Actualizar jugador")}
                  </button>
                  {(p.backfillStatus !== "completed" || p.backfillSeason !== CURRENT_SEASON.id) && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={!p.enabled}
                      aria-disabled={pending || undefined}
                      aria-describedby={nameId}
                      onClick={() =>
                        act(
                          `backfill:${p.id}`,
                          "backfill",
                          `/api/admin/players/${p.id}/backfill`,
                          "POST",
                        )
                      }
                    >
                      {busyLabel(
                        `backfill:${p.id}`,
                        p.backfillStatus === "failed"
                          ? "Reintentar historial"
                          : "Continuar historial",
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={p.enabled}
                    aria-label={`Seguimiento de ${p.gameName}`}
                    className={`tracking-switch ${p.enabled ? "on" : ""}`}
                    aria-disabled={pending || undefined}
                    onClick={() =>
                      act(`toggle:${p.id}`, "toggle", `/api/admin/players/${p.id}`, "PATCH", {
                        enabled: !p.enabled,
                      })
                    }
                  >
                    <span className="tracking-track" aria-hidden="true">
                      <span className="tracking-thumb" />
                    </span>
                    <span aria-hidden="true">
                      {pendingAction === `toggle:${p.id}`
                        ? "Guardando…"
                        : p.enabled
                          ? "Seguimiento activo"
                          : "Seguimiento pausado"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label={`Eliminar a ${p.gameName}`}
                    aria-disabled={pending || undefined}
                    onClick={() => {
                      if (!pending) setDeleting(p);
                    }}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })
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
          <h2 id="delete-title">¿Eliminar a {deleting.gameName}?</h2>
          <p id="delete-description">
            Se eliminarán su perfil, su historial de rango y sus estadísticas. Las partidas que
            comparte con otros jugadores se conservan. Esta acción no se puede deshacer.
          </p>
          <div>
            <button
              type="button"
              autoFocus
              className="button secondary"
              aria-disabled={pending || undefined}
              onClick={() => {
                if (!pending) setDeleting(null);
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="button danger-button"
              aria-disabled={pending || undefined}
              onClick={() =>
                act(
                  `delete:${deleting.id}`,
                  "delete",
                  `/api/admin/players/${deleting.id}`,
                  "DELETE",
                  { confirm: true },
                  "Jugador eliminado.",
                )
              }
            >
              {busyLabel(`delete:${deleting.id}`, "Eliminar jugador")}
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
