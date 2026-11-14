import { isCapabilityError } from "./capabilities.js";

/**
 * Aviso de "las capacidades pueden estar viejas". Lo emite el interceptor de la
 * API tras un 402/409 de una guarda (contrato v1, §1) y quien hace un pago; lo
 * escucha CapabilitiesSync, que vuelve a pedirlas.
 */
const listeners = new Set();

export function subscribeCapabilitiesStale(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyCapabilitiesStale(reason = "manual") {
  listeners.forEach((listener) => listener(reason));
}

/** Lo llama el interceptor; true si el error era de una guarda. */
export function reportCapabilityError(error) {
  if (!isCapabilityError(error)) return false;
  notifyCapabilitiesStale(error.response.data.code);
  return true;
}
