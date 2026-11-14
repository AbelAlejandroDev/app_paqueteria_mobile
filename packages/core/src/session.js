/**
 * Que dice un error de la API sobre la sesion.
 *
 * Borrar los tokens es irreversible para el cliente: le obliga a volver a
 * escribir la contraseña. Por eso solo se hace con una prueba inequivoca del
 * servidor de que las credenciales ya no valen. Todo lo demas (sin red, un
 * timeout, un 429, un 5xx, una pagina de mantenimiento del proxy) es pasajero:
 * la sesion se conserva y la peticion se puede repetir mas tarde.
 *
 * Contratos del backend (src/controllers/auth/*, src/middlewares/auth.js):
 *   - POST /auth/refresh: 401 Invalid refresh token, User inactive,
 *     PORTAL_TENANT_MISMATCH, SESSION_REVOKED; 400 Invalid body.
 *   - GET /auth/me: 401 (token invalido o revocado), 404 User not found.
 *   - Cualquier ruta: 403 Forbidden es un permiso de ESE recurso, no la sesion.
 */

export const SESSION_INVALID = "invalid";
export const SESSION_TEMPORARY = "temporary";
export const SESSION_FORBIDDEN = "forbidden";

function statusOf(error) {
  return error?.response?.status ?? null;
}

function bodyError(error) {
  const data = error?.response?.data;
  return data && typeof data === "object" ? data.error : undefined;
}

/**
 * Si la respuesta de POST /auth/refresh prueba que el refresh token no vale.
 *
 * El 401 es siempre del backend (no hay autenticacion delante en el proxy). El
 * 400 solo cuenta si es el "Invalid body" del propio backend: el cuerpo es el
 * token guardado, asi que no se puede arreglar reintentando. Un 400 sin ese
 * cuerpo (un proxy, una pagina HTML) no prueba nada.
 */
export function isRefreshRejection(error) {
  const status = statusOf(error);
  if (status === 401) return true;
  if (status === 400 && bodyError(error) === "Invalid body") return true;
  return false;
}

/**
 * Clasifica un error de GET /auth/me (o de cualquier ruta autenticada).
 *
 * - "invalid": el servidor rechaza las credenciales (401) o el usuario ya no
 *   existe (404 "User not found"). Hay que cerrar la sesion.
 * - "forbidden": 403. La sesion vale; el recurso no es para este usuario.
 * - "temporary": todo lo demas. No se toca la sesion.
 *
 * Un 401 que llega aqui ya paso por el interceptor: o el refresh lo rechazo
 * el servidor (y la sesion ya se aborto), o no habia refresh token, o el token
 * recien emitido tambien fue rechazado. Si el refresh fallo por la red, lo que
 * llega es ese error de red, no el 401.
 */
export function classifySessionError(error) {
  const status = statusOf(error);
  if (status === null) return SESSION_TEMPORARY;
  if (status === 401) return SESSION_INVALID;
  if (status === 404 && bodyError(error) === "User not found") return SESSION_INVALID;
  if (status === 403) return SESSION_FORBIDDEN;
  return SESSION_TEMPORARY;
}
