import type { Metadata } from "next";
import { isDemo } from "@/server/env";
export const metadata: Metadata = { title: "Privacidad" };
export const dynamic = "force-dynamic";
export default function Privacy() {
  const demo = isDemo();
  return (
    <article className="legal-page">
      <div className="eyebrow">{demo ? "DEMOSTRACIÓN PÚBLICA" : "INFORMACIÓN DEL SERVICIO"}</div>
      <h1>Privacidad</h1>
      <p className="legal-lead">
        {demo
          ? "Esta instancia de SoloQ muestra únicamente jugadores, partidas, rangos y LP ficticios para demostrar la aplicación. No sincroniza cuentas reales ni utiliza PostgreSQL para servir la demo."
          : "SoloQ muestra estadísticas de League of Legends de una lista de jugadores administrada por el responsable de esta instancia."}
      </p>
      <h2>Datos que tratamos</h2>
      <p>
        {demo ? (
          "Los nombres y resultados son fixtures sintéticos, no datos obtenidos de cuentas de Riot. La administración y la sincronización están deshabilitadas. No solicitamos contraseñas de Riot ni acceso a cuentas."
        ) : (
          <>
            Guardamos Riot ID, PUUID, plataforma, icono de perfil, estado ranked, cambios de rango y
            estadísticas de partidas públicas estándar obtenidas de Riot Games. No solicitamos tu
            contraseña de Riot, correo electrónico ni acceso a tu cuenta.
          </>
        )}
      </p>
      <h2>Finalidad y visibilidad</h2>
      <p>
        {demo ? (
          "La clasificación, perfiles, gráficos y premios permiten explorar datos ficticios. No representan personas, resultados oficiales ni cambios de LP de cuentas reales."
        ) : (
          <>
            Los datos sirven para mostrar el leaderboard, perfiles e historial. Los perfiles
            habilitados son públicos. Los identificadores internos de Riot no se incluyen
            intencionalmente en la interfaz pública. No se importan partidas personalizadas.
          </>
        )}
      </p>
      <h2>Cookies y proveedores</h2>
      <p>
        {demo
          ? "La demo no inicia sesiones administrativas; las cookies administrativas residuales no habilitan operaciones."
          : "La administración usa una cookie de sesión HttpOnly, con duración máxima de ocho horas."}{" "}
        La aplicación guarda preferencias de navegación y filtros en el almacenamiento local del
        navegador. No integra publicidad ni analítica propia. El proveedor de alojamiento puede
        registrar solicitudes e información técnica. Algunos recursos estáticos públicos se
        consultan en Data Dragon o la CDN de Riot; una solicitud a esa CDN comunica la dirección IP
        del visitante.
      </p>
      <h2>Conservación y eliminación</h2>
      <p>
        {demo ? (
          "No se conserva historial de cuentas reales en esta demo. Los datos sintéticos se generan desde fixtures; no se copian jugadores o partidas de staging. El operador debe confirmar y publicar los plazos aplicables a registros técnicos y respaldos del alojamiento."
        ) : (
          <>
            El historial permanece mientras el jugador esté registrado. Pausar el seguimiento oculta
            el perfil y detiene la sincronización, pero conserva su historial. El administrador
            puede eliminar el jugador y sus estadísticas; las partidas compartidas se conservan si
            otro jugador registrado las utiliza. Las sesiones caducadas se depuran al iniciar una
            nueva sesión.
          </>
        )}
      </p>
      <h2>Desarrollador y contacto público</h2>
      <p>
        El desarrollador de SoloQ utiliza el nombre público <strong>Yuusha1</strong>. Para consultas
        sobre la aplicación o privacidad, puedes escribir a{" "}
        <a href="mailto:drg1212yt@gmail.com">drg1212yt@gmail.com</a>.
      </p>
      <p>
        Este nickname no sustituye la identidad legal del responsable cuando sea exigible. La
        identificación legal aplicable y la revisión de alojamiento, conservación y jurisdicción
        siguen pendientes. Esta página describe el funcionamiento técnico; no afirma que esa
        revisión esté completada.
      </p>
    </article>
  );
}
