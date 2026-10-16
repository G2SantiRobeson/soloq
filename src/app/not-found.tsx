import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty-state error-state">
      <h1>No encontramos esta página.</h1>
      <p className="page-meta">Error 404 · fuera del mapa</p>
      <p>El jugador puede no existir o su seguimiento está desactivado.</p>
      <Link href="/" className="button primary">
        Volver a la clasificación
      </Link>
    </div>
  );
}
