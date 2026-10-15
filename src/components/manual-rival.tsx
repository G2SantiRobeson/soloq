"use client";
import { useCallback, useState, useSyncExternalStore } from "react";
import { profileIconAsset } from "@/lib/profile-icon";
import Link from "next/link";
import { Crosshair } from "lucide-react";
import { Avatar } from "./avatar";
import { RankDisplay } from "./rank-display";
import { hasRivalRank } from "@/lib/rivalries";
import { rivalComparisonLabel } from "@/lib/rival-comparison-label";
import {
  rivalPreferenceKey,
  readLocalRival,
  writeLocalRival,
  RIVAL_PREFERENCE_EVENT,
  type Preference,
} from "@/lib/local-rival-preference";
import { validManualChoice } from "@/lib/manual-rival";
import type { ManualRivalContext } from "@/lib/manual-rival";
import type { RivalIdentity } from "@/lib/nearest-rival";
import type { View } from "@/lib/queues";
import { sharedRivalryPath } from "@/lib/shared-rivalry";
const serverSnapshot = () => JSON.stringify({ id: null, status: "empty" });
export function ManualRival({
  player,
  view,
  initial,
  version,
}: {
  player: RivalIdentity;
  view: View;
  initial: ManualRivalContext;
  version?: string | null;
}) {
  const key = rivalPreferenceKey(player, view);
  const [volatile, setVolatile] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState("");
  const subscribe = useCallback(
    (listener: () => void) => {
      const storage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) listener();
      };
      const local = (event: Event) => {
        if ((event as CustomEvent<{ key: string | null }>).detail?.key === key) listener();
      };
      window.addEventListener("storage", storage);
      window.addEventListener(RIVAL_PREFERENCE_EVENT, local);
      return () => {
        window.removeEventListener("storage", storage);
        window.removeEventListener(RIVAL_PREFERENCE_EVENT, local);
      };
    },
    [key],
  );
  const snapshot = useCallback(() => {
    try {
      return JSON.stringify(readLocalRival(window.localStorage, key, player, initial.candidates));
    } catch {
      return JSON.stringify({ id: null, status: "unavailable" });
    }
  }, [key, player, initial.candidates]);
  const stored: Preference = JSON.parse(useSyncExternalStore(subscribe, snapshot, serverSnapshot));
  const selectedId = volatile === undefined ? stored.id : volatile;
  const selected = initial.candidates.find((p) => p.id === selectedId);
  const choice = draft ?? selected?.id ?? "";
  const label = selected ? rivalComparisonLabel(player, selected) : null;
  function save(id: string | null) {
    if (
      id !== null &&
      !validManualChoice(
        player,
        initial.candidates.find((p) => p.id === id),
      )
    ) {
      setMessage("Elige un rival válido de esta región.");
      return;
    }
    let persistent = false;
    try {
      persistent = writeLocalRival(window.localStorage, key, player, initial.candidates, id);
    } catch {
      persistent = false;
    }
    setVolatile(persistent ? undefined : id);
    setDraft(undefined);
    if (persistent)
      window.dispatchEvent(new CustomEvent(RIVAL_PREFERENCE_EVENT, { detail: { key } }));
    setMessage(
      persistent
        ? id
          ? "Guardado en este navegador."
          : "Selección local eliminada."
        : "Almacenamiento inaccesible: la selección solo durará mientras este perfil permanezca abierto.",
    );
  }
  if (view === "5v5") return null;
  return (
    <section className="profile-rival manual-rival" aria-label="Tu rival elegido en este navegador">
      <h2>
        <Crosshair size={16} aria-hidden="true" />
        Tu rival elegido en este navegador
      </h2>
      {selected && (
        <div className="manual-rival-selected">
          <Link
            className="profile-rival-identity"
            href={"/player/" + selected.id + "?queue=" + view}
          >
            <Avatar
              name={selected.gameName}
              decorative
              size={36}
              src={profileIconAsset(version, selected.profileIconId)}
            />
            <span>
              <strong>{selected.gameName}</strong>
              <span className="tagline">#{selected.tagLine}</span>
            </span>
            <RankDisplay rank={hasRivalRank(selected) ? selected.rank : null} size={24} />
            <strong className="numeric">
              {hasRivalRank(selected) && Number.isSafeInteger(selected.rank.leaguePoints)
                ? selected.rank.leaguePoints + " LP"
                : "Sin datos de rango"}
            </strong>
          </Link>
          <span>{label?.text}</span>
          {label?.crossApex && (
            <small className="comparison-note">
              LP comparados directamente; las categorías oficiales se conservan. No indica LP
              necesarios para ascender.
            </small>
          )}
          <Link
            href={
              (sharedRivalryPath(view, [player.id, selected.id]) ?? "/rivalidades") +
              "&tipo=elegida"
            }
          >
            Ver comparación
          </Link>
        </div>
      )}
      {initial.available ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(choice || null);
          }}
        >
          <label htmlFor={"manual-rival-" + player.id}>
            Elige a quién comparar con {player.gameName}
          </label>
          <div className="manual-rival-controls">
            <select
              id={"manual-rival-" + player.id}
              value={choice}
              onChange={(e) => setDraft(e.target.value)}
            >
              <option value="">Sin rival elegido</option>
              {initial.candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.gameName}#{p.tagLine}
                </option>
              ))}
            </select>
            <button
              className="button secondary"
              type="submit"
              disabled={choice === (selected?.id ?? "")}
            >
              Guardar
            </button>
            {(selected || stored.status === "obsolete") && (
              <button type="button" className="manual-rival-remove" onClick={() => save(null)}>
                Quitar
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="profile-rival-empty">
          No hay una lista completa de jugadores para elegir un rival en esta modalidad y región.
        </p>
      )}
      <p className="profile-rival-empty">
        Esta selección es local, no representa una preferencia pública del jugador. El rival
        automático se conserva.
      </p>
      {stored.status === "obsolete" && (
        <p className="profile-rival-empty">
          La elección guardada ya no es válida o su jugador no está disponible.
        </p>
      )}
      {stored.status === "unavailable" && (
        <p className="profile-rival-empty">
          El almacenamiento está bloqueado; puedes comparar durante esta visita.
        </p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
