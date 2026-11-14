/**
 * Si un error de la API significa "el servicio no esta disponible ahora".
 *
 * Es lo que decide la pantalla global de "servicio no disponible". Hay que
 * distinguir dos cosas que llegan con el mismo codigo HTTP:
 *
 *   - Una caida de verdad: sin red, timeout, o un 502/503/504 que da el proxy
 *     (Traefik) porque la API no responde. El cuerpo no es del backend (HTML,
 *     vacio).
 *   - Un error concreto del backend con ese codigo: 503
 *     ADDRESS_VERIFICATION_UNAVAILABLE (Pitney), 503 ZOHO_OUTCOME_UNCERTAIN,
 *     502 ZOHO_PAYMENT_PAGE_UNAVAILABLE... El backend responde siempre JSON con
 *     `error` (src/middlewares/errorHandler.js). Eso lo trata la pantalla que
 *     hizo la peticion; tapar la app con "mantenimiento" lo esconderia.
 *
 * Un 500 con el JSON del backend es un fallo de ESA peticion, no del servicio.
 */

export const AVAILABILITY_OFFLINE = "offline";
export const AVAILABILITY_TIMEOUT = "timeout";
export const AVAILABILITY_UNAVAILABLE = "unavailable";

/** Por defecto, cuanto se espera una respuesta antes de darla por perdida. */
export const DEFAULT_TIMEOUT_MS = 20000;

const TIMEOUT_CODES = new Set(["ECONNABORTED", "ETIMEDOUT"]);

/** El cuerpo de error que da el propio backend: un objeto con `error` de texto. */
export function isBackendErrorBody(data) {
  return Boolean(data && typeof data === "object" && !Array.isArray(data) && typeof data.error === "string");
}

/** Una cancelacion (React Query al vaciar la cache, un AbortController) no es una caida. */
export function isCancellation(error) {
  return error?.code === "ERR_CANCELED" || error?.name === "CanceledError" || error?.__CANCEL__ === true;
}

export function isTimeoutError(error) {
  if (!error || error.response) return false;
  return TIMEOUT_CODES.has(error.code) || /timeout/i.test(String(error.message || ""));
}

/**
 * null si el error no dice nada de la disponibilidad del servicio; si no,
 * "offline" | "timeout" | "unavailable".
 */
export function classifyAvailability(error) {
  if (!error || isCancellation(error)) return null;

  if (!error.response) {
    // Sin respuesta y sin peticion no es la red: es un fallo de la app
    // (configuracion de axios, un throw antes de enviar).
    if (!error.request && !error.code) return null;
    return isTimeoutError(error) ? AVAILABILITY_TIMEOUT : AVAILABILITY_OFFLINE;
  }

  const { status, data } = error.response;
  if (status >= 500 && !isBackendErrorBody(data)) return AVAILABILITY_UNAVAILABLE;
  return null;
}

/**
 * Si la respuesta de una sonda prueba que la API esta viva: cualquier
 * respuesta por debajo de 500, o un 5xx con el cuerpo del backend (la app
 * responde; el fallo es de esa ruta).
 */
export function isReachableResponse(response) {
  if (!response) return false;
  return response.status < 500 || isBackendErrorBody(response.data);
}
