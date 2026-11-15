/**
 * Aprobacion de un escaneo cotizado por el centro. Sin React.
 *
 * Contrato real (backend 348c327, src/controllers/client/mailItems/approveScan.js):
 *   POST /client/service-requests/:id/approve-scan   (sin cuerpo)
 *     Solo para SCAN en AWAITING_CLIENT_APPROVAL (el centro cotizo sin el
 *     consentimiento de cobro del cliente). Aprobar ES consentir el cobro.
 *   200 { approved: true, serviceRequest { status: "COMPLETED" }, payment, billingItemsCreated }
 *   402 { error: "Payment failed", reason, pending: true, invoiceId, invoiceUrl }
 *       el cobro no se confirmo: la solicitud pasa a IN_PROGRESS (pendiente de
 *       pago) y el consentimiento queda guardado. Stripe trae el `invoiceUrl`
 *       de su factura; Zoho no (se paga la factura SCAN desde Facturacion).
 *   402 { code: "BILLING_REQUIRED" }   cuenta retenida por impago.
 *   409 { error: "Conflict", reason, code? }  p. ej. SCAN_QUOTE_OUTDATED, ya no
 *       esta esperando aprobacion, o el centro no cobra en linea.
 *   404 / 400.
 *
 * NO es idempotente: una segunda llamada responde 409 (la solicitud ya no esta
 * en AWAITING_CLIENT_APPROVAL). Por eso nunca se repite sola: tras un fallo de
 * red se relee la pieza y el cliente decide viendo el estado real.
 */

import { billingHold, PROVIDER_STRIPE, PROVIDER_ZOHO, serviceAllowed } from "./capabilities.js";
import { isSecurePageUrl, isValidZohoInvoiceId } from "./zoho-billing.js";
import { centsOrNull } from "./forward-payment.js";

export const SCAN_AWAITING_APPROVAL = "AWAITING_CLIENT_APPROVAL";

export function approveScanPath(serviceRequestId) {
  return "/client/service-requests/" + encodeURIComponent(String(serviceRequestId)) + "/approve-scan";
}

/** El escaneo de esta pieza que espera la aprobacion del cliente, o null. */
export function findScanAwaitingApproval(serviceRequests) {
  return (Array.isArray(serviceRequests) ? serviceRequests : []).find(
    (request) => request?.type === "SCAN" && request?.status === SCAN_AWAITING_APPROVAL
  ) || null;
}

/** Lo que el cliente aprueba: paginas e importe tal como los cotizo el centro. */
export function scanQuote(request) {
  const details = request?.scanDetails || {};
  // Number(null) es 0: sin centsOrNull, una cotizacion sin importe pareceria gratis.
  const cents = centsOrNull;
  return {
    pageCount: cents(details.pageCount),
    includedPages: cents(details.includedPages),
    extraPages: cents(details.extraPages),
    amountCents: cents(details.quotedAmountCents),
    notes: typeof details.quoteNotes === "string" && details.quoteNotes.trim() ? details.quoteNotes.trim() : null,
    quotedAt: details.quotedAt || null,
  };
}

/**
 * Si se ofrece "Approve" para este escaneo, con /client/capabilities.
 *   available     se puede aprobar (con o sin cargo).
 *   unknown       no hay capacidades: no se ofrece (desconocido no es habilitado).
 *   billing-hold  cuenta retenida: primero Facturacion.
 *   unavailable   el centro no cobra escaneos en linea (services.paidScans
 *                 false) y el escaneo tiene cargo: el backend daria 409.
 *   incomplete    la cotizacion no tiene importe o paginas (el backend daria 409).
 */
export function scanApprovalAvailability(request, capabilities) {
  const quote = scanQuote(request);
  if (!request || request.status !== SCAN_AWAITING_APPROVAL) return { state: "none", quote };
  if (!quote.pageCount || quote.pageCount <= 0 || quote.amountCents === null) return { state: "incomplete", quote };
  if (!capabilities?.known) return { state: "unknown", quote };

  const hold = billingHold(capabilities);
  if (hold) return { state: "billing-hold", quote, reason: hold.reason };

  if (quote.amountCents > 0) {
    const provider = capabilities.provider;
    if (provider !== PROVIDER_STRIPE && provider !== PROVIDER_ZOHO) return { state: "unknown", quote };
    // paidScans es la misma puerta (scan.charge) con la que el backend decide.
    const paid = serviceAllowed(capabilities, "paidScans");
    if (paid === null) return { state: "unknown", quote };
    if (paid === false) return { state: "unavailable", quote };
    return { state: "available", quote, provider, charge: true };
  }

  return { state: "available", quote, provider: capabilities.provider, charge: false };
}

/**
 * Que hacer con un error de approve-scan. `provider` decide a donde se manda a
 * resolver un pago: Stripe a su factura (invoiceUrl https), Zoho a Facturacion
 * (la factura SCAN aparece alli como pagable). Nunca se reintenta solo.
 */
export function approveScanError(error, provider) {
  if (!error?.response) {
    return {
      kind: "unknown-outcome",
      message: "We couldn't confirm whether the scan was approved. We'll refresh the item; check it before approving again.",
      refresh: true,
    };
  }

  const { status, data } = error.response;
  const code = data?.code;
  // El proveedor que dice el backend en el 402 manda sobre el de las capacidades.
  const payProvider = data?.provider === PROVIDER_ZOHO || data?.provider === PROVIDER_STRIPE ? data.provider : provider;

  if (status === 402 && code === "BILLING_REQUIRED") {
    return { kind: "billing-required", message: data.error || "Your account has a billing issue.", route: "/billing", refresh: true };
  }

  // 402 SCAN_PAYMENT_PENDING (backend nuevo) o { pending: true } (anterior).
  if (status === 402 && (code === "SCAN_PAYMENT_PENDING" || data?.pending === true)) {
    const paymentState = typeof data?.paymentState === "string" ? data.paymentState : null;
    const base = {
      kind: "payment-pending",
      refresh: true,
      paymentState,
      message: "The scan was approved, but the payment didn't go through. Your mail is safe; the scan is delivered once it's paid.",
    };
    // Zoho no confirmo nada: no se ofrece pagar (podria cobrarse dos veces). Se comprueba mas tarde.
    if (paymentState === "UNCERTAIN") {
      return { ...base, action: "check", message: "We couldn't confirm the scan payment yet. Nothing new was charged; we'll check it again." };
    }
    if (paymentState === "NEEDS_REVIEW") {
      return { ...base, action: "contact", message: "Your center is reviewing the scan payment. Please don't pay again; contact your center." };
    }
    if (payProvider === PROVIDER_ZOHO) {
      // Con la factura concreta de Zoho (si el backend la da y se puede pagar), a esa factura.
      const invoice = data?.zohoInvoice;
      if (invoice?.payable === true && isValidZohoInvoiceId(invoice.invoiceId)) {
        return { ...base, action: "zoho-invoice", invoiceId: String(invoice.invoiceId), invoiceNumber: invoice.number || null, actionLabel: "Pay invoice" };
      }
      return { ...base, action: "billing", route: "/billing", actionLabel: "Go to Billing" };
    }
    if (payProvider === PROVIDER_STRIPE && isSecurePageUrl(data.invoiceUrl)) {
      return { ...base, action: "invoice", url: data.invoiceUrl.trim(), actionLabel: "Pay invoice" };
    }
    return { ...base, action: "contact", message: base.message + " Contact your center to complete the payment." };
  }

  if (status === 409) {
    // Codigos estables del backend nuevo; el texto de `reason` solo como respaldo (backend anterior).
    switch (code) {
      case "SCAN_QUOTE_OUTDATED":
        return { kind: "quote-outdated", refresh: true, message: "The scan quote is out of date. Your center has to quote it again." };
      case "SCAN_QUOTE_INCOMPLETE":
        return { kind: "quote-incomplete", refresh: true, message: "Your center hasn't finished quoting this scan yet." };
      case "ONLINE_PAYMENTS_UNAVAILABLE":
        return { kind: "unavailable", refresh: true, message: "Paid scans can't be approved online for your account. Please contact your center." };
      case "SERVICE_REQUEST_NOT_AWAITING_APPROVAL":
        return { kind: "state-changed", refresh: true, serviceRequestStatus: data?.serviceRequestStatus || null, message: "This scan request was already handled. We'll refresh it." };
      case "SCAN_NOT_AVAILABLE_FOR_PACKAGE":
        return { kind: "not-scannable", refresh: true, message: "Packages can't be scanned." };
      case "CLIENT_PROFILE_NOT_FOUND":
        return { kind: "account-incomplete", refresh: true, message: "Your account isn't fully set up. Please contact your center." };
      default:
        break;
    }
    if (/online payments are not available/i.test(String(data?.reason || ""))) {
      return { kind: "unavailable", refresh: true, message: "Paid scans can't be approved online for your account. Please contact your center." };
    }
    return { kind: "state-changed", refresh: true, message: "This scan request changed. We'll refresh it." };
  }

  if (status === 404) return { kind: "not-found", refresh: true, message: "We couldn't find this scan request. Pull down to refresh." };
  if (status >= 500) {
    return { kind: "temporary", refresh: true, message: "We couldn't approve the scan right now. Check the item before trying again." };
  }
  return { kind: "error", refresh: true, message: (typeof data?.error === "string" && data.error) || "Unable to approve the scan." };
}

/** El 200 de approve-scan: aprobado (y pagado, o sin cargo). */
export function interpretApproveScan(data) {
  return {
    approved: data?.approved === true,
    completed: data?.serviceRequest?.status === "COMPLETED",
    paidAmountCents: Number.isFinite(Number(data?.payment?.quotedAmountCents)) ? Number(data.payment.quotedAmountCents) : null,
  };
}
