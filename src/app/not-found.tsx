import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty-state error-state">
      <span className="eyebrow">404 / FUERA DEL MAPA</span>
      <h1>No encontramos esta página.</h1>
      <p>El jugador puede no existir o su seguimiento está desactivado.</p>
      <Link href="/" className="button primary">
        Volver a la clasificación
      </Link>
    </div>
  );
}
