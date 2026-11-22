/**
 * Lo comun al pago de un reenvio con Stripe y con Zoho. Sin React.
 *
 * Contrato (backend 348c327, src/routes/client/forwarding.routes.js,
 * src/lib/forwardingPayments.js, docs/mobile/pagos-forwarding.md):
 *
 *   Los dos proveedores recotizan ANTES de cobrar (resolvePayableForwarding):
 *   tanto prepare-payment (Zoho) como checkout-session (Stripe) pueden
 *   responder 409 FORWARDING_PRICE_RECONFIRMATION_REQUIRED con `reprice`
 *   { previousAmount, currentAmount, currency, difference }. Solo si el cliente
 *   acepta: POST confirm-repriced-rate, y despues otra vez el pago.
 *
 *   GET payment-status (requireForwardingPayments, los dos proveedores):
 *     Stripe -> { provider: "STRIPE", paymentStatus, shipmentStatus } (lo
 *               guardado; lo actualiza el webhook de Stripe).
 *     Zoho   -> ademas chargeStatus y paymentLinkExpired (relee la factura).
 *   Es la unica fuente de verdad: ninguna URL de vuelta prueba un pago.
 *
 * Lo propio de cada uno vive aparte: lib/zoho-forward-payment (factura,
 * tarjeta guardada, autoCharge) y el Checkout de Stripe en
 * components/common/stripe-forward-payment.
 */

import { MIN_PAYMENT_STATUS_POLL_SECONDS } from "./capabilities.js";
import { retryAfterSeconds } from "./stripe-payment-guard.js";

const segment = (id) => encodeURIComponent(String(id));

/**
 * Centavos de una respuesta, o null si no vienen. Number(null) es 0: sin esto un
 * importe que falta se pintaria como $0.00 (y se podria "aceptar").
 */
export function centsOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function preparePaymentPath(serviceRequestId) {
  return "/client/forwarding/" + segment(serviceRequestId) + "/prepare-payment";
}

export function checkoutSessionPath(serviceRequestId) {
  return "/client/forwarding/" + segment(serviceRequestId) + "/checkout-session";
}

export function confirmRepricedRatePath(serviceRequestId) {
  return "/client/forwarding/" + segment(serviceRequestId) + "/confirm-repriced-rate";
}

export function paymentStatusPath(serviceRequestId) {
  return "/client/forwarding/" + segment(serviceRequestId) + "/payment-status";
}

// ── Errores comunes (recotizacion, ya pagado, no pagable...) ────────────────

/** Codigos con los que la tarifa ya no se puede pagar (backend REPRICE_BLOCKING_CODES). */
export const REPRICE_BLOCKING_CODES = [
  "FORWARDING_SERVICE_UNAVAILABLE",
  "FORWARDING_PACKAGE_CHANGED",
  "FORWARDING_ORIGIN_CHANGED",
  "CENTER_SHIPPING_ADDRESS_NOT_VERIFIED",
  "FORWARDING_CARRIER_ACCOUNT_UNAVAILABLE",
  "FORWARDING_REPRICE_NOT_PAYABLE",
];

/** 409 de opciones de envio y cotizacion (backend 7de1ae9); los mismos que lib/forwarding-options. */
export const QUOTE_OPTIONS_INVALID_CODES = [
  "FORWARDING_QUOTE_OUTDATED",
  "FORWARDING_RATE_OPTIONS_MISMATCH",
  "FORWARDING_QUOTE_OPTIONS_MISMATCH",
  "FORWARD_TRACKING_MISMATCH",
  "FORWARD_INSURANCE_MISMATCH",
];

const UNAVAILABLE_CODES = [
  "ONLINE_PAYMENTS_UNAVAILABLE",
  "BILLING_PROVIDER_NOT_STRIPE",
  "BILLING_PROVIDER_NOT_ZOHO",
  "ZOHO_FORWARDING_PAYMENTS_UNAVAILABLE",
  "CENTER_POLICY_NOT_CONFIGURED",
  "ZOHO_CUSTOMER_NOT_LINKED",
];

/**
 * Que significa un error al preparar o iniciar un pago (prepare-payment,
 * checkout-session, confirm-repriced-rate). Nunca implica reintentar solo:
 * `retryable` dice si se puede volver a ofrecer el boton al cliente y
 * `checkStatus` si antes hay que leer payment-status.
 */
export function forwardPaymentError(error) {
  if (!error?.response) {
    return {
      kind: "unknown-outcome",
      retryable: false,
      checkStatus: true,
      message: "We couldn't confirm the result. Nothing is shown as paid until we confirm it: check the status before trying again.",
    };
  }

  const { status, data } = error.response;
  const code = data?.code;
  // Desde fix/stripe-forwarding-double-charge: charged false = seguro que no se
  // cobro; null = aun no se sabe (consultar payment-status).
  const charged = data?.charged === false ? false : data?.charged === null ? null : undefined;
  const withCharged = (outcome) => (charged === undefined ? outcome : { ...outcome, charged, checkStatus: outcome.checkStatus || charged === null });

  // Stripe, contrato nuevo: un solo intento vivo por envio.
  if (code === "FORWARDING_PAYMENT_BUSY") {
    return withCharged({
      kind: "busy",
      retryable: true,
      retryAfterSeconds: retryAfterSeconds(error) ?? 3,
      message: "This payment is already being prepared. Try again in a few seconds.",
    });
  }
  if (code === "FORWARDING_PAYMENT_PROCESSING") {
    return withCharged({ kind: "processing", retryable: false, checkStatus: true, message: "An earlier payment is still being processed. Nothing new was charged; check the status." });
  }
  if (code === "FORWARDING_PAYMENT_UNCERTAIN") {
    return withCharged({
      kind: "unknown-outcome",
      retryable: false,
      checkStatus: true,
      retryAfterSeconds: retryAfterSeconds(error),
      message: "We couldn't confirm the payment with Stripe. Nothing new was charged; check the status before trying again.",
    });
  }
  if (code === "FORWARDING_PAYMENT_NEEDS_REVIEW") {
    return withCharged({ kind: "review", retryable: false, message: "Your center is reviewing an earlier payment for this shipment. Please don't pay again; contact your center." });
  }

  if (code === "FORWARDING_PRICE_RECONFIRMATION_REQUIRED") {
    return {
      kind: "reprice",
      retryable: false,
      currentAmount: centsOrNull(data?.reprice?.currentAmount),
      previousAmount: centsOrNull(data?.reprice?.previousAmount),
      currency: data?.reprice?.currency || "USD",
      message: "The shipping price changed. Review the new amount before paying.",
    };
  }
  if (code === "FORWARDING_ALREADY_PAID") return { kind: "paid", retryable: false, message: null };
  if (code === "FORWARDING_RECONFIRMATION_NOT_REQUIRED") {
    return { kind: "reprice-not-required", retryable: true, message: "The price no longer needs confirmation. You can pay now." };
  }
  if (code === "FORWARDING_REPRICE_EXPIRED") {
    return { kind: "reprice-expired", retryable: true, message: "The new price expired. Start the payment again to get the current amount." };
  }
  // Backend 7de1ae9: la tarifa del envio ya no corresponde con el seguimiento o
  // el seguro pedidos (o la cotizacion caduco). No se paga sobre ella.
  if (QUOTE_OPTIONS_INVALID_CODES.includes(code)) {
    return withCharged({
      kind: "quote-invalid",
      retryable: false,
      message: "This shipment's rate no longer matches the tracking or insurance you chose, so it can't be paid. Please contact your center.",
    });
  }
  if (code === "FORWARDING_PAYMENT_AMOUNT_INVALID") {
    return { kind: "not-payable", retryable: false, message: "This shipment can't be paid as it is. Please contact your center." };
  }
  if (code === "ZOHO_PAYMENT_UNDER_REVIEW") {
    return { kind: "review", retryable: false, message: "This payment is being reviewed by your center. Please don't pay again; contact your center." };
  }
  if (code === "ZOHO_PAYMENT_IN_PROGRESS") {
    return { kind: "in-progress", retryable: true, checkStatus: true, message: "A payment is already in progress. Wait a moment and check the status." };
  }
  if (code === "ZOHO_OUTCOME_UNCERTAIN" || code === "ZOHO_VOID_UNCONFIRMED") {
    return { kind: "unknown-outcome", retryable: false, checkStatus: true, message: "Nothing new was charged. We're still confirming an earlier attempt: check the status in a moment." };
  }
  if (REPRICE_BLOCKING_CODES.includes(code) || code === "FORWARD_REQUEST_NOT_PAYABLE") {
    return { kind: "not-payable", retryable: false, message: "This shipment can't be paid as it is. Please contact your center." };
  }
  if (UNAVAILABLE_CODES.includes(code)) {
    return { kind: "unavailable", retryable: false, message: "Online payment isn't available for this shipment. Please contact your center." };
  }
  if (code === "PITNEY_POSTAGE_BALANCE_LOW" || code === "PITNEY_BOWES_TIMEOUT" || status >= 500) {
    return { kind: "temporary", retryable: true, message: "The payment couldn't be started right now. Nothing was charged. Please try again in a few minutes." };
  }
  if (status === 404) return { kind: "not-found", retryable: false, message: "We couldn't find this shipment. Pull down to refresh." };
  return { kind: "error", retryable: true, message: (typeof data?.error === "string" && data.error) || "Unable to start the payment." };
}

// ── payment-status ──────────────────────────────────────────────────────────

/**
 * Lectura de GET payment-status, para los dos proveedores.
 *   paid           PAID.
 *   pending        sin confirmacion todavia (PAYMENT_PENDING, READY_FOR_PAYMENT...).
 *   failed         FAILED o AUTHENTICATION_REQUIRED (Stripe: el banco pide 3DS).
 *   cancelled      CANCELLED: el pago se anulo; no se paga.
 *   refunded       REFUNDED.
 *   review         (Zoho) chargeStatus REVIEW, o (Stripe) needsReview: en revision del centro.
 *   link-expired   (Zoho) paymentLinkExpired: hace falta una pagina nueva.
 *   expired        (Stripe) la sesion de Checkout caduco sin pagar: se puede pagar de nuevo.
 *   pending + uncertain (Stripe) el servidor no pudo preguntar a Stripe: seguir comprobando.
 */
export function interpretPaymentStatus(status) {
  const paymentStatus = status?.paymentStatus || null;
  const attempt = status?.attempt || null;
  if (paymentStatus === "PAID") return { state: "paid", terminal: true, message: "Payment received. We're preparing your label." };
  // Stripe, contrato nuevo: revision del centro, sin respuesta de Stripe, sesion caducada.
  if (status?.needsReview === true || attempt?.state === "NEEDS_REVIEW") {
    return { state: "review", terminal: true, message: "Your center is reviewing this payment. Please don't pay again." };
  }
  if (status?.uncertain === true) {
    return { state: "pending", terminal: false, uncertain: true, message: "We couldn't confirm the payment with Stripe yet. Nothing new was charged." };
  }
  if ((attempt?.state === "EXPIRED" || attempt?.state === "CANCELED") && status?.canStartNewPayment === true) {
    return { state: "expired", terminal: true, message: "The payment page expired before paying. You can pay again." };
  }
  if (status?.chargeStatus === "REVIEW") {
    return { state: "review", terminal: true, message: "Your payment is being reviewed by your center. Please don't pay again." };
  }
  if (paymentStatus === "CANCELLED") return { state: "cancelled", terminal: true, message: "This payment was cancelled and can no longer be completed." };
  if (paymentStatus === "REFUNDED") return { state: "refunded", terminal: true, message: "This payment was refunded." };
  if (paymentStatus === "AUTHENTICATION_REQUIRED") {
    return { state: "failed", terminal: true, authentication: true, message: "Your bank needs you to verify this payment. You can try again." };
  }
  if (paymentStatus === "FAILED") return { state: "failed", terminal: true, message: "The payment didn't go through. You can try again." };
  if (status?.paymentLinkExpired === true) {
    return { state: "link-expired", terminal: true, message: "The payment page expired. Tap Pay to open a new one." };
  }
  return { state: "pending", terminal: false, message: "We don't have a confirmation yet. It can take a minute." };
}

/**
 * Un pago ya empezado que aun no se confirmo. Con Stripe, abrir otro Checkout
 * cancela el PaymentIntent anterior "si se puede": si el cliente ya pago y el
 * webhook no ha llegado, otro pago podria cobrar dos veces. Por eso, en este
 * estado, primero se lee payment-status y pagar otra vez pide confirmacion.
 */
export function isPaymentInFlight(paymentStatus) {
  return paymentStatus === "PAYMENT_PENDING";
}

// ── Sondeo de payment-status ────────────────────────────────────────────────

/**
 * Pregunta payment-status como mucho cada `minIntervalMs` (nunca menos de 15 s:
 * Zoho no se relee antes, y Stripe solo cambia con su webhook) y hasta
 * `maxAttempts` veces seguidas, parando en un estado final. `checkNow()`
 * ("Check again", volver a primer plano) respeta el minimo: si es pronto,
 * programa la consulta para cuando toque y devuelve cuanto falta.
 *
 * Solo lee: nunca prepara, inicia ni repite un pago.
 */
export function createStatusPoller({
  fetchStatus,
  onResult,
  interpret = interpretPaymentStatus,
  minIntervalMs = MIN_PAYMENT_STATUS_POLL_SECONDS * 1000,
  maxAttempts = 4,
  now = () => Date.now(),
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  const interval = Math.max(MIN_PAYMENT_STATUS_POLL_SECONDS * 1000, Number(minIntervalMs) || 0);
  let lastCheckAt = null;
  let attempts = 0;
  let timer = null;
  let stopped = false;
  let inFlight = false;

  const clear = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };

  const run = async () => {
    timer = null;
    if (stopped || inFlight) return;
    inFlight = true;
    lastCheckAt = now();
    attempts += 1;
    let result;
    try {
      result = { ok: true, status: await fetchStatus() };
    } catch (error) {
      result = { ok: false, error };
    }
    inFlight = false;
    if (stopped) return;

    const reading = result.ok ? interpret(result.status) : null;
    onResult?.({ ...result, reading, attempts, exhausted: !reading?.terminal && attempts >= maxAttempts });

    if (reading?.terminal) {
      stopped = true;
      return;
    }
    if (attempts < maxAttempts) timer = schedule(run, interval);
  };

  const waitFor = () => (lastCheckAt === null ? 0 : Math.max(0, lastCheckAt + interval - now()));

  return {
    /** Empieza (o reanuda) una tanda de `maxAttempts` comprobaciones. */
    start() {
      stopped = false;
      attempts = 0;
      clear();
      const wait = waitFor();
      timer = schedule(run, wait);
      return wait;
    },
    /** "Check again": ya, o en cuanto pase el minimo. Devuelve los ms que faltan. */
    checkNow() {
      if (stopped) {
        stopped = false;
        attempts = Math.max(0, maxAttempts - 1);
      }
      clear();
      const wait = waitFor();
      timer = schedule(run, wait);
      return wait;
    },
    stop() {
      stopped = true;
      clear();
    },
    get attempts() {
      return attempts;
    },
  };
}

// ── Una sola operacion a la vez ─────────────────────────────────────────────

/**
 * Candado contra la doble pulsacion. `isPending` de React Query no basta: dos
 * toques en el mismo fotograma llegan antes del re-render y mandarian dos POST.
 * `run(fn)` ejecuta `fn` solo si no hay otra en curso; si la hay, devuelve null.
 */
export function createSingleFlight() {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    run(fn) {
      if (busy) return null;
      busy = true;
      let result;
      try {
        result = fn();
      } catch (error) {
        busy = false;
        throw error;
      }
      return Promise.resolve(result).finally(() => {
        busy = false;
      });
    },
  };
}
