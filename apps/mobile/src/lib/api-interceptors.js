import { reportBillingRequired } from "./billing-required.js";
import { reportCapabilityError } from "./capabilities-events.js";
import { reportFromError, reportServiceRecovered } from "./service-status.js";

/**
 * Lo que la app observa de cada respuesta. Se registra despues del interceptor
 * de sesion de core (que corre antes): aqui llega el resultado final.
 *
 * - Respuesta: la API esta viva.
 * - Sin red, timeout o caida del proxy: pantalla de "servicio no disponible".
 *   La sesion no se toca.
 * - 402 BILLING_REQUIRED: aviso para ir a Facturacion.
 * - 402/409 de una guarda: las capacidades pueden estar viejas; se releen.
 *
 * Solo observa: no repite ninguna peticion. El error sigue hasta quien la hizo.
 */
export function attachAppInterceptors(api) {
  api.interceptors.response.use(
    (response) => {
      reportServiceRecovered();
      return response;
    },
    (error) => {
      reportFromError(error);
      reportBillingRequired(error);
      reportCapabilityError(error);
      return Promise.reject(error);
    }
  );
  return api;
}
