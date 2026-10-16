import { PageHeading } from "@/components/page-heading";
export default function VersusLoading() {
  return (
    <div role="status">
      <PageHeading title="Cara a cara" lead="Leyendo los registros de ambos jugadores…" />
      <p className="data-note">Cargando la comparación VS.</p>
    </div>
  );
}
