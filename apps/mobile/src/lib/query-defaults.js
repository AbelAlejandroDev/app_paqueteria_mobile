import { classifyAvailability } from "@paqueteria/core";

/**
 * Opciones por defecto de React Query para toda la app.
 *
 * - Consultas (GET, idempotentes): un reintento como mucho, y ninguno si el
 *   error es un 4xx (no va a cambiar) o una caida del servicio (de eso se
 *   encarga la pantalla de "servicio no disponible", que vuelve a consultar al
 *   recuperarse).
 * - Mutaciones: NUNCA se reintentan solas. Son POST/PATCH que crean pagos,
 *   sesiones de Stripe, peticiones de escaneo o reenvio con cargo, bajas...
 *   Tras un timeout o un 5xx el resultado es desconocido: repetirla podria
 *   duplicar un cobro o una peticion. El cliente decide, viendo el estado real
 *   que se vuelve a leer del servidor.
 */
export function shouldRetryQuery(failureCount, error) {
  if (failureCount >= 1) return false;
  const status = error?.response?.status;
  if (status >= 400 && status < 500) return false;
  if (classifyAvailability(error)) return false;
  return true;
}

export const QUERY_DEFAULT_OPTIONS = {
  queries: {
    retry: shouldRetryQuery,
  },
  mutations: {
    retry: false,
  },
};

/** Mas tiempo para subir ficheros (fotos del USPS Form 1583). */
export const UPLOAD_TIMEOUT_MS = 120000;
