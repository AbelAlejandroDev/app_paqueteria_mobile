/**
 * Estado del cobro de un escaneo. Sin React.
 *
 * Contrato (backend `fix/stripe-forwarding-double-charge`, cd1e28f;
 * docs/mobile/api-cliente.md): GET /client/service-requests/:id/scan-payment
 *   { serviceRequestId, serviceRequestStatus, provider, paymentState, amount,
 *     currency, pageCount, paidAt, reason, invoice }
 *   paymentState: NOT_REQUIRED | AWAITING_APPROVAL | PAID | PENDING | FAILED |
 *                 UNCERTAIN | NEEDS_REVIEW | CLOSED
 *   invoice: Zoho { provider: "ZOHO", invoiceId, number, status, payable }
 *            Stripe { provider: "STRIPE", hostedInvoiceUrl, status }
 *   404 SCAN_REQUEST_NOT_FOUND si no es del cliente.
 *
 * Con el backend desplegado a 2026-11-15 la ruta no existe (404 generico, sin
 * code): la app no enseña nada y el aviso SCAN_PAYMENT_FAILED sigue llevando
 * a Facturacion o a la factura.
 *
 * Nunca se abre una factura de Stripe en una cuenta de Zoho (HDG), ni al reves.
 */
import { PROVIDER_STRIPE, PROVIDER_ZOHO } from "./capabilities.js";
import { isSecurePageUrl, isValidZohoInvoiceId } from "./zoho-billing.js";

export const SCAN_PAYMENT_QUERY_KEY = "scan-payment";

export function scanPaymentPath(serviceRequestId) {
  return "/client/service-requests/" + encodeURIComponent(String(serviceRequestId)) + "/scan-payment";
}

/** El backend anterior no tiene la ruta: 404 sin code. */
export function isScanPaymentUnsupported(error) {
  return error?.response?.status === 404 && !error.response.data?.code;
}

const OPEN_STATES = ["PENDING", "FAILED", "UNCERTAIN", "NEEDS_REVIEW"];

/**
 * Si conviene preguntar por el cobro de este escaneo: con importe cotizado, sin
 * pagar y sin cerrar. (La respuesta decide; esto solo evita peticiones inutiles.)
 */
export function shouldTrackScanPayment(request) {
  if (request?.type !== "SCAN") return false;
  if (["COMPLETED", "CANCELLED", "REJECTED", "AWAITING_CLIENT_APPROVAL"].includes(request.status)) return false;
  const details = request.scanDetails || {};
  const amount = Number(details.quotedAmountCents);
  return Boolean(details.quotedAt) && Number.isFinite(amount) && amount > 0 && !details.paidAt;
}

/**
 * Que enseñar y que ofrecer. `accountProvider` es el de /client/capabilities:
 * una accion de pago solo se ofrece si coincide con el de la respuesta.
 *   visible: si hay algo que decir (un cobro abierto).
 *   action:  "zoho-invoice" { invoiceId } | "stripe-invoice" { url } | "billing" | "check" | "contact" | null
 */
export function interpretScanPayment(data, { accountProvider } = {}) {
  const state = typeof data?.paymentState === "string" ? data.paymentState : null;
  if (!state || !OPEN_STATES.includes(state)) {
    return { visible: false, state, action: null, message: state === "PAID" ? "Scan paid." : null };
  }

  const provider = data.provider === PROVIDER_ZOHO || data.provider === PROVIDER_STRIPE ? data.provider : null;
  const sameProvider = provider && (!accountProvider || accountProvider === provider);
  const invoice = data.invoice || null;

  if (state === "UNCERTAIN") {
    return { visible: true, state, action: "check", message: "We couldn't confirm the scan payment yet. Nothing new was charged; we'll check again." };
  }
  if (state === "NEEDS_REVIEW") {
    return { visible: true, state, action: "contact", message: "Your center is reviewing the scan payment. Please don't pay again." };
  }
  if (state === "PENDING") {
    return { visible: true, state, action: "check", message: "The scan payment is being processed." };
  }

  // FAILED: se puede pagar la factura, con el proveedor de la cuenta.
  const base = { visible: true, state, message: "The scan payment didn't go through. Your scan is delivered once it's paid." };
  if (sameProvider && provider === PROVIDER_ZOHO) {
    if (invoice?.provider === PROVIDER_ZOHO && invoice.payable === true && isValidZohoInvoiceId(invoice.invoiceId)) {
      return { ...base, action: "zoho-invoice", invoiceId: String(invoice.invoiceId), invoiceNumber: invoice.number || null };
    }
    return { ...base, action: "billing" };
  }
  if (sameProvider && provider === PROVIDER_STRIPE && invoice?.provider === PROVIDER_STRIPE && isSecurePageUrl(invoice.hostedInvoiceUrl)) {
    return { ...base, action: "stripe-invoice", url: invoice.hostedInvoiceUrl.trim() };
  }
  return { ...base, action: "contact", message: base.message + " Contact your center to complete it." };
}
