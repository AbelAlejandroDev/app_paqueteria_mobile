/**
 * Iniciar (o continuar) el Checkout de Stripe de un reenvio, sin React.
 *
 *   1. GET payment-status, justo antes (el estado de la pantalla puede ser viejo).
 *   2. stripePaymentDecision: si no se puede pagar, se para aqui y NO hay POST.
 *   3. POST checkout-session (201 nueva, 200 la misma: reused). Sin reintentos: si
 *      falla, el error sube tal cual (lo interpreta forwardPaymentError).
 *
 * Abrir el navegador y seguir el pago lo hace quien llama.
 */
import { checkoutSessionPath, paymentStatusPath } from "./forward-payment.js";
import { ACTION_NONE, interpretCheckoutSession, stripePaymentDecision } from "./stripe-payment-guard.js";

/**
 * @returns {Promise<
 *   { outcome: "status-unavailable" } |
 *   { outcome: "blocked", status, decision } |
 *   { outcome: "session", status, decision, session }
 * >}
 */
export async function startStripeCheckout(api, { serviceRequestId, localPaymentStatus, body }) {
  let status;
  try {
    status = (await api.get(paymentStatusPath(serviceRequestId))).data;
  } catch {
    // Sin saber el estado no se inicia nada.
    return { outcome: "status-unavailable" };
  }

  const decision = stripePaymentDecision(status, { localPaymentStatus });
  if (decision.action === ACTION_NONE) return { outcome: "blocked", status, decision };

  const response = await api.post(checkoutSessionPath(serviceRequestId), body || {});
  return { outcome: "session", status, decision, session: interpretCheckoutSession(response) };
}
