/**
 * Facturacion de un centro que cobra con Zoho (HDG). Sin React.
 *
 * Contrato (backend 348c327; handoff HDG B.1/B.2; capacidades-y-health §3):
 *   - GET /client/billing/payment -> `zoho { cards, invoices, payments, actions }`
 *     o `zohoUnavailable` (lee Zoho en el momento).
 *   - POST /client/billing/zoho/update-card          -> { provider, url, expiresAt }
 *   - POST /client/billing/zoho/add-payment-method   -> { provider, url, expiresAt }
 *   - POST /client/billing/zoho/invoices/:id/pay     -> { provider, paymentUrl, expiresAt, invoice }
 *
 * Las tres abren una pagina segura de Zoho en el navegador del sistema. La
 * vuelta va al portal web, no a la app, y NO confirma nada: al volver solo se
 * relee billing/payment. La app nunca ve datos de tarjeta: last4 y caducidad.
 */

import { isSecureHttpsUrl } from "./secure-url.js";

export const ZOHO_UPDATE_CARD_PATH = "/client/billing/zoho/update-card";
export const ZOHO_ADD_PAYMENT_METHOD_PATH = "/client/billing/zoho/add-payment-method";

/** El backend exige ^\d{1,30}$; se comprueba antes de componer la ruta. */
export function isValidZohoInvoiceId(invoiceId) {
  return /^\d{1,30}$/.test(String(invoiceId ?? ""));
}

export function zohoInvoicePayPath(invoiceId) {
  if (!isValidZohoInvoiceId(invoiceId)) throw new Error("Invalid invoice id");
  return "/client/billing/zoho/invoices/" + invoiceId + "/pay";
}

/** Solo una URL https sin credenciales: lo que el backend devuelve de Zoho (lib/secure-url). */
export const isSecurePageUrl = isSecureHttpsUrl;

/**
 * La URL de la pagina segura de una respuesta de Zoho. update-card y
 * add-payment-method la llaman `url`; invoices/:id/pay, `paymentUrl` (el web
 * lee `paymentUrl || url`). null si no es una https valida.
 */
export function zohoPageUrl(data) {
  const url = data?.paymentUrl || data?.url;
  return isSecurePageUrl(url) ? url.trim() : null;
}

// ── Facturas ────────────────────────────────────────────────────────────────

const POSITIVE = { container: "border-emerald-200 bg-emerald-100", label: "text-emerald-800" };
const NEGATIVE = { container: "border-rose-200 bg-rose-100", label: "text-rose-800" };
const WAITING = { container: "border-amber-200 bg-amber-100", label: "text-amber-800" };
const NEUTRAL = { container: "border-slate-200 bg-slate-100", label: "text-slate-800" };

/** Estados de factura de Zoho tal como llegan (texto de Zoho). */
const INVOICE_STATUS = {
  paid: { label: "Paid", tone: POSITIVE },
  sent: { label: "Due", tone: WAITING },
  unpaid: { label: "Unpaid", tone: WAITING },
  partially_paid: { label: "Partially paid", tone: WAITING },
  overdue: { label: "Overdue", tone: NEGATIVE },
  void: { label: "Void", tone: NEUTRAL },
  draft: { label: "Draft", tone: NEUTRAL },
};

export function zohoInvoiceStatus(status) {
  const key = String(status || "").trim().toLowerCase();
  if (INVOICE_STATUS[key]) return { key, ...INVOICE_STATUS[key] };
  const label = key ? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "Unknown";
  return { key, label, tone: NEUTRAL };
}

const KIND_LABELS = { MEMBERSHIP: "Membership", SCAN: "Scan", STORAGE: "Storage", FORWARDING: "Forwarding" };

export function zohoInvoiceKindLabel(kind) {
  return KIND_LABELS[kind] || "Invoice";
}

/**
 * Si se ofrece "Pay" en una factura: el backend la marca `payable` (estado
 * abierto, saldo > 0 y no FORWARDING) y el centro deja pagar facturas. Las de
 * reenvio se pagan desde la pieza (409 PAY_FORWARDING_FROM_MAIL_ITEM).
 */
export function canPayZohoInvoice(invoice, actions) {
  return Boolean(
    invoice?.payable === true &&
      invoice.kind !== "FORWARDING" &&
      actions?.payInvoices === true &&
      isValidZohoInvoiceId(invoice.invoiceId)
  );
}

/** Facturas abiertas primero (las que se pueden pagar), luego por fecha, mas nuevas antes. */
export function sortZohoInvoices(invoices) {
  return [...(Array.isArray(invoices) ? invoices : [])].sort((a, b) => {
    const openA = a?.payable === true ? 0 : 1;
    const openB = b?.payable === true ? 0 : 1;
    if (openA !== openB) return openA - openB;
    return String(b?.date || "").localeCompare(String(a?.date || ""));
  });
}

// ── Errores ─────────────────────────────────────────────────────────────────

const ERROR_MESSAGES = {
  ZOHO_PAYMENT_PAGE_UNAVAILABLE: "The secure payment page is not available right now. Please try again in a few minutes.",
  INVOICE_NOT_PAYABLE: "This invoice can no longer be paid. Pull down to refresh it.",
  PAY_FORWARDING_FROM_MAIL_ITEM: "Shipping invoices are paid from the mail item.",
  INVOICE_NOT_FOUND: "We could not find that invoice. Pull down to refresh.",
  ZOHO_SUBSCRIPTION_NOT_LINKED: "Your card can't be updated online yet. Please contact your center.",
  ZOHO_SUBSCRIPTION_MISMATCH: "Your card can't be updated online right now. Please contact your center.",
  ZOHO_SUBSCRIPTION_INACTIVE: "Your membership isn't active, so the card can't be updated online. Please contact your center.",
  ZOHO_CUSTOMER_NOT_LINKED: "Online billing isn't set up for your account yet. Please contact your center.",
  ZOHO_ACCOUNT_NOT_CONFIGURED: "Online billing isn't available for your center right now.",
  ZOHO_ENVIRONMENT_NOT_ENABLED: "Online billing isn't available for your center right now.",
  BILLING_PROVIDER_NOT_ZOHO: "Online billing isn't available for your account.",
};

/** Mensaje para el cliente de un error de las paginas de Zoho; nunca el texto tecnico de Zoho. */
export function zohoBillingErrorMessage(error) {
  if (!error?.response) return "We couldn't reach the server. Check your connection and try again.";
  const code = error.response.data?.code;
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (error.response.status === 400) return "That invoice can't be paid from the app.";
  return "We couldn't open the secure payment page. Please try again.";
}
