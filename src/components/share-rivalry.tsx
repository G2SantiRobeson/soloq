"use client";
import { useState } from "react";
import { Link as LinkIcon } from "lucide-react";
import { sharedRivalryPath, type RivalPairIds } from "@/lib/shared-rivalry";
import type { LadderFilters } from "@/lib/ladder-filters";
import type { View } from "@/lib/queues";
export function ShareRivalry({
  ids,
  view,
  filters,
}: {
  ids: RivalPairIds;
  view: View;
  filters?: LadderFilters;
}) {
  const [feedback, setFeedback] = useState(""),
    [fallback, setFallback] = useState("");
  const path = sharedRivalryPath(view, ids, filters);
  async function copy() {
    if (!path) return;
    const value = new URL(path, window.location.origin).href;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setFallback("");
      setFeedback("Enlace copiado.");
    } catch {
      setFallback(value);
      setFeedback("No se pudo copiar automáticamente. Usa el enlace para copiarlo.");
    }
  }
  return (
    <div className="share-rivalry">
      <button type="button" className="share-rivalry-button" onClick={copy} disabled={!path}>
        <LinkIcon size={13} aria-hidden="true" />
        Compartir rivalidad
      </button>
      <span role="status" aria-live="polite">
        {feedback}
      </span>
      {fallback && (
        <input
          aria-label="Enlace de rivalidad para copiar"
          readOnly
          value={fallback}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </div>
  );
}
