import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = {
  title: "Página no encontrada",
  description:
    "Este enlace no lleva a una página disponible en SoloQ. Vuelve a la clasificación o explora las rivalidades de la comunidad.",
};

export default function NotFound() {
  return (
    <>
      <PageHeading
        title="Página no encontrada"
        lead="Este enlace no lleva a una página disponible. Puedes volver a la clasificación o explorar las rivalidades de la comunidad."
        meta="Error 404 · fuera del mapa"
      />
      <nav className="not-found-actions" aria-label="Volver a SoloQ">
        <Link href="/" className="button primary">
          Volver a la clasificación
        </Link>
        <Link href="/rivalidades" className="button secondary">
          Ver rivalidades
        </Link>
      </nav>
    </>
  );
}
