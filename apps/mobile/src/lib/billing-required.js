/**
 * 402 BILLING_REQUIRED: la cuenta tiene la facturacion en mora.
 *
 * El backend lo devuelve al pedir un servicio con la cuenta restringida
 * (enforceClientBillingGoodStanding): `{ error, code: "BILLING_REQUIRED", billing }`.
 * Otros 402 no son esto: approve-scan responde `402 { error: "Payment failed",
 * pending: true }` cuando no se confirmo el cobro de un escaneo, y eso lo trata
 * su pantalla.
 *
 * El aviso no navega solo: pregunta, y "Go to Billing" lleva a Facturacion con
 * router.navigate (no apila pantallas). No se pregunta estando ya en
 * Facturacion, ni mas de una vez cada COOLDOWN_MS, ni con otro aviso abierto:
 * asi no hay bucle aunque varias peticiones devuelvan 402 a la vez o la propia
 * pantalla de Facturacion recargue algo que lo devuelva.
 */

export const BILLING_REQUIRED_CODE = "BILLING_REQUIRED";
export const BILLING_ROUTE = "/billing";
export const BILLING_PROMPT_COOLDOWN_MS = 60000;

export function isBillingRequiredError(error) {
  return error?.response?.status === 402 && error.response.data?.code === BILLING_REQUIRED_CODE;
}

/** El mensaje del backend, o uno generico. */
export function billingRequiredMessage(error) {
  const message = error?.response?.data?.error;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : "Your account has a billing issue. Update your payment to keep using your mailbox services.";
}

export function isOnBillingRoute(pathname) {
  const path = String(pathname || "");
  return path === BILLING_ROUTE || path.startsWith(BILLING_ROUTE + "/");
}

/** Si hay que enseñar el aviso ahora. */
export function shouldPromptBillingRequired({ pathname, now = Date.now(), lastPromptAt = 0, promptOpen = false }) {
  if (promptOpen) return false;
  if (isOnBillingRoute(pathname)) return false;
  if (lastPromptAt && now - lastPromptAt < BILLING_PROMPT_COOLDOWN_MS) return false;
  return true;
}

// ── Aviso del interceptor a la pantalla ─────────────────────────────────────

const listeners = new Set();

export function subscribeBillingRequired(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Lo llama el interceptor; devuelve true si el error era BILLING_REQUIRED. */
export function reportBillingRequired(error) {
  if (!isBillingRequiredError(error)) return false;
  const event = { message: billingRequiredMessage(error), billing: error.response.data?.billing || null };
  listeners.forEach((listener) => listener(event));
  return true;
}

/**
 * Una sola puerta para el aviso, compartida por toda la app: el cooldown y el
 * "ya hay uno abierto" sobreviven a los cambios de pantalla.
 */
export function createBillingPromptGate({ now = () => Date.now() } = {}) {
  let lastPromptAt = 0;
  let promptOpen = false;

  return {
    /** true si hay que enseñar el aviso ahora (y queda marcado como abierto). */
    tryOpen(pathname) {
      const at = now();
      if (!shouldPromptBillingRequired({ pathname, now: at, lastPromptAt, promptOpen })) return false;
      promptOpen = true;
      lastPromptAt = at;
      return true;
    },
    close() {
      promptOpen = false;
    },
  };
}

export const billingPromptGate = createBillingPromptGate();
