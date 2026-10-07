"use client";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state error-state" role="alert">
      <TriangleAlert size={34} aria-hidden="true" />
      <span className="eyebrow">ERROR AL CARGAR</span>
      <h1>La Grieta tendrá que esperar.</h1>
      <p>
        No pudimos cargar las estadísticas en este momento. Puede ser un corte breve del servidor o
        de Riot: vuelve a intentarlo, o regresa a la clasificación y prueba en unos minutos.
      </p>
      <div className="error-actions">
        <button type="button" className="button primary" onClick={reset}>
          Volver a intentar
        </button>
        <Link href="/" className="button secondary">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
