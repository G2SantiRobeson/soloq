"use client";
import { TriangleAlert } from "lucide-react";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state error-state">
      <TriangleAlert size={34} />
      <h1>La Grieta tendrá que esperar.</h1>
      <p>
        No pudimos cargar las estadísticas en este momento. Vuelve a intentarlo en unos minutos.
      </p>
      <button className="button primary" onClick={reset}>
        Volver a intentar
      </button>
    </div>
  );
}
