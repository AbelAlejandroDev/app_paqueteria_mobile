import test from "node:test";
import assert from "node:assert/strict";
import { AxiosError } from "axios";

import { configureStorage, createApiClient, setTokens } from "@paqueteria/core";
import { createSingleFlight, createStatusPoller, forwardPaymentError, interpretPaymentStatus } from "../src/lib/forward-payment.js";
import {
  ACTION_NONE,
  ACTION_PAY,
  ACTION_RESUME,
  busyDeadline,
  expiresAtMs,
  interpretCheckoutSession,
  isAttemptAwareStatus,
  isStillBusy,
  retryAfterSeconds,
  stripePaymentDecision,
} from "../src/lib/stripe-payment-guard.js";
import { startStripeCheckout } from "../src/lib/stripe-checkout-flow.js";
import { interpretScanPayment, isScanPaymentUnsupported, scanPaymentPath, shouldTrackScanPayment } from "../src/lib/scan-payment.js";
import { approveScanError } from "../src/lib/scan-approval.js";

// ── Respuestas reales (backend fix/stripe-forwarding-double-charge, 7b52ccd) ──

const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 60 * 1000).toISOString();

const newStatus = (over = {}) => ({
  provider: "STRIPE",
  paymentStatus: "READY_FOR_PAYMENT",
  shipmentStatus: "NOT_CREATED",
  attempt: null,
  canStartNewPayment: true,
  needsReview: false,
  reconciled: false,
  uncertain: false,
  ...over,
});
const attempt = (state, over = {}) => ({ state, checkout: "CHECKOUT_SESSION", amount: 1450, currency: "USD", expiresAt: future, ...over });
// El backend desplegado hoy (348c327).
const oldStatus = (paymentStatus) => ({ provider: "STRIPE", paymentStatus, shipmentStatus: "NOT_CREATED" });

const err = (status, data, headers = {}) => ({ response: { status, data, headers } });

// ── Decision: cuando se puede pagar ─────────────────────────────────────────

test("contrato nuevo: se paga solo con canStartNewPayment", () => {
  assert.equal(isAttemptAwareStatus(newStatus()), true);
  assert.equal(stripePaymentDecision(newStatus()).action, ACTION_PAY);
  assert.equal(stripePaymentDecision(newStatus({ canStartNewPayment: false })).action, ACTION_NONE);
});

test("pago pendiente (PROCESSING / CREATING): no se inicia otro, se comprueba", () => {
  for (const state of ["PROCESSING", "CREATING"]) {
    const d = stripePaymentDecision(newStatus({ paymentStatus: "PAYMENT_PENDING", attempt: attempt(state), canStartNewPayment: false }));
    assert.equal(d.action, ACTION_NONE, state);
    assert.equal(d.reason, "processing", state);
    assert.equal(d.checkStatus, true, state);
  }
});

test("pago incierto (uncertain): no se inicia nada", () => {
  const d = stripePaymentDecision(newStatus({ paymentStatus: "PAYMENT_PENDING", attempt: attempt("OPEN"), uncertain: true, canStartNewPayment: false }));
  assert.equal(d.action, ACTION_NONE);
  assert.equal(d.reason, "uncertain");
  assert.equal(interpretPaymentStatus(newStatus({ uncertain: true })).terminal, false, "se sigue comprobando");
});

test("pago en revision (needsReview / NEEDS_REVIEW): no se paga, se avisa del centro", () => {
  for (const status of [newStatus({ needsReview: true, canStartNewPayment: false }), newStatus({ attempt: attempt("NEEDS_REVIEW"), canStartNewPayment: false })]) {
    const d = stripePaymentDecision(status);
    assert.equal(d.action, ACTION_NONE);
    assert.equal(d.reason, "review");
    assert.equal(d.contactCenter, true);
    assert.equal(interpretPaymentStatus(status).state, "review");
  }
});

test("pagado antes del webhook: payment-status ya concilio y dice PAID", () => {
  const status = newStatus({ paymentStatus: "PAID", attempt: attempt("SUCCEEDED"), canStartNewPayment: false, reconciled: true });
  const d = stripePaymentDecision(status);
  assert.equal(d.action, ACTION_NONE);
  assert.equal(d.paid, true);
  assert.equal(interpretPaymentStatus(status).state, "paid");
});

test("sesion abierta: se continua la misma (no es un pago nuevo)", () => {
  const d = stripePaymentDecision(newStatus({ paymentStatus: "PAYMENT_PENDING", attempt: attempt("OPEN"), canStartNewPayment: false }));
  assert.equal(d.action, ACTION_RESUME);
  // Si la sesion ya caduco, no se ofrece continuarla.
  assert.equal(stripePaymentDecision(newStatus({ attempt: attempt("OPEN", { expiresAt: past }), canStartNewPayment: false })).action, ACTION_NONE);
  // Un PaymentIntent abierto (no Checkout) no se "continua" desde la app.
  assert.equal(stripePaymentDecision(newStatus({ attempt: attempt("OPEN", { checkout: "PAYMENT_INTENT" }), canStartNewPayment: false })).action, ACTION_NONE);
});

test("checkout expirado: el backend lo cierra y deja pagar de nuevo", () => {
  const status = newStatus({ attempt: attempt("EXPIRED", { expiresAt: past }), canStartNewPayment: true });
  assert.equal(interpretPaymentStatus(status).state, "expired");
  assert.equal(interpretPaymentStatus(status).terminal, true);
  assert.equal(stripePaymentDecision(status).action, ACTION_PAY);
});

test("pagado, cancelado o reembolsado: nada que pagar", () => {
  for (const paymentStatus of ["PAID", "CANCELLED", "REFUNDED"]) {
    assert.equal(stripePaymentDecision(newStatus({ paymentStatus, canStartNewPayment: false })).action, ACTION_NONE, paymentStatus);
    assert.equal(stripePaymentDecision(oldStatus(paymentStatus)).action, ACTION_NONE, paymentStatus);
  }
});

test("conflicto local/servidor: la pieza dice PAID y el servidor no -> no se paga", () => {
  const d = stripePaymentDecision(newStatus(), { localPaymentStatus: "PAID" });
  assert.equal(d.action, ACTION_NONE);
  assert.equal(d.reason, "conflict");
});

test("sin estado (o con uno raro) no se paga", () => {
  assert.equal(stripePaymentDecision(null).action, ACTION_NONE);
  assert.equal(stripePaymentDecision("x").action, ACTION_NONE);
  assert.equal(stripePaymentDecision(newStatus({ paymentStatus: "SOMETHING_NEW", canStartNewPayment: false })).action, ACTION_NONE);
});

// ── Compatibilidad con el backend desplegado (sin la correccion) ────────────

test("backend anterior: PAYMENT_PENDING es ambiguo -> bloqueado, comprobar o contactar con el centro", () => {
  const d = stripePaymentDecision(oldStatus("PAYMENT_PENDING"));
  assert.equal(isAttemptAwareStatus(oldStatus("PAYMENT_PENDING")), false);
  assert.equal(d.action, ACTION_NONE);
  assert.equal(d.reason, "pending-legacy");
  assert.equal(d.checkStatus, true);
  assert.equal(d.contactCenter, true);
});

test("backend anterior: listo, fallido o con verificacion del banco -> se puede pagar", () => {
  for (const paymentStatus of ["NOT_STARTED", "READY_FOR_PAYMENT", "FAILED", "AUTHENTICATION_REQUIRED"]) {
    assert.equal(stripePaymentDecision(oldStatus(paymentStatus)).action, ACTION_PAY, paymentStatus);
  }
});

// ── Checkout Session: 200 / 201, paymentIntentId null, expiresAt ────────────

test("201 sesion nueva y 200 la misma (reused); paymentIntentId null no importa", () => {
  const created = interpretCheckoutSession({ status: 201, data: { success: true, url: "https://checkout.stripe.com/c/pay/cs_test_1", sessionId: "cs_test_1", paymentIntentId: null, amount: 1450, currency: "USD", expiresAt: Math.floor(Date.now() / 1000) + 1800, reused: false } });
  assert.equal(created.created, true);
  assert.equal(created.reused, false);
  assert.equal(created.url, "https://checkout.stripe.com/c/pay/cs_test_1");
  assert.equal(created.expired, false);

  const reused = interpretCheckoutSession({ status: 200, data: { success: true, url: "https://checkout.stripe.com/c/pay/cs_test_1", sessionId: "cs_test_1", paymentIntentId: null, reused: true, expiresAt: Math.floor(Date.now() / 1000) + 1800 } });
  assert.equal(reused.reused, true);
  assert.equal(reused.created, false);
});

test("una sesion caducada (expiresAt en segundos Unix, de Stripe) no se abre; una URL que no es https tampoco", () => {
  const expired = interpretCheckoutSession({ status: 200, data: { url: "https://checkout.stripe.com/x", reused: true, expiresAt: Math.floor(Date.now() / 1000) - 10 } });
  assert.equal(expired.expired, true);
  assert.equal(interpretCheckoutSession({ status: 201, data: { url: "http://checkout.stripe.com/x" } }).url, null);
  assert.equal(expiresAtMs(1_700_000_000), 1_700_000_000_000, "segundos -> ms");
  assert.equal(expiresAtMs("2026-11-15T12:00:00.000Z"), Date.parse("2026-11-15T12:00:00.000Z"));
  assert.equal(expiresAtMs(null), null);
});

// ── Errores 409 y 503, Retry-After ──────────────────────────────────────────

test("409 FORWARDING_PAYMENT_BUSY: espera retryAfterSeconds (o la cabecera Retry-After)", () => {
  const body = forwardPaymentError(err(409, { error: "x", code: "FORWARDING_PAYMENT_BUSY", retryAfterSeconds: 3, charged: false }, { "retry-after": "3" }));
  assert.equal(body.kind, "busy");
  assert.equal(body.retryAfterSeconds, 3);
  assert.equal(body.charged, false);
  assert.equal(forwardPaymentError(err(409, { code: "FORWARDING_PAYMENT_BUSY" }, { "retry-after": "7" })).retryAfterSeconds, 7);
  assert.equal(forwardPaymentError(err(409, { code: "FORWARDING_PAYMENT_BUSY" })).retryAfterSeconds, 3, "por defecto 3 s");
});

test("Retry-After: segundos, fecha HTTP, tope de 5 min, y sin cabecera", () => {
  const now = Date.parse("2026-11-15T12:00:00.000Z");
  assert.equal(retryAfterSeconds(err(409, {}, { "retry-after": "10" }), now), 10);
  assert.equal(retryAfterSeconds(err(409, {}, { "retry-after": "Sun, 15 Nov 2026 12:00:20 GMT" }), now), 20);
  assert.equal(retryAfterSeconds(err(409, { retryAfterSeconds: 9999 })), 300);
  assert.equal(retryAfterSeconds(err(409, {})), null);
  assert.equal(retryAfterSeconds(err(409, {}, { get: (k) => (k === "retry-after" ? "4" : undefined) })), 4, "cabeceras de axios");
});

test("409 PROCESSING, 503 UNCERTAIN y 409 NEEDS_REVIEW: nunca otro pago", () => {
  const processing = forwardPaymentError(err(409, { code: "FORWARDING_PAYMENT_PROCESSING", charged: false }));
  assert.equal(processing.kind, "processing");
  assert.equal(processing.retryable, false);
  assert.equal(processing.checkStatus, true);

  const uncertain = forwardPaymentError(err(503, { code: "FORWARDING_PAYMENT_UNCERTAIN", charged: null }));
  assert.equal(uncertain.kind, "unknown-outcome");
  assert.equal(uncertain.retryable, false);
  assert.equal(uncertain.charged, null);
  assert.equal(uncertain.checkStatus, true);

  const review = forwardPaymentError(err(409, { code: "FORWARDING_PAYMENT_NEEDS_REVIEW", charged: false }));
  assert.equal(review.kind, "review");
  assert.equal(review.retryable, false);

  assert.equal(forwardPaymentError(err(409, { code: "FORWARDING_ALREADY_PAID", charged: false })).kind, "paid");
});

test("BUSY: el boton espera el plazo (sin reintento automatico)", () => {
  const deadline = busyDeadline(3, 1_000);
  assert.equal(deadline, 4_000);
  assert.equal(isStillBusy(deadline, 3_999), true);
  assert.equal(isStillBusy(deadline, 4_000), false);
});

// ── Flujo completo con el cliente HTTP real (servidor simulado) ─────────────

async function client(handler) {
  const data = new Map();
  const store = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
  configureStorage({ ...store, secure: store });
  await setTokens({ accessToken: "a", refreshToken: "r" });
  const calls = [];
  const api = createApiClient({
    baseURL: "https://core.theworxoffices.com/api/v1",
    adapter: (config) => {
      calls.push(config.method.toUpperCase() + " " + config.url);
      return handler(config, calls);
    },
  });
  return { api, calls };
}
const ok = (config, status, data, headers = {}) => Promise.resolve({ data, status, statusText: String(status), headers, config });
const fail = (config, status, data, headers = {}) => Promise.reject(new AxiosError("x", "ERR_BAD_RESPONSE", config, {}, { data, status, headers, config }));
const SESSION = { success: true, url: "https://checkout.stripe.com/c/pay/cs_test_1", sessionId: "cs_test_1", paymentIntentId: null, amount: 1450, currency: "USD", expiresAt: Math.floor(Date.now() / 1000) + 1800 };

test("flujo: primero payment-status, despues el POST (201 nueva)", async () => {
  const { api, calls } = await client((config) =>
    config.method === "get" ? ok(config, 200, newStatus()) : ok(config, 201, { ...SESSION, reused: false })
  );
  const result = await startStripeCheckout(api, { serviceRequestId: "sr1", body: {} });
  assert.equal(result.outcome, "session");
  assert.equal(result.session.created, true);
  assert.deepEqual(calls, ["GET /client/forwarding/sr1/payment-status", "POST /client/forwarding/sr1/checkout-session"]);
});

test("flujo: sesion abierta -> el POST devuelve la misma (200, reused)", async () => {
  const { api, calls } = await client((config) =>
    config.method === "get"
      ? ok(config, 200, newStatus({ paymentStatus: "PAYMENT_PENDING", attempt: attempt("OPEN"), canStartNewPayment: false }))
      : ok(config, 200, { ...SESSION, reused: true })
  );
  const result = await startStripeCheckout(api, { serviceRequestId: "sr1", body: {} });
  assert.equal(result.decision.action, ACTION_RESUME);
  assert.equal(result.session.reused, true);
  assert.equal(calls.length, 2);
});

test("flujo: pendiente, incierto, en revision, pagado o backend anterior pendiente -> NINGUN POST", async () => {
  for (const status of [
    newStatus({ paymentStatus: "PAYMENT_PENDING", attempt: attempt("PROCESSING"), canStartNewPayment: false }),
    newStatus({ uncertain: true, canStartNewPayment: false }),
    newStatus({ needsReview: true, canStartNewPayment: false }),
    newStatus({ paymentStatus: "PAID", canStartNewPayment: false, reconciled: true }),
    oldStatus("PAYMENT_PENDING"),
  ]) {
    const { api, calls } = await client((config) => (config.method === "get" ? ok(config, 200, status) : assert.fail("no debe haber POST")));
    const result = await startStripeCheckout(api, { serviceRequestId: "sr1", body: {} });
    assert.equal(result.outcome, "blocked");
    assert.deepEqual(calls, ["GET /client/forwarding/sr1/payment-status"]);
  }
});

test("flujo: sin poder leer el estado (red o 503) no se paga", async () => {
  for (const failure of [(c) => Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", c, {})), (c) => fail(c, 503, "<html>")]) {
    const { api, calls } = await client((config) => (config.method === "get" ? failure(config) : assert.fail("no debe haber POST")));
    assert.deepEqual(await startStripeCheckout(api, { serviceRequestId: "sr1", body: {} }), { outcome: "status-unavailable" });
    assert.equal(calls.length, 1);
  }
});

test("flujo: 409 BUSY, 409 PROCESSING y 503 UNCERTAIN en el POST suben sin reintento (un solo POST)", async () => {
  for (const [status, code] of [[409, "FORWARDING_PAYMENT_BUSY"], [409, "FORWARDING_PAYMENT_PROCESSING"], [503, "FORWARDING_PAYMENT_UNCERTAIN"], [409, "FORWARDING_PAYMENT_NEEDS_REVIEW"]]) {
    const { api, calls } = await client((config) =>
      config.method === "get" ? ok(config, 200, newStatus()) : fail(config, status, { error: "x", code, charged: status === 503 ? null : false, retryAfterSeconds: 3 }, { "retry-after": "3" })
    );
    const error = await startStripeCheckout(api, { serviceRequestId: "sr1", body: {} }).catch((e) => e);
    assert.equal(error.response.data.code, code);
    assert.equal(calls.filter((c) => c.startsWith("POST")).length, 1, code);
  }
});

test("flujo: si la conexion falla DESPUES de enviar el POST, no se reintenta", async () => {
  const { api, calls } = await client((config) =>
    config.method === "get" ? ok(config, 200, newStatus()) : Promise.reject(new AxiosError("timeout", "ECONNABORTED", config, {}))
  );
  const error = await startStripeCheckout(api, { serviceRequestId: "sr1", body: {} }).catch((e) => e);
  const outcome = forwardPaymentError(error);
  assert.equal(outcome.kind, "unknown-outcome");
  assert.equal(outcome.retryable, false);
  assert.equal(outcome.checkStatus, true);
  assert.equal(calls.filter((c) => c.startsWith("POST")).length, 1);
});

test("concurrencia: dos pulsaciones a la vez -> una lectura y un POST", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { api, calls } = await client(async (config) => {
    if (config.method === "get") {
      await gate;
      return ok(config, 200, newStatus());
    }
    return ok(config, 201, SESSION);
  });
  const lock = createSingleFlight();
  const first = lock.run(() => startStripeCheckout(api, { serviceRequestId: "sr1", body: {} }));
  const second = lock.run(() => startStripeCheckout(api, { serviceRequestId: "sr1", body: {} }));
  assert.equal(second, null);
  release();
  await first;
  assert.deepEqual(calls, ["GET /client/forwarding/sr1/payment-status", "POST /client/forwarding/sr1/checkout-session"]);
});

test("el sondeo tras volver para en expirado (se puede pagar de nuevo) o en pagado", async () => {
  let now = 0;
  const queue = [];
  const answers = [newStatus({ paymentStatus: "PAYMENT_PENDING", attempt: attempt("OPEN"), canStartNewPayment: false }), newStatus({ attempt: attempt("EXPIRED"), canStartNewPayment: true })];
  const seen = [];
  const poller = createStatusPoller({
    fetchStatus: async () => answers[Math.min(seen.length, answers.length - 1)],
    onResult: (r) => seen.push(r.reading.state),
    now: () => now,
    schedule: (fn, d) => (queue.push({ fn, at: now + d }), queue.at(-1)),
    cancel: () => {},
  });
  poller.start();
  while (queue.length) {
    const t = queue.shift();
    now = t.at;
    await t.fn();
  }
  assert.deepEqual(seen, ["pending", "expired"]);
});

// ── Stripe TEST y Zoho Sandbox ──────────────────────────────────────────────

test("Stripe TEST: los ids de prueba (cs_test_, pi_test) no cambian nada; solo cuenta payment-status", () => {
  const session = interpretCheckoutSession({ status: 201, data: { ...SESSION, sessionId: "cs_test_a1", paymentIntentId: "pi_test_123" } });
  assert.equal(session.url, SESSION.url);
  assert.equal(stripePaymentDecision(newStatus({ paymentStatus: "PAID", canStartNewPayment: false })).paid, true);
});

test("Zoho Sandbox: su payment-status no pasa por las reglas de Stripe y sigue igual", () => {
  const zoho = { provider: "ZOHO", paymentStatus: "PAYMENT_PENDING", shipmentStatus: "NOT_CREATED", chargeStatus: "INVOICE_OPEN", paymentLinkExpired: true };
  assert.equal(interpretPaymentStatus(zoho).state, "link-expired");
  assert.equal(interpretPaymentStatus({ ...zoho, chargeStatus: "REVIEW", paymentLinkExpired: false }).state, "review");
  assert.equal(isAttemptAwareStatus(zoho), false);
});

// ── Escaneos: scan-payment y approve-scan ───────────────────────────────────

const zohoScan = (over = {}) => ({
  serviceRequestId: "sr-scan", serviceRequestStatus: "IN_PROGRESS", provider: "ZOHO", paymentState: "FAILED",
  amount: 1250, currency: "USD", pageCount: 30, paidAt: null, reason: "No saved card in Zoho for this client.",
  invoice: { provider: "ZOHO", invoiceId: "1569888000000123", number: "INV-42", status: "sent", payable: true },
  ...over,
});

test("scan-payment: ruta y deteccion del backend anterior (404 sin code)", () => {
  assert.equal(scanPaymentPath("sr-scan"), "/client/service-requests/sr-scan/scan-payment");
  assert.equal(isScanPaymentUnsupported(err(404, { error: "Not found" })), true);
  assert.equal(isScanPaymentUnsupported(err(404, { error: "x", code: "SCAN_REQUEST_NOT_FOUND" })), false);
});

test("scan-payment Zoho (HDG): factura pagable -> esa factura; nunca Stripe", () => {
  const view = interpretScanPayment(zohoScan(), { accountProvider: "ZOHO" });
  assert.equal(view.action, "zoho-invoice");
  assert.equal(view.invoiceId, "1569888000000123");
  // Aunque llegara una factura de Stripe, en una cuenta de Zoho no se abre.
  const stripeInvoice = { provider: "STRIPE", hostedInvoiceUrl: "https://invoice.stripe.com/i/x", status: "open" };
  assert.notEqual(interpretScanPayment(zohoScan({ invoice: stripeInvoice }), { accountProvider: "ZOHO" }).action, "stripe-invoice");
  assert.notEqual(interpretScanPayment({ ...zohoScan(), provider: "STRIPE", invoice: stripeInvoice }, { accountProvider: "ZOHO" }).action, "stripe-invoice");
  // Sin factura pagable: Facturacion.
  assert.equal(interpretScanPayment(zohoScan({ invoice: { ...zohoScan().invoice, payable: false } }), { accountProvider: "ZOHO" }).action, "billing");
});

test("scan-payment Stripe (The Worx): su factura https", () => {
  const view = interpretScanPayment({ ...zohoScan(), provider: "STRIPE", invoice: { provider: "STRIPE", hostedInvoiceUrl: "https://invoice.stripe.com/i/acct/test_1", status: "open" } }, { accountProvider: "STRIPE" });
  assert.equal(view.action, "stripe-invoice");
  assert.equal(view.url, "https://invoice.stripe.com/i/acct/test_1");
});

test("scan-payment: incierto -> comprobar; en revision -> centro; pagado o sin cobro -> nada", () => {
  assert.equal(interpretScanPayment(zohoScan({ paymentState: "UNCERTAIN" }), { accountProvider: "ZOHO" }).action, "check");
  assert.equal(interpretScanPayment(zohoScan({ paymentState: "NEEDS_REVIEW" }), { accountProvider: "ZOHO" }).action, "contact");
  assert.equal(interpretScanPayment(zohoScan({ paymentState: "PENDING" }), { accountProvider: "ZOHO" }).action, "check");
  for (const paymentState of ["PAID", "NOT_REQUIRED", "AWAITING_APPROVAL", "CLOSED"]) {
    assert.equal(interpretScanPayment(zohoScan({ paymentState }), { accountProvider: "ZOHO" }).visible, false, paymentState);
  }
});

test("solo se pregunta scan-payment por escaneos cotizados sin pagar", () => {
  const scan = (status, details) => ({ type: "SCAN", status, scanDetails: details });
  assert.equal(shouldTrackScanPayment(scan("IN_PROGRESS", { quotedAt: "x", quotedAmountCents: 1250, paidAt: null })), true);
  assert.equal(shouldTrackScanPayment(scan("IN_PROGRESS", { quotedAt: "x", quotedAmountCents: 1250, paidAt: "y" })), false);
  assert.equal(shouldTrackScanPayment(scan("IN_PROGRESS", { quotedAt: "x", quotedAmountCents: 0 })), false);
  assert.equal(shouldTrackScanPayment(scan("COMPLETED", { quotedAt: "x", quotedAmountCents: 1250 })), false);
  assert.equal(shouldTrackScanPayment(scan("AWAITING_CLIENT_APPROVAL", { quotedAt: "x", quotedAmountCents: 1250 })), false, "eso es la aprobacion");
  assert.equal(shouldTrackScanPayment({ type: "FORWARD" }), false);
});

test("approve-scan 402 con la factura de Zoho -> esa factura; incierto -> comprobar; revision -> centro", () => {
  const zoho402 = (paymentState, zohoInvoice) =>
    err(402, { error: "Payment failed", code: "SCAN_PAYMENT_PENDING", reason: "x", pending: true, provider: "ZOHO", paymentState, invoiceId: null, invoiceUrl: null, zohoInvoice });
  const invoice = { invoiceId: "1569888000000123", number: "INV-000042", status: "sent", payable: true };
  const withInvoice = approveScanError(zoho402("FAILED", invoice), "ZOHO");
  assert.equal(withInvoice.action, "zoho-invoice");
  assert.equal(withInvoice.invoiceId, "1569888000000123");
  assert.equal(approveScanError(zoho402("FAILED", null), "ZOHO").action, "billing");
  assert.equal(approveScanError(zoho402("FAILED", { ...invoice, invoiceId: "../x" }), "ZOHO").action, "billing", "id raro: no");
  assert.equal(approveScanError(zoho402("UNCERTAIN", invoice), "ZOHO").action, "check", "incierto: no se ofrece pagar");
  assert.equal(approveScanError(zoho402("NEEDS_REVIEW", invoice), "ZOHO").action, "contact");
  // El proveedor del 402 manda: aunque las capacidades no se supieran, un 402 de Zoho nunca abre Stripe.
  assert.notEqual(approveScanError(zoho402("FAILED", invoice), undefined).action, "invoice");
});

test("approve-scan 409: codigos estables (y el texto solo con el backend anterior)", () => {
  const c = (code, extra = {}) => approveScanError(err(409, { error: "Conflict", reason: "x", code, ...extra }), "STRIPE").kind;
  assert.equal(c("SCAN_QUOTE_OUTDATED"), "quote-outdated");
  assert.equal(c("SCAN_QUOTE_INCOMPLETE"), "quote-incomplete");
  assert.equal(c("ONLINE_PAYMENTS_UNAVAILABLE"), "unavailable");
  assert.equal(c("SERVICE_REQUEST_NOT_AWAITING_APPROVAL", { serviceRequestStatus: "IN_PROGRESS" }), "state-changed");
  assert.equal(c("SCAN_NOT_AVAILABLE_FOR_PACKAGE"), "not-scannable");
  assert.equal(c("CLIENT_PROFILE_NOT_FOUND"), "account-incomplete");
  assert.equal(c("SCAN_APPROVAL_CONFLICT"), "state-changed");
  // Backend anterior: sin code, por el texto.
  assert.equal(approveScanError(err(409, { error: "Conflict", reason: "Online payments are not available for this account. Please contact your center." }), "ZOHO").kind, "unavailable");
});
