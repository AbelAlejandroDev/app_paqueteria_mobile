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
import { forwardPaymentError } from "./forward-payment.js";
import { chargeFromZohoPayment } from "./price-display.js";
import { collectPendingReason } from "./auto-charge-consent.js";

// Lo comun a Stripe y Zoho (rutas, recotizacion, estado y sondeo) esta en
// lib/forward-payment; se reexporta para quien importa desde aqui.
export {
  confirmRepricedRatePath,
  createStatusPoller,
  interpretPaymentStatus,
  paymentStatusPath,
  preparePaymentPath,
} from "./forward-payment.js";

/** Cuerpos permitidos: la revision ({}) o el cobro con la tarjeta guardada. */
export const REVIEW_BODY = Object.freeze({});
export const SAVED_CARD_BODY = Object.freeze({ useSavedCard: true });

// ── Respuesta de prepare-payment ────────────────────────────────────────────

/**
 * El desglose para el cliente (lib/price-display), en centavos:
 *   shippingAndHandling = postageAmount (franqueo + gestion; la gestion,
 *     postageFeeAmount, nunca va en una linea propia);
 *   mailForwardingFee   = adminFeeAmount;
 *   total               = amount.
 */
export function paymentBreakdown(data) {
  const charge = chargeFromZohoPayment(data);
  return {
    shippingAndHandling: charge.shippingAndHandling,
    mailForwardingFee: charge.mailForwardingFee,
    total: charge.total,
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
 *   { kind: "collect-pending", reason }           -> sin pagina porque el centro
 *        tiene un cobro en curso o sin confirmar (COLLECT_IN_PROGRESS /
 *        COLLECT_UNCONFIRMED): consultar el estado, NUNCA otro intento.
 *   { kind: "invalid" }                           -> la URL no es https valida.
 */
export function interpretPrepareResponse(data) {
  if (isPaidPrepareResponse(data)) return { kind: "paid" };
  const collectReason = collectPendingReason(data);
  if (collectReason) return { kind: "collect-pending", reason: collectReason };
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

/** Errores de prepare-payment: los comunes de lib/forward-payment (con los de Zoho). */
export const preparePaymentError = forwardPaymentError;
