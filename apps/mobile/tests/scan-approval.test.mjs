import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AxiosError } from "axios";

import { configureStorage, createApiClient, setTokens } from "@paqueteria/core";
import { deriveCapabilities } from "../src/lib/capabilities.js";
import {
  approveScanError,
  approveScanPath,
  findScanAwaitingApproval,
  interpretApproveScan,
  scanApprovalAvailability,
  scanQuote,
} from "../src/lib/scan-approval.js";
import { routeForNotification } from "../src/lib/notification-routing.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// ── Datos con la forma real (selects.js: scanDetails; contrato v1 de capacidades) ──

const scan = (over = {}) => ({
  id: "cm-scan-request-1",
  type: "SCAN",
  status: "AWAITING_CLIENT_APPROVAL",
  scanDetails: { pageCount: 12, includedPages: 10, extraPages: 2, quotedAmountCents: 200, quoteNotes: "2 extra pages", quotedAt: "2026-11-14T10:00:00.000Z", approvedAt: null, paidAt: null },
  ...over,
});

const caps = ({ provider = "STRIPE", paidScans = true, hold = false, tenant = provider === "ZOHO" ? "hdg" : "the_worx" } = {}) =>
  deriveCapabilities({
    expectedTenantSlug: tenant,
    capabilities: {
      contractVersion: 1,
      environment: provider === "ZOHO" ? "sandbox" : "production",
      tenant: { slug: tenant, name: tenant },
      center: { slug: "c", displayName: "C" },
      billing: { provider, onlinePayments: provider === "STRIPE", billingPortal: provider === "STRIPE", invoices: provider === "STRIPE", paymentMethodManagement: provider === "STRIPE" ? "STRIPE_PORTAL" : "ZOHO_HOSTED", zoho: provider === "ZOHO" ? { available: true, unavailableReason: null, payInvoices: true, updateCard: true, addPaymentMethod: true } : null },
      forwarding: { available: true, payments: true, checkout: provider === "ZOHO" ? "HOSTED" : "EMBEDDED", methods: provider === "ZOHO" ? ["HOSTED_PAGE", "SAVED_CARD"] : ["PAYMENT_INTENT", "CHECKOUT_SESSION"], returnDetection: null, paymentStatusMinPollSeconds: provider === "ZOHO" ? 15 : null },
      services: { forwarding: true, immediateForwarding: true, scheduledForwarding: true, storageFees: true, paidScans, autoScan: true, planChange: provider === "STRIPE", cancellationRequest: true },
      restrictions: { billingHold: hold ? { active: true, code: "BILLING_REQUIRED", reason: "Your subscription is past due." } : { active: false, code: null, reason: null }, mailboxActive: true, uspsComplianceStatus: "APPROVED", accountClosureScheduledAt: null, accountDeletionInProgress: false },
    },
  });

const err = (status, data) => ({ response: { status, data } });

// ── Que escaneo y que cotizacion ────────────────────────────────────────────

test("solo un SCAN en AWAITING_CLIENT_APPROVAL se ofrece para aprobar", () => {
  assert.equal(findScanAwaitingApproval([scan({ status: "OPEN" }), scan()]).status, "AWAITING_CLIENT_APPROVAL");
  assert.equal(findScanAwaitingApproval([scan({ status: "COMPLETED" }), scan({ type: "FORWARD" })]), null);
  assert.equal(findScanAwaitingApproval(undefined), null);
  assert.equal(approveScanPath("cm-scan-request-1"), "/client/service-requests/cm-scan-request-1/approve-scan");
});

test("la cotizacion que se aprueba es la del centro, tal cual", () => {
  assert.deepEqual(scanQuote(scan()), { pageCount: 12, includedPages: 10, extraPages: 2, amountCents: 200, notes: "2 extra pages", quotedAt: "2026-11-14T10:00:00.000Z" });
});

// ── Capacidades: cuando se ofrece "Approve" ─────────────────────────────────

test("Stripe con cargo: se ofrece aprobar y pagar", () => {
  const a = scanApprovalAvailability(scan(), caps());
  assert.equal(a.state, "available");
  assert.equal(a.charge, true);
  assert.equal(a.provider, "STRIPE");
});

test("sin cargo (incluido en el plan): se aprueba sin pago", () => {
  const a = scanApprovalAvailability(scan({ scanDetails: { ...scan().scanDetails, quotedAmountCents: 0, extraPages: 0 } }), caps({ paidScans: false }));
  assert.equal(a.state, "available");
  assert.equal(a.charge, false, "paidScans solo importa si hay cargo");
});

test("Zoho con el cobro de escaneos apagado (paidScans false) y cargo: no se ofrece", () => {
  assert.equal(scanApprovalAvailability(scan(), caps({ provider: "ZOHO", paidScans: false })).state, "unavailable");
  assert.equal(scanApprovalAvailability(scan(), caps({ provider: "ZOHO", paidScans: true })).state, "available");
});

test("desconocido no es habilitado: sin capacidades no hay boton", () => {
  assert.equal(scanApprovalAvailability(scan(), deriveCapabilities({})).state, "unknown");
  // Capacidades de otra organizacion: tampoco.
  const foreign = deriveCapabilities({ capabilities: { contractVersion: 1, tenant: { slug: "the_worx" }, billing: { provider: "STRIPE" }, services: { paidScans: true } }, expectedTenantSlug: "hdg" });
  assert.equal(scanApprovalAvailability(scan(), foreign).state, "unknown");
});

test("retencion por impago: primero Facturacion", () => {
  const a = scanApprovalAvailability(scan(), caps({ hold: true }));
  assert.equal(a.state, "billing-hold");
  assert.equal(a.reason, "Your subscription is past due.");
});

test("cotizacion incompleta (sin paginas o sin importe): no se aprueba", () => {
  assert.equal(scanApprovalAvailability(scan({ scanDetails: { pageCount: 0, quotedAmountCents: 200 } }), caps()).state, "incomplete");
  assert.equal(scanApprovalAvailability(scan({ scanDetails: { pageCount: 3, quotedAmountCents: null } }), caps()).state, "incomplete");
  assert.equal(scanApprovalAvailability(scan({ status: "COMPLETED" }), caps()).state, "none");
});

// ── Resultados de approve-scan ──────────────────────────────────────────────

test("escaneo aprobado (200)", () => {
  const data = { approved: true, serviceRequest: { id: "x", type: "SCAN", status: "COMPLETED" }, payment: { paidAt: "2026-11-15T00:00:00.000Z", quotedAmountCents: 200, stripeInvoiceId: "in_x" }, billingItemsCreated: 1 };
  assert.deepEqual(interpretApproveScan(data), { approved: true, completed: true, paidAmountCents: 200 });
});

test("pago fallido o pendiente con Stripe: a la factura de Stripe (https)", () => {
  const e = err(402, { error: "Payment failed", reason: "Your card was declined.", pending: true, invoiceId: "in_1", invoiceUrl: "https://invoice.stripe.com/i/acct_x/test_1" });
  const o = approveScanError(e, "STRIPE");
  assert.equal(o.kind, "payment-pending");
  assert.equal(o.action, "invoice");
  assert.equal(o.url, "https://invoice.stripe.com/i/acct_x/test_1");
});

test("pago fallido con Zoho: a Facturacion (Zoho Billing), nunca a Stripe", () => {
  const e = err(402, { error: "Payment failed", reason: "Zoho did not confirm payment.", pending: true, invoiceId: null, invoiceUrl: null });
  const o = approveScanError(e, "ZOHO");
  assert.equal(o.kind, "payment-pending");
  assert.equal(o.action, "billing");
  assert.equal(o.route, "/billing");
  assert.equal(o.url, undefined);
  // Aunque llegara una URL, con Zoho no se abre: se paga la factura SCAN en Facturacion.
  assert.equal(approveScanError(err(402, { pending: true, invoiceUrl: "https://invoice.stripe.com/x" }), "ZOHO").action, "billing");
});

test("Stripe sin invoiceUrl valida: contactar con el centro (no se abre nada inseguro)", () => {
  assert.equal(approveScanError(err(402, { pending: true, invoiceUrl: "http://x" }), "STRIPE").action, "contact");
  assert.equal(approveScanError(err(402, { pending: true, invoiceUrl: null }), "STRIPE").action, "contact");
});

test("pago requerido (402 BILLING_REQUIRED): a Facturacion", () => {
  const o = approveScanError(err(402, { error: "Your subscription is past due.", code: "BILLING_REQUIRED" }), "STRIPE");
  assert.equal(o.kind, "billing-required");
  assert.equal(o.route, "/billing");
});

test("409: cotizacion caducada, pagos no disponibles o estado cambiado (doble aprobacion)", () => {
  assert.equal(approveScanError(err(409, { error: "Conflict", reason: "x", code: "SCAN_QUOTE_OUTDATED" }), "STRIPE").kind, "quote-outdated");
  assert.equal(approveScanError(err(409, { error: "Conflict", reason: "Online payments are not available for this account. Please contact your center." }), "ZOHO").kind, "unavailable");
  assert.equal(approveScanError(err(409, { error: "Conflict", reason: "Service request is IN_PROGRESS" }), "STRIPE").kind, "state-changed");
});

test("errores de servicio y de red: se relee la pieza, no se reintenta", () => {
  for (const o of [
    approveScanError(new AxiosError("timeout", "ECONNABORTED"), "STRIPE"),
    approveScanError(err(503, "<html>"), "STRIPE"),
    approveScanError(err(500, { error: "Internal server error" }), "ZOHO"),
    approveScanError(err(404, { error: "Service request not found" }), "STRIPE"),
  ]) {
    assert.equal(o.refresh, true);
    assert.equal(o.action, undefined, "nada de volver a aprobar solo");
  }
  assert.equal(approveScanError(new AxiosError("Network Error", "ERR_NETWORK"), "STRIPE").kind, "unknown-outcome");
});

test("approve-scan que agota el timeout se envia una sola vez", async () => {
  const data = new Map();
  const store = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
  configureStorage({ ...store, secure: store });
  await setTokens({ accessToken: "a", refreshToken: "r" });
  let posts = 0;
  const api = createApiClient({
    baseURL: "https://core.theworxoffices.com/api/v1",
    adapter: (config) => {
      posts++;
      return Promise.reject(new AxiosError("timeout", "ECONNABORTED", config, {}));
    },
  });
  await assert.rejects(api.post(approveScanPath("cm-scan-request-1")));
  assert.equal(posts, 1);
});

// ── Cableado ────────────────────────────────────────────────────────────────

test("la tarjeta: pregunta con el importe, candado, sin reintentos, y refresca todo", () => {
  const card = read("src/components/common/scan-approval-card.jsx");
  assert.match(card, /scanApprovalAvailability\(request, capabilities\)/);
  assert.match(card, /Alert\.alert\(\s*"Approve and pay"/);
  assert.match(card, /lock\.run\(\(\) => approve\.mutateAsync\(\)/);
  assert.doesNotMatch(card, /\bretry\s*:/);
  assert.doesNotMatch(card, /useEffect\(/, "nada se aprueba solo");
  assert.match(card, /approveScanError\(error, capabilities\.provider\)/);
  for (const key of ['"client-mail-items"', "BILLING_PAYMENT_QUERY_KEY", '"client-payment-alerts"', '"client-billing-usage"']) {
    assert.ok(card.includes(key), key);
  }
  assert.match(card, /notifyCapabilitiesStale\("scan-approval"\)/);
  assert.match(card, /router\.navigate\("\/billing"\)/);
});

test("la pieza enseña la aprobacion del escaneo y el aviso lleva a la pieza", () => {
  const detail = read("src/app/(client)/mail-items/[id].jsx");
  assert.match(detail, /findScanAwaitingApproval\(serviceRequests\)/);
  assert.match(detail, /<ScanApprovalCard request=\{scanApprovalRequest\}/);
  assert.deepEqual(routeForNotification({ type: "SCAN_APPROVAL_REQUIRED", notificationId: "n1", mailItemId: "m1", serviceRequestId: "s1" }), {
    pathname: "/mail-items/[id]",
    params: { id: "m1" },
  });
});
