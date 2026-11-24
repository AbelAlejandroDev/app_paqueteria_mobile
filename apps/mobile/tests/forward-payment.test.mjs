import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AxiosError } from "axios";

import { configureStorage, createApiClient, setTokens } from "@paqueteria/core";
import { deriveCapabilities, paymentStatusMinPollMs } from "../src/lib/capabilities.js";
import {
  checkoutSessionPath,
  confirmRepricedRatePath,
  createSingleFlight,
  createStatusPoller,
  forwardPaymentError,
  interpretPaymentStatus,
  isPaymentInFlight,
  paymentStatusPath,
  preparePaymentPath,
} from "../src/lib/forward-payment.js";
import * as zoho from "../src/lib/zoho-forward-payment.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const err = (status, data) => ({ response: { status, data } });

// Forma real del error de recotizacion (errorHandler añade `reprice`).
const REPRICE = err(409, {
  error: "The shipping price changed. Please confirm the new price.",
  code: "FORWARDING_PRICE_RECONFIRMATION_REQUIRED",
  reprice: { previousAmount: 950, currentAmount: 1100, currency: "USD", difference: 150, carrier: "USPS", service: "Priority", checkedAt: "2026-11-15T12:00:00.000Z" },
});

// ── Rutas reales, compartidas por los dos proveedores ───────────────────────

test("rutas del contrato (forwarding.routes.js)", () => {
  assert.equal(checkoutSessionPath("sr1"), "/client/forwarding/sr1/checkout-session");
  assert.equal(preparePaymentPath("sr1"), "/client/forwarding/sr1/prepare-payment");
  assert.equal(confirmRepricedRatePath("sr1"), "/client/forwarding/sr1/confirm-repriced-rate");
  assert.equal(paymentStatusPath("sr1"), "/client/forwarding/sr1/payment-status");
  // Zoho reexporta las mismas (no hay otras rutas para un proveedor).
  assert.equal(zoho.preparePaymentPath, preparePaymentPath);
  assert.equal(zoho.paymentStatusPath, paymentStatusPath);
  assert.equal(zoho.createStatusPoller, createStatusPoller);
  assert.equal(zoho.preparePaymentError, forwardPaymentError);
});

// ── Recotizacion y precio modificado ────────────────────────────────────────

test("recotizacion: el mismo 409 de checkout-session (Stripe) y prepare-payment (Zoho)", () => {
  const outcome = forwardPaymentError(REPRICE);
  assert.equal(outcome.kind, "reprice");
  assert.equal(outcome.currentAmount, 1100);
  assert.equal(outcome.previousAmount, 950);
  assert.equal(outcome.retryable, false, "no se paga sin que el cliente acepte el precio nuevo");
});

test("confirm-repriced-rate: caducada, no necesaria o importe invalido", () => {
  assert.equal(forwardPaymentError(err(409, { code: "FORWARDING_REPRICE_EXPIRED" })).kind, "reprice-expired");
  assert.equal(forwardPaymentError(err(409, { code: "FORWARDING_RECONFIRMATION_NOT_REQUIRED" })).kind, "reprice-not-required");
  assert.equal(forwardPaymentError(err(409, { code: "FORWARDING_PAYMENT_AMOUNT_INVALID" })).kind, "not-payable");
});

test("la tarifa ya no se puede pagar (REPRICE_BLOCKING_CODES): contactar con el centro", () => {
  for (const code of ["FORWARDING_SERVICE_UNAVAILABLE", "FORWARDING_PACKAGE_CHANGED", "FORWARDING_ORIGIN_CHANGED", "CENTER_SHIPPING_ADDRESS_NOT_VERIFIED", "FORWARDING_CARRIER_ACCOUNT_UNAVAILABLE", "FORWARDING_REPRICE_NOT_PAYABLE"]) {
    assert.equal(forwardPaymentError(err(409, { code })).kind, "not-payable", code);
  }
});

test("Stripe y Zoho: ya pagado, no disponible, temporal e incierto", () => {
  assert.equal(forwardPaymentError(err(409, { code: "FORWARDING_ALREADY_PAID" })).kind, "paid");
  assert.equal(forwardPaymentError(err(409, { code: "ONLINE_PAYMENTS_UNAVAILABLE" })).kind, "unavailable");
  assert.equal(forwardPaymentError(err(409, { code: "BILLING_PROVIDER_NOT_STRIPE" })).kind, "unavailable");
  assert.equal(forwardPaymentError(err(502, { error: "x", code: "FORWARDING_CHECKOUT_NO_PAYMENT_INTENT" })).kind, "temporary");
  const timeout = forwardPaymentError(new AxiosError("timeout", "ECONNABORTED"));
  assert.equal(timeout.kind, "unknown-outcome");
  assert.equal(timeout.checkStatus, true);
  assert.equal(timeout.retryable, false);
});

// ── Estado del pago (los dos proveedores) ───────────────────────────────────

test("payment-status de Stripe: completado, pendiente, fallido, verificacion, cancelado y reembolsado", () => {
  const read = (paymentStatus) => interpretPaymentStatus({ provider: "STRIPE", paymentStatus, shipmentStatus: "NOT_CREATED" });
  assert.equal(read("PAID").state, "paid");
  assert.equal(read("PAYMENT_PENDING").state, "pending");
  assert.equal(read("READY_FOR_PAYMENT").state, "pending");
  assert.equal(read("FAILED").state, "failed");
  assert.equal(read("AUTHENTICATION_REQUIRED").state, "failed");
  assert.equal(read("AUTHENTICATION_REQUIRED").authentication, true);
  assert.equal(read("CANCELLED").state, "cancelled");
  assert.equal(read("REFUNDED").state, "refunded");
  assert.equal(read("PAYMENT_PENDING").terminal, false);
  for (const s of ["PAID", "FAILED", "CANCELLED", "REFUNDED"]) assert.equal(read(s).terminal, true, s);
});

test("compatibilidad con Zoho: REVIEW y enlace caducado siguen igual", () => {
  assert.equal(interpretPaymentStatus({ provider: "ZOHO", paymentStatus: "PAYMENT_PENDING", chargeStatus: "REVIEW" }).state, "review");
  assert.equal(interpretPaymentStatus({ provider: "ZOHO", paymentStatus: "PAYMENT_PENDING", chargeStatus: "INVOICE_OPEN", paymentLinkExpired: true }).state, "link-expired");
});

test("un pago empezado sin confirmar (PAYMENT_PENDING) obliga a comprobar antes de pagar otra vez", () => {
  assert.equal(isPaymentInFlight("PAYMENT_PENDING"), true);
  for (const s of ["READY_FOR_PAYMENT", "FAILED", "AUTHENTICATION_REQUIRED", "PAID", undefined]) assert.equal(isPaymentInFlight(s), false, String(s));
});

test("Stripe sondea tambien cada 15 s (paymentStatusMinPollSeconds null)", () => {
  const stripe = deriveCapabilities({ capabilities: { contractVersion: 1, tenant: { slug: "the_worx" }, billing: { provider: "STRIPE" }, forwarding: { payments: true, checkout: "EMBEDDED", methods: ["CHECKOUT_SESSION"], paymentStatusMinPollSeconds: null } } });
  assert.equal(paymentStatusMinPollMs(stripe), 15000);
});

test("polling de Stripe: tras volver del Checkout, PAID corta el sondeo", async () => {
  let now = 0;
  const queue = [];
  const schedule = (fn, delay) => {
    const t = { fn, at: now + delay, off: false };
    queue.push(t);
    return t;
  };
  const cancel = (t) => t && (t.off = true);
  const advance = async (ms) => {
    const target = now + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const t = queue.find((x) => !x.off && x.at <= target);
      if (!t) break;
      t.off = true;
      now = Math.max(now, t.at);
      await t.fn();
    }
    now = target;
  };
  const answers = ["PAYMENT_PENDING", "PAYMENT_PENDING", "PAID"];
  const seen = [];
  const poller = createStatusPoller({
    fetchStatus: async () => ({ provider: "STRIPE", paymentStatus: answers[seen.length] ?? "PAID" }),
    onResult: (r) => seen.push(r.reading.state),
    now: () => now,
    schedule,
    cancel,
  });
  poller.start();
  await advance(0);
  await advance(60_000);
  assert.deepEqual(seen, ["pending", "pending", "paid"]);
});

test("el sondeo agotado sin confirmacion lo dice (exhausted) para ofrecer 'Check payment status'", async () => {
  const results = [];
  let now = 0;
  const queue = [];
  const poller = createStatusPoller({
    maxAttempts: 2,
    fetchStatus: async () => ({ paymentStatus: "PAYMENT_PENDING" }),
    onResult: (r) => results.push(r.exhausted),
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
  assert.deepEqual(results, [false, true]);
});

// ── Proteccion contra operaciones duplicadas ────────────────────────────────

test("el candado: dos pulsaciones seguidas mandan una sola operacion", async () => {
  const lock = createSingleFlight();
  let calls = 0;
  let release;
  const op = () => {
    calls++;
    return new Promise((resolve) => (release = resolve));
  };
  const first = lock.run(op);
  const second = lock.run(op);
  assert.equal(calls, 1);
  assert.equal(second, null);
  assert.equal(lock.busy, true);
  release("ok");
  assert.equal(await first, "ok");
  assert.equal(lock.busy, false);
  await lock.run(async () => calls++);
  assert.equal(calls, 2, "terminada la primera, se puede volver a pulsar");
});

test("el candado se libera aunque la operacion falle", async () => {
  const lock = createSingleFlight();
  await assert.rejects(lock.run(async () => {
    throw new Error("boom");
  }));
  assert.equal(lock.busy, false);
  assert.throws(() => lock.run(() => {
    throw new Error("sync");
  }));
  assert.equal(lock.busy, false);
});

test("checkout-session y confirm-repriced-rate que fallan por red se envian una sola vez", async () => {
  const data = new Map();
  const store = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
  configureStorage({ ...store, secure: store });
  await setTokens({ accessToken: "a", refreshToken: "r" });
  for (const url of [checkoutSessionPath("sr1"), confirmRepricedRatePath("sr1")]) {
    let posts = 0;
    const api = createApiClient({
      baseURL: "https://core.theworxoffices.com/api/v1",
      adapter: (config) => {
        posts++;
        return Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config, {}));
      },
    });
    await assert.rejects(api.post(url, {}));
    assert.equal(posts, 1, url);
  }
});

// ── Stripe Checkout: cableado ───────────────────────────────────────────────

const stripe = () => read("src/components/common/stripe-forward-payment.jsx");

test("Stripe Checkout: el de siempre, con URL https y vuelta que solo lee el estado", () => {
  const card = stripe();
  assert.match(card, /startStripeCheckout\(api, \{/);
  assert.match(read("src/lib/stripe-checkout-flow.js"), /api\.post\(checkoutSessionPath\(serviceRequestId\), body \|\| \{\}\)/);
  assert.match(card, /stripeReturnBody\(\{ successUrl: returnUrl, cancelUrl: returnUrl \}\)/);
  assert.match(read("src/lib/stripe-checkout-flow.js"), /session: interpretCheckoutSession\(response\)/);
  assert.match(card, /const session = result\.session;/);
  assert.match(card, /if \(!session\.url\) throw/, "solo una URL https");
  assert.match(card, /WebBrowser\.openAuthSessionAsync\(session\.url, returnUrl\)/);
  assert.match(card, /usePaymentStatus\(\{/);
  // No reutiliza rutas de Zoho.
  assert.doesNotMatch(card, /prepare-payment|preparePaymentPath|useSavedCard|\/zoho\//);
});

test("Stripe: precio modificado solo con confirmacion explicita, y pagar sigue siendo otra pulsacion", () => {
  const card = stripe();
  assert.match(card, /Alert\.alert\(\s*"The price changed"/);
  assert.match(card, /\{ text: "Accept new price", onPress: \(\) => lock\.run\(\(\) => confirmReprice\.mutateAsync/);
  assert.match(card, /api\.post\(confirmRepricedRatePath\(request\.id\)\)/);
  const confirm = card.slice(card.indexOf("const confirmReprice = useMutation({"), card.indexOf("const busy ="));
  assert.doesNotMatch(confirm, /pay\.mutate|checkout-session|openAuthSessionAsync/, "confirmar no abre el pago solo");
  assert.match(confirm, /Tap Pay now to continue/);
});

test("Stripe: cada pago lee payment-status justo antes del POST y decide con el servidor; candado y sin reintentos", () => {
  const card = stripe();
  const start = card.slice(card.indexOf("const startPayment = () =>"), card.indexOf("const checkAgain = () =>"));
  assert.match(start, /lock\.run\(async \(\) => \{/);
  assert.match(start, /if \(isStillBusy\(busyUntil\)\)/, "respeta el Retry-After de un 409 BUSY");
  assert.match(start, /await checkout\.mutateAsync\(\)/);
  assert.match(card, /const result = await startStripeCheckout\(api, \{\s*serviceRequestId: request\.id,\s*localPaymentStatus: details\.paymentStatus,/);
  // En el flujo: primero el estado, la decision, y solo entonces el POST.
  const flow = read("src/lib/stripe-checkout-flow.js");
  assert.ok(flow.indexOf("api.get(paymentStatusPath(serviceRequestId))") < flow.indexOf("api.post(checkoutSessionPath("), "primero el estado, despues el POST");
  assert.match(flow, /if \(decision\.action === ACTION_NONE\) return \{ outcome: "blocked", status, decision \};/);
  assert.match(flow, /catch \{[\s\S]*?return \{ outcome: "status-unavailable" \};/, "sin estado, no se paga");
  // Ya no existe "pagar otra vez con confirmacion": con un pago sin confirmar, el servidor decide.
  assert.doesNotMatch(card, /"Pay again"|Paying again could charge you twice/);
  assert.doesNotMatch(card, /\bretry\s*:/);
  assert.doesNotMatch(card, /useEffect\(/, "nada se paga solo");
});

test("despues de un pago se refrescan facturas, solicitudes, correspondencia y capacidades", () => {
  for (const file of ["src/components/common/stripe-forward-payment.jsx", "src/components/common/zoho-forward-payment-card.jsx"]) {
    const card = read(file);
    const refresh = card.slice(card.indexOf("const refreshAfterPayment = useCallback("), card.indexOf("}, [onRefresh, queryClient]);"));
    for (const key of ['notifyCapabilitiesStale("payment")', "BILLING_PAYMENT_QUERY_KEY", '"client-payment-alerts"', '"client-account-alerts"', '"client-mail-items"', "await onRefresh?.()"]) {
      assert.ok(refresh.includes(key), file + ": " + key);
    }
  }
});

test("Zoho usa el mismo seguimiento y el mismo candado; sus diferencias siguen", () => {
  const card = read("src/components/common/zoho-forward-payment-card.jsx");
  assert.match(card, /usePaymentStatus\(\{/);
  assert.match(card, /const guarded = \(mutation, variables\) => lock\.run\(/);
  assert.match(card, /SAVED_CARD_BODY/);
  assert.match(card, /isPaymentLinkExpired\(current\.expiresAt\)/);
  assert.doesNotMatch(card, /checkout-session/, "Zoho no usa el Checkout de Stripe");
});

test("un importe que falta es null, no $0.00: la recotizacion sin importe no se puede aceptar", async () => {
  const { centsOrNull } = await import("../src/lib/forward-payment.js");
  assert.deepEqual([null, undefined, "", "abc", 0, "1100", 950].map(centsOrNull), [null, null, null, null, 0, 1100, 950]);
  const blind = forwardPaymentError(err(409, { code: "FORWARDING_PRICE_RECONFIRMATION_REQUIRED", reprice: { currency: "USD" } }));
  assert.equal(blind.kind, "reprice");
  assert.equal(blind.currentAmount, null);
  for (const file of ["src/components/common/stripe-forward-payment.jsx", "src/components/common/zoho-forward-payment-card.jsx"]) {
    const card = read(file);
    assert.ok(card.indexOf('outcome.kind === "reprice" && outcome.currentAmount === null') < card.indexOf('"Accept new price"'), file);
  }
  const partial = zoho.paymentBreakdown({ amount: 1450 });
  assert.equal(partial.shippingAndHandling, null, "el desglose no inventa ceros");
  assert.equal(partial.mailForwardingFee, null, "el desglose no inventa ceros");
  assert.equal("handling" in partial, false, "la gestion interna nunca es una linea");
});
