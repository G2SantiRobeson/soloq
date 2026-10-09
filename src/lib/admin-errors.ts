export type AdminAction = "login" | "add" | "sync" | "backfill" | "toggle" | "delete" | "logout";
export type AdminErrorField = "riotId" | "password";
export type AdminError = { message: string; field?: AdminErrorField };

/** Status 0 means no usable response: whether the server executed the request is unknown. */
export class AdminRequestError extends Error {
  constructor(
    public status: number,
    public serverMessage: string | null,
    public runId?: string,
  ) {
    super(serverMessage ?? `HTTP ${status}`);
  }
}

/** Turns a failed admin request into a plain-language message, tied to a field when possible. */
export function describeAdminError(error: unknown, action: AdminAction): AdminError {
  if (!(error instanceof AdminRequestError))
    return { message: "Algo salió mal. Recarga la página e inténtalo de nuevo." };
  const { status, serverMessage } = error;
  if (status === 0)
    return {
      message:
        "No hay conexión confirmada con el servidor. La acción pudo llegar a ejecutarse: recarga el panel y revisa los diagnósticos antes de reintentar.",
    };
  if (action === "login") {
    if (status === 401)
      return {
        message: "La contraseña no es correcta. Revísala e inténtalo de nuevo.",
        field: "password",
      };
    if (status === 429)
      return {
        message: "Demasiados intentos. Espera 15 minutos antes de volver a probar.",
        field: "password",
      };
    if (status === 503) return { message: "El acceso está desactivado en el modo demo." };
  }
  if (status === 401)
    return { message: "Tu sesión expiró. Recarga la página e inicia sesión de nuevo." };
  if (status === 403)
    return {
      message:
        "No pudimos verificar el origen de la solicitud. Recarga la página e inténtalo de nuevo.",
    };
  if (action === "add") {
    if (status === 400)
      return {
        message:
          "Revisa el Riot ID: el nombre tiene de 3 a 16 caracteres y el tag de 3 a 5 letras o números, sin «#».",
        field: "riotId",
      };
    if (status === 404)
      return {
        message:
          "No encontramos ese Riot ID en la región elegida. Revisa el nombre, el tag y la región.",
        field: "riotId",
      };
    if (status === 409 && serverMessage?.includes("registrada"))
      return { message: "Esa cuenta ya está en la clasificación.", field: "riotId" };
  }
  if (status === 409 || status === 429)
    return {
      message: serverMessage ?? "Hay otra actualización en curso. Inténtalo en unos minutos.",
    };
  if (action === "sync" && status === 404)
    return { message: serverMessage ?? "Jugador o cuenta no encontrado. Recarga el panel." };
  // Curated sync/Riot messages (rate limit, partial import, invalid key) are worth keeping.
  if (status === 503 && serverMessage) return { message: serverMessage };
  if (status >= 500)
    return {
      message: "Riot o el servidor no respondieron a tiempo. Inténtalo de nuevo en unos minutos.",
    };
  return { message: "No se pudo completar la acción. Inténtalo de nuevo." };
}

/** Splits "Name#TAG" typed into the name field. Returns null when there is nothing to split. */
export function splitRiotId(value: string): { gameName: string; tagLine: string } | null {
  const index = value.indexOf("#");
  if (index < 0) return null;
  return {
    gameName: value.slice(0, index).trim(),
    tagLine: value
      .slice(index + 1)
      .replace(/#/g, "")
      .trim(),
  };
}
