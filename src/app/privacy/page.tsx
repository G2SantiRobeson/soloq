import type { Metadata } from "next";
export const metadata: Metadata = { title: "Privacidad" };
export default function Privacy() {
  return (
    <article className="legal-page">
      <div className="eyebrow">DOCUMENTO INICIAL · PROTOTIPO</div>
      <h1>Privacidad</h1>
      <p className="legal-lead">
        SoloQ muestra estadísticas de League of Legends de una lista de jugadores administrada por
        el responsable de esta instancia.
      </p>
      <h2>Datos que tratamos</h2>
      <p>
        Guardamos Riot ID, PUUID, plataforma, icono de perfil, estado ranked, cambios de rango y
        estadísticas de partidas públicas estándar obtenidas de Riot Games. No solicitamos tu
        contraseña de Riot, correo electrónico ni acceso a tu cuenta.
      </p>
      <h2>Finalidad y visibilidad</h2>
      <p>
        Los datos sirven para mostrar el leaderboard, perfiles e historial. Los perfiles habilitados
        son públicos. Los identificadores internos de Riot no se incluyen intencionalmente en la
        interfaz pública. No se importan partidas personalizadas.
      </p>
      <h2>Cookies y proveedores</h2>
      <p>
        La administración usa una cookie de sesión HttpOnly, con duración máxima de ocho horas. No
        instalamos cookies de publicidad ni analítica. El proveedor de alojamiento puede registrar
        solicitudes e información técnica para operar el servicio. Las imágenes se solicitan a la
        CDN de Riot, que recibe la dirección IP del visitante.
      </p>
      <h2>Conservación y eliminación</h2>
      <p>
        El historial permanece mientras el jugador esté registrado. Pausar el seguimiento oculta el
        perfil y detiene la sincronización, pero conserva su historial. El administrador puede
        eliminar el jugador y sus estadísticas; las partidas compartidas se conservan si otro
        jugador registrado las utiliza. Las sesiones caducadas se depuran al iniciar una nueva
        sesión.
      </p>
      <h2>Solicitudes y responsable</h2>
      <p>
        Para consultar, corregir o eliminar tus datos, contacta al administrador de la comunidad que
        opera esta instancia. Antes del lanzamiento público, su responsable debe publicar aquí su
        identidad, un medio de contacto y los plazos de conservación y respaldo aplicables. Este
        texto es una base de prototipo y requiere adaptación al despliegue y la jurisdicción.
      </p>
    </article>
  );
}
