"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { matchPage, MATCH_SUMMARY_SIZE } from "@/lib/match-pagination";

/** Keep the existing server-rendered match rows; only their visible window changes. */
export function MatchHistory({ rows, demo = false }: { rows: ReactNode[]; demo?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const current = matchPage(rows, expanded, page);
  function navigate(next: number) {
    setPage(next);
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest" });
  }
  function toggle() {
    setExpanded(!expanded);
    navigate(0);
  }
  return (
    <section className="panel match-panel">
      <div className="panel-title">
        <h2 ref={heading} tabIndex={-1}>
          {expanded ? "Historial de partidas" : "Últimas partidas"}
        </h2>
        <span>{rows.length} RESULTADOS DISPONIBLES</span>
      </div>
      <p className="metric-note">
        Los remakes se conservan en el historial y se excluyen de las estadísticas
        {demo
          ? " de demostración. Los contadores ranked son ficticios."
          : " importadas. Los contadores ranked son los oficiales de Riot."}
      </p>
      {rows.length ? (
        <>
          <div id={id}>{current.items}</div>
          <div className="match-history-controls">
            <span role="status" aria-live="polite">
              {current.start + 1}–{current.end} de {rows.length}
              {expanded && ` · Página ${current.page + 1} de ${current.pages}`}
            </span>
            {expanded && (
              <nav aria-label="Páginas del historial">
                <button
                  type="button"
                  disabled={current.page === 0}
                  onClick={() => navigate(current.page - 1)}
                  aria-controls={id}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={current.page === current.pages - 1}
                  onClick={() => navigate(current.page + 1)}
                  aria-controls={id}
                >
                  Siguiente
                </button>
              </nav>
            )}
            {rows.length > MATCH_SUMMARY_SIZE && (
              <button type="button" onClick={toggle} aria-expanded={expanded} aria-controls={id}>
                {expanded ? "Volver al resumen" : "Ver más partidas"}
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="empty-copy">
          {demo
            ? "Este fixture no contiene partidas."
            : "Las nuevas partidas aparecerán después de sincronizar."}
        </p>
      )}
    </section>
  );
}
