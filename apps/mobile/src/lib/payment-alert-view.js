import { PROVIDER_STRIPE } from "./capabilities.js";
import { secureHttpsUrlOrNull } from "./secure-url.js";

/**
 * Que ofrece la ventana de cobro fallido (components/common/payment-alerts).
 *
 * - "Pay now" solo con una factura https (`invoiceUrl` del aviso). Hoy solo la
 *   trae Stripe (The Worx): una URL rara no se abre, se trata como sin factura.
 * - El texto nombra a Stripe solo si el proveedor de la cuenta es Stripe. Con
 *   Zoho (HDG) o sin saberlo, "secure payment page": un cliente de HDG nunca lee
 *   que paga con Stripe.
 * - Nada de esto cobra ni cambia el flujo: solo decide que se pinta.
 */
export function paymentAlertView(alert, provider) {
  const invoiceUrl = secureHttpsUrlOrNull(alert?.invoiceUrl);
  if (!invoiceUrl) {
    return { invoiceUrl: null, footnote: "Contact your center to settle this and resume your service." };
  }
  const page = provider === PROVIDER_STRIPE ? "a secure Stripe page" : "a secure payment page";
  return { invoiceUrl, footnote: `Payment opens in ${page}. Your service resumes once it goes through.` };
}
