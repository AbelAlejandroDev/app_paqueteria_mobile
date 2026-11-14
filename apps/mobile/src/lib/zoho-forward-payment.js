/**
 * Pago de un reenvio con Zoho (checkout HOSTED). Sin React.
 *
 * Contrato (backend 348c327; handoff HDG D.4-D.8; capacidades-y-health §3):
 *   POST /client/forwarding/:id/prepare-payment
 *     {}                    -> revision: EMITE LA FACTURA EN ZOHO y devuelve
 *                              paymentUrl, expiresAt, desglose e invoiceNumber.
 *     { useSavedCard: true} -> intenta la tarjeta guardada: { paid: true } o
 *                              la factura abierta con autoCharge { reason }.
 *     ya pagado             -> { alreadyPaid: true } o 409 FORWARDING_ALREADY_PAID.
 *   POST /client/forwarding/:id/confirm-repriced-rate (si subio el precio)
 *   GET  /client/forwarding/:id/payment-status -> paymentStatus, chargeStatus,
 *     paymentLinkExpired. Unica fuente de verdad; como mucho cada 15 s.
 *
 * Reglas que no se negocian:
 *   - prepare-payment solo tras una accion explicita del cliente ("Review
 *     payment", "Pay", "Open secure page"): nunca al abrir la pieza.
 *   - Nada se da por pagado sin paymentStatus PAID del backend. La URL de
 *     vuelta (portal web) no prueba nada.
 *   - Ningun reintento automatico de un cobro.
 */

import { isSecurePageUrl } from "./zoho-billing.js";
import { MIN_PAYMENT_STATUS_POLL_SECONDS } from "./capabilities.js";

export function preparePaymentPath(serviceRequestId) {
  return "/client/forwarding/" + encodeURIComponent(String(serviceRequestId)) + "/prepare-payment";
}

export function confirmRepricedRatePath(serviceRequestId) {
  return "/client/forwarding/" + encodeURIComponent(String(serviceRequestId)) + "/confirm-repriced-rate";
}

export function paymentStatusPath(serviceRequestId) {
  return "/client/forwarding/" + encodeURIComponent(String(serviceRequestId)) + "/payment-status";
}

/** Cuerpos permitidos: la revision ({}) o el cobro con la tarjeta guardada. */
export const REVIEW_BODY = Object.freeze({});
export const SAVED_CARD_BODY = Object.freeze({ useSavedCard: true });

// ── Respuesta de prepare-payment ────────────────────────────────────────────

/**
 * El desglose como lo pinta el portal web (ZohoForwardPaymentPanel):
 * franqueo = postageAmount - postageFeeAmount; gestion = postageFeeAmount;
 * recargo = adminFeeAmount; total = amount. Todo en centavos.
 */
export function paymentBreakdown(data) {
  const cents = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  const postageAmount = cents(data?.postageAmount);
  const handling = cents(data?.postageFeeAmount);
  return {
    postage: postageAmount !== null && handling !== null ? postageAmount - handling : postageAmount,
    handling,
    surcharge: cents(data?.adminFeeAmount),
    total: cents(data?.amount),
    currency: data?.currency || "USD",
    invoiceNumber: data?.invoiceNumber || null,
  };
}

/** Si la respuesta de prepare-payment dice que ya esta pagado. */
export function isPaidPrepareResponse(data) {
  return data?.paid === true || data?.alreadyPaid === true || data?.paymentStatus === "PAID";
}

/** Si la pagina de Zoho ya caduco (o caduca en menos de `marginMs`). Sin fecha, no se sabe: se usa. */
export function isPaymentLinkExpired(expiresAt, now = Date.now(), marginMs = 60 * 1000) {
  if (!expiresAt) return false;
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return false;
  return at - now <= marginMs;
}

/**
 * Que hacer con la respuesta 200 de prepare-payment.
 *   { kind: "paid" }                              -> listo, refrescar.
 *   { kind: "invoice", paymentUrl, expiresAt, breakdown, autoCharge } -> revisar / pagar.
 *   { kind: "invalid" }                           -> la URL no es https valida.
 */
export function interpretPrepareResponse(data) {
  if (isPaidPrepareResponse(data)) return { kind: "paid" };
  const paymentUrl = isSecurePageUrl(data?.paymentUrl) ? data.paymentUrl.trim() : null;
  if (!paymentUrl) return { kind: "invalid" };
  return {
    kind: "invoice",
    paymentUrl,
    expiresAt: data?.expiresAt || null,
    reused: data?.reused === true,
    breakdown: paymentBreakdown(data),
    autoCharge: autoChargeOutcome(data?.autoCharge),
  };
}

/** No se reintenta la tarjeta durante 30 min tras COLLECT_UNCONFIRMED (backend COLLECT_UNCONFIRMED_HOLD_MS). */
export const COLLECT_UNCONFIRMED_HOLD_MS = 30 * 60 * 1000;

/**
 * Que paso con la tarjeta guardada (`autoCharge`). null sin intento (revision).
 *   NO_SAVED_CARD        -> no hay tarjeta: pagina segura o añadir metodo.
 *   DECLINED             -> rechazada: pagina segura o actualizar tarjeta.
 *   COLLECT_UNCONFIRMED  -> Zoho no contesto: NO cobrar otra vez (30 min), comprobar estado.
 */
export function autoChargeOutcome(autoCharge) {
  if (!autoCharge || typeof autoCharge !== "object") return null;
  if (autoCharge.paid === true) return { reason: "PAID", savedCard: false, message: null };

  switch (autoCharge.reason) {
    case "NO_SAVED_CARD":
      return {
        reason: "NO_SAVED_CARD",
        savedCard: false,
        offerAddPaymentMethod: true,
        message: "There's no saved card for your account. Pay on the secure page, or add a payment method.",
      };
    case "DECLINED":
      return {
        reason: "DECLINED",
        savedCard: false,
        offerUpdateCard: true,
        message: "Your saved card was not charged. Pay on the secure page, or update your card.",
      };
    case "COLLECT_UNCONFIRMED":
      return {
        reason: "COLLECT_UNCONFIRMED",
        savedCard: false,
        holdMs: COLLECT_UNCONFIRMED_HOLD_MS,
        message: "We're still confirming an earlier attempt. Nothing new was charged. Check the status in a moment.",
      };
    default:
      return { reason: autoCharge.reason || "UNKNOWN", savedCard: false, message: "Your saved card was not charged." };
  }
}

// ── Errores de prepare-payment / confirm-repriced-rate ──────────────────────

/** Codigos con los que la tarifa ya no se puede pagar (backend REPRICE_BLOCKING_CODES). */
const REPRICE_BLOCKING_CODES = [
  "FORWARDING_SERVICE_UNAVAILABLE",
  "FORWARDING_PACKAGE_CHANGED",
  "FORWARDING_ORIGIN_CHANGED",
  "CENTER_SHIPPING_ADDRESS_NOT_VERIFIED",
  "FORWARDING_CARRIER_ACCOUNT_UNAVAILABLE",
  "FORWARDING_REPRICE_NOT_PAYABLE",
];

/**
 * Que significa un error del pago. `retryable` dice si se puede ofrecer el
 * mismo boton otra vez (siempre por decision del cliente, nunca solo).
 */
export function preparePaymentError(error) {
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

  if (code === "FORWARDING_PRICE_RECONFIRMATION_REQUIRED") {
    return {
      kind: "reprice",
      retryable: false,
      currentAmount: Number(data?.reprice?.currentAmount) || null,
      previousAmount: Number(data?.reprice?.previousAmount) || null,
      currency: data?.reprice?.currency || "USD",
      message: "The shipping price changed. Review the new amount before paying.",
    };
  }
  if (code === "FORWARDING_ALREADY_PAID") return { kind: "paid", retryable: false, message: null };
  if (code === "ZOHO_PAYMENT_UNDER_REVIEW") {
    return { kind: "review", retryable: false, message: "This payment is being reviewed by your center. Please don't pay again; contact your center." };
  }
  if (code === "ZOHO_PAYMENT_IN_PROGRESS") {
    return { kind: "in-progress", retryable: true, checkStatus: true, message: "A payment is already in progress. Wait a moment and check the status." };
  }
  if (code === "ZOHO_OUTCOME_UNCERTAIN" || code === "ZOHO_VOID_UNCONFIRMED") {
    return { kind: "unknown-outcome", retryable: false, checkStatus: true, message: "Nothing new was charged. We're still confirming an earlier attempt: check the status in a moment." };
  }
  if (code === "FORWARDING_REPRICE_EXPIRED") {
    return { kind: "reprice-expired", retryable: true, message: "The new price expired. Review the payment again to get the current amount." };
  }
  if (REPRICE_BLOCKING_CODES.includes(code) || code === "FORWARD_REQUEST_NOT_PAYABLE") {
    return { kind: "not-payable", retryable: false, message: "This shipment can't be paid as it is. Please contact your center." };
  }
  if (["ONLINE_PAYMENTS_UNAVAILABLE", "ZOHO_FORWARDING_PAYMENTS_UNAVAILABLE", "CENTER_POLICY_NOT_CONFIGURED", "BILLING_PROVIDER_NOT_ZOHO", "ZOHO_CUSTOMER_NOT_LINKED"].includes(code)) {
    return { kind: "unavailable", retryable: false, message: "Online payment isn't available for this shipment. Please contact your center." };
  }
  if (code === "PITNEY_POSTAGE_BALANCE_LOW" || code === "PITNEY_BOWES_TIMEOUT" || status >= 500) {
    return { kind: "temporary", retryable: true, message: "The payment couldn't be prepared right now. Nothing was charged. Please try again in a few minutes." };
  }
  if (status === 404) return { kind: "not-found", retryable: false, message: "We couldn't find this shipment. Pull down to refresh." };
  return { kind: "error", retryable: true, message: (typeof data?.error === "string" && data.error) || "Unable to prepare the payment." };
}

// ── payment-status ──────────────────────────────────────────────────────────

/**
 * Lectura de GET payment-status (alineada con describeZohoReturn del web).
 *   paid          PAID: listo; la etiqueta se prepara despues.
 *   review        chargeStatus REVIEW: en revision del centro; no pagar otra vez.
 *   failed        FAILED: ofrecer pagar de nuevo.
 *   closed        REFUNDED / CANCELLED: ya no se paga.
 *   link-expired  paymentLinkExpired: "Pay" vuelve a llamar a prepare-payment (reutiliza la factura).
 *   pending       el resto: aun sin confirmacion.
 */
export function interpretPaymentStatus(status) {
  const paymentStatus = status?.paymentStatus || null;
  if (paymentStatus === "PAID") return { state: "paid", terminal: true, message: "Payment received. We're preparing your label." };
  if (status?.chargeStatus === "REVIEW") {
    return { state: "review", terminal: true, message: "Your payment is being reviewed by your center. Please don't pay again." };
  }
  if (paymentStatus === "REFUNDED" || paymentStatus === "CANCELLED") {
    return { state: "closed", terminal: true, message: "This payment can no longer be completed." };
  }
  if (paymentStatus === "FAILED") return { state: "failed", terminal: true, message: "The payment didn't go through. You can try again." };
  if (status?.paymentLinkExpired === true) {
    return { state: "link-expired", terminal: true, message: "The payment page expired. Tap Pay to open a new one." };
  }
  return { state: "pending", terminal: false, message: "We don't have a confirmation yet. It can take a minute." };
}

// ── Sondeo de payment-status ────────────────────────────────────────────────

/**
 * Pregunta payment-status como mucho cada `minIntervalMs` (>= 15 s) y hasta
 * `maxAttempts` veces seguidas (~1 min con 4), parando en un estado final.
 * `checkNow()` ("Check again", volver a primer plano) respeta el minimo: si es
 * pronto, programa la consulta para cuando toque y devuelve cuanto falta.
 *
 * Solo lee: nunca vuelve a llamar a prepare-payment ni cobra nada.
 */
export function createStatusPoller({
  fetchStatus,
  onResult,
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

    const reading = result.ok ? interpretPaymentStatus(result.status) : null;
    onResult?.({ ...result, reading, attempts });

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
