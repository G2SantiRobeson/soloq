import type { Metadata } from "next";
export const metadata: Metadata = { title: "Términos de uso" };
export default function Terms() {
  return (
    <article className="legal-page">
      <div className="eyebrow">DOCUMENTO INICIAL · PROTOTIPO</div>
      <h1>Términos de uso</h1>
      <p className="legal-lead">
        SoloQ es un proyecto independiente para consultar el progreso de una comunidad de League of
        Legends.
      </p>
      <h2>Servicio y datos</h2>
      <p>
        El sitio se ofrece como prototipo. Los datos pueden estar incompletos, retrasados o
        temporalmente no disponibles. El rango mostrado procede de Riot; SoloQ no calcula MMR ni
        ofrece un sistema alternativo de ELO. Las estadísticas de combate se limitan al historial
        importado.
      </p>
      <h2>Uso permitido</h2>
      <p>
        Usa la aplicación de forma respetuosa y conforme a las políticas de Riot Games. No intentes
        obtener acceso administrativo sin autorización, extraer secretos, interferir con el servicio
        o usar la información para acosar a otros jugadores.
      </p>
      <h2>Propiedad intelectual</h2>
      <p>
        League of Legends, sus personajes e imágenes son propiedad de Riot Games. SoloQ no está
        avalado ni patrocinado por Riot. Los recursos del juego se usan conforme a las políticas
        para desarrolladores.
      </p>
      <h2>Disponibilidad y cambios</h2>
      <p>
        El responsable de esta instancia puede modificar o interrumpir el prototipo y corregir o
        eliminar datos. Estos términos no limitan los derechos que te conceda la legislación
        aplicable.
      </p>
      <h2>Antes del lanzamiento</h2>
      <p>
        El operador debe completar su identidad, contacto y condiciones específicas, revisar la
        política de privacidad y registrar el producto en el Riot Developer Portal. Este documento
        inicial debe revisarse antes de ofrecer un servicio de producción.
      </p>
    </article>
  );
}
