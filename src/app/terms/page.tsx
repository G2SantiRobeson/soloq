import type { Metadata } from "next";
import { isDemo } from "@/server/env";
export const metadata: Metadata = { title: "Términos de uso" };
export const dynamic = "force-dynamic";
export default function Terms() {
  const demo = isDemo();
  return (
    <article className="legal-page">
      <div className="eyebrow">{demo ? "DEMOSTRACIÓN PÚBLICA" : "INFORMACIÓN DEL SERVICIO"}</div>
      <h1>Términos de uso</h1>
      <p className="legal-lead">
        SoloQ es un proyecto independiente para visualizar el progreso de una comunidad de League of
        Legends.
        {demo && " Esta instancia es una demostración pública con datos ficticios."}
      </p>
      <h2>Servicio y datos</h2>
      <p>
        {demo ? (
          "Los jugadores, partidas, rangos, LP y premios mostrados son simulados. No son observaciones oficiales de Riot ni resultados de personas reales. La demo no importa historiales, verifica cuentas ni permite administración o sincronización. No calcula MMR."
        ) : (
          <>
            Los datos pueden estar incompletos, retrasados o temporalmente no disponibles. El rango
            mostrado procede de Riot; SoloQ no calcula MMR ni ofrece un sistema alternativo de ELO.
            Las estadísticas de combate se limitan al historial importado.
          </>
        )}
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
        avalado ni patrocinado por Riot. Mostrar esta demo no implica aprobación de Riot, acceso
        autorizado a su API ni validación del producto por Riot.
      </p>
      <h2>Disponibilidad y cambios</h2>
      <p>
        {demo
          ? "Los fixtures y la presentación de la demo pueden cambiar o dejar de estar disponibles."
          : "El responsable de esta instancia puede modificar o interrumpir el servicio y corregir o eliminar datos."}{" "}
        Estos términos no limitan los derechos que te conceda la legislación aplicable.
      </p>
      <h2>Desarrollador y contacto público</h2>
      <p>
        El desarrollador de SoloQ utiliza el nombre público <strong>Yuusha1</strong>. Puedes
        contactar por correo en <a href="mailto:drg1212yt@gmail.com">drg1212yt@gmail.com</a>. Este
        nickname no sustituye la identidad legal del responsable cuando sea exigible.
      </p>
      <h2>Verificaciones pendientes</h2>
      <p>
        Siguen pendientes la identificación legal aplicable, la revisión de las condiciones del
        servicio, privacidad, alojamiento y conservación, y la confirmación del estado del registro
        y la revisión del producto en Riot Developer Portal. No se afirma que esos pasos estén
        completados.
      </p>
    </article>
  );
}
