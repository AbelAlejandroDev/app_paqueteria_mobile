/**
 * Cuando se puede iniciar (o continuar) el pago de un reenvio con Stripe. Sin React.
 *
 * Contrato nuevo (backend `fix/stripe-forwarding-double-charge`, 7b52ccd;
 * docs/mobile/pagos-forwarding.md §3c y §4): GET payment-status trae
 *   { provider: "STRIPE", paymentStatus, shipmentStatus,
 *     attempt: { state, checkout, amount, currency, expiresAt } | null,
 *     canStartNewPayment, needsReview, reconciled, uncertain }
 * y el servidor garantiza un solo intento vivo por envio (indice unico).
 *
 * Contrato anterior (lo desplegado a 2026-11-15): solo
 *   { provider: "STRIPE", paymentStatus, shipmentStatus }
 * y abrir otro Checkout cancela el PaymentIntent anterior SOLO "si se puede": un
 * pago hecho antes de que llegue el webhook podria cobrarse dos veces.
 *
 * La decision se toma SIEMPRE con un payment-status recien leido, justo antes del
 * POST (el boton no es la proteccion). Nada aqui inicia un pago solo.
 */

export const ACTION_PAY = "pay"; // iniciar un cobro
export const ACTION_RESUME = "resume"; // volver a la MISMA sesion abierta (reused: true)
export const ACTION_NONE = "none";

const TERMINAL_CLOSED = ["REFUNDED", "CANCELLED"];
const OPEN_FOR_PAYMENT = ["NOT_STARTED", "READY_FOR_PAYMENT", "FAILED", "AUTHENTICATION_REQUIRED"];

/** El backend nuevo: payment-status trae los campos del intento. */
export function isAttemptAwareStatus(status) {
  return Boolean(status) && typeof status.canStartNewPayment === "boolean";
}

/**
 * Que permite hacer este payment-status.
 * @returns {{ action, reason, message, checkStatus?, contactCenter?, paid? }}
 *   reason: paid | closed | review | uncertain | processing | open-session |
 *           can-pay | pending-legacy | conflict | unknown
 */
export function stripePaymentDecision(status, { localPaymentStatus } = {}) {
  if (!status || typeof status !== "object") {
    return { action: ACTION_NONE, reason: "unknown", checkStatus: true, message: "We could not confirm the payment status. Check again in a moment." };
  }

  const paymentStatus = status.paymentStatus || null;

  if (paymentStatus === "PAID") return { action: ACTION_NONE, reason: "paid", paid: true, message: "Payment received. We're preparing your label." };
  if (TERMINAL_CLOSED.includes(paymentStatus)) return { action: ACTION_NONE, reason: "closed", message: "This payment can no longer be completed." };

  // Lo que la pieza dice que esta pagado y el servidor no: no se paga hasta aclararlo.
  if (localPaymentStatus === "PAID") {
    return { action: ACTION_NONE, reason: "conflict", checkStatus: true, message: "We're confirming this payment. Pull down to refresh before paying." };
  }

  if (isAttemptAwareStatus(status)) {
    const attempt = status.attempt || null;
    if (status.needsReview || attempt?.state === "NEEDS_REVIEW") {
      return { action: ACTION_NONE, reason: "review", contactCenter: true, message: "Your center is reviewing this payment. Please don't pay again." };
    }
    if (status.uncertain) {
      return { action: ACTION_NONE, reason: "uncertain", checkStatus: true, message: "We couldn't confirm the payment with Stripe. Nothing new was charged; check again in a moment." };
    }
    if (attempt && (attempt.state === "PROCESSING" || attempt.state === "CREATING")) {
      return { action: ACTION_NONE, reason: "processing", checkStatus: true, message: "Your payment is being processed. Check again in a moment." };
    }
    if (attempt?.state === "OPEN" && attempt.checkout === "CHECKOUT_SESSION" && !isExpired(attempt.expiresAt)) {
      // Continuar la misma sesion no es un cobro nuevo: el backend devuelve la misma (200, reused).
      return { action: ACTION_RESUME, reason: "open-session", message: "You have a payment page open for this shipment." };
    }
    if (status.canStartNewPayment === true) return { action: ACTION_PAY, reason: "can-pay", message: null };
    return { action: ACTION_NONE, reason: "unknown", checkStatus: true, message: "This payment can't be started right now. Check again in a moment." };
  }

  // Backend anterior: un pago empezado y sin confirmar es ambiguo. No se ofrece otro.
  if (paymentStatus === "PAYMENT_PENDING") {
    return {
      action: ACTION_NONE,
      reason: "pending-legacy",
      checkStatus: true,
      contactCenter: true,
      message: "A payment was started for this shipment and isn't confirmed yet. Check its status, or contact your center if it doesn't update.",
    };
  }
  if (OPEN_FOR_PAYMENT.includes(paymentStatus)) return { action: ACTION_PAY, reason: "can-pay", message: null };
  return { action: ACTION_NONE, reason: "unknown", checkStatus: true, message: "This payment can't be started right now. Check again in a moment." };
}

/** expiresAt de Stripe: segundos Unix (checkout-session) o ISO (payment-status). */
export function expiresAtMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

export function isExpired(value, now = Date.now(), marginMs = 30 * 1000) {
  const ms = expiresAtMs(value);
  return ms !== null && ms - now <= marginMs;
}

/**
 * La respuesta de POST checkout-session. 201 = sesion nueva; 200 = la misma de
 * antes (reused: true). paymentIntentId puede ser null: no se usa para nada (el
 * seguimiento es payment-status).
 */
export function interpretCheckoutSession(response) {
  const data = response?.data || {};
  const url = typeof data.url === "string" ? data.url.trim() : "";
  return {
    reused: data.reused === true || response?.status === 200,
    created: response?.status === 201,
    url: /^https:\/\//i.test(url) ? url : null,
    sessionId: data.sessionId || null,
    expired: isExpired(data.expiresAt),
    amount: Number.isFinite(Number(data.amount)) ? Number(data.amount) : null,
    currency: data.currency || "USD",
  };
}

/** Segundos de espera de un 409/503: retryAfterSeconds del cuerpo o la cabecera Retry-After. */
export function retryAfterSeconds(error, now = Date.now()) {
  const fromBody = Number(error?.response?.data?.retryAfterSeconds);
  if (Number.isFinite(fromBody) && fromBody > 0) return Math.min(Math.ceil(fromBody), 300);
  const headers = error?.response?.headers || {};
  const raw = typeof headers.get === "function" ? headers.get("retry-after") : headers["retry-after"] ?? headers["Retry-After"];
  if (raw === undefined || raw === null || raw === "") return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(Math.ceil(seconds), 300);
  const date = Date.parse(String(raw));
  if (Number.isFinite(date)) return Math.min(Math.max(1, Math.ceil((date - now) / 1000)), 300);
  return null;
}

/** Hasta cuando no se vuelve a ofrecer el pago tras un 409 BUSY (ms). */
export function busyDeadline(seconds, now = Date.now()) {
  return now + Math.max(1, Number(seconds) || 3) * 1000;
}

export function isStillBusy(deadline, now = Date.now()) {
  return Number(deadline) > now;
}
