import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient } from "@tanstack/query-core";

import {
  BILLING_VIEW_STRIPE,
  BILLING_VIEW_UNKNOWN,
  BILLING_VIEW_ZOHO,
  billingHold,
  billingView,
  CAPABILITIES_QUERY_KEY,
  capabilitiesQueryKey,
  deriveCapabilities,
  FORWARD_PAYMENT_STRIPE_CHECKOUT,
  FORWARD_PAYMENT_UNAVAILABLE,
  FORWARD_PAYMENT_UNKNOWN,
  FORWARD_PAYMENT_ZOHO_HOSTED,
  forwardPaymentMode,
  isCapabilityError,
  itemActions,
  paymentStatusMinPollMs,
  savedCardAllowed,
  SERVICE_KEYS,
  serviceAllowed,
  zohoBillingActions,
} from "../src/lib/capabilities.js";
import { reportCapabilityError, subscribeCapabilitiesStale } from "../src/lib/capabilities-events.js";
import { sessionScope } from "../src/lib/session-scope.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// ── Ejemplos del contrato v1 (backend 348c327, docs/mobile/capacidades-y-health.md) ──

const WORX = {
  contractVersion: 1,
  environment: "production",
  tenant: { slug: "the_worx", name: "The Worx" },
  center: { slug: "sandlake", displayName: "The Worx Sand Lake" },
  billing: { provider: "STRIPE", onlinePayments: true, billingPortal: true, invoices: true, paymentMethodManagement: "STRIPE_PORTAL", zoho: null },
  forwarding: { available: true, payments: true, checkout: "EMBEDDED", methods: ["PAYMENT_INTENT", "CHECKOUT_SESSION"], returnDetection: null, paymentStatusMinPollSeconds: null },
  services: { forwarding: true, immediateForwarding: true, scheduledForwarding: true, storageFees: true, paidScans: true, autoScan: true, planChange: true, cancellationRequest: true },
  restrictions: { billingHold: { active: false, code: null, reason: null }, mailboxActive: true, uspsComplianceStatus: "APPROVED", accountClosureScheduledAt: null, accountDeletionInProgress: false },
};

const HDG = {
  contractVersion: 1,
  environment: "sandbox",
  tenant: { slug: "hdg", name: "HDG Executive Suites" },
  center: { slug: "hollywood", displayName: "HDG Hollywood" },
  billing: {
    provider: "ZOHO", onlinePayments: false, billingPortal: false, invoices: false, paymentMethodManagement: "ZOHO_HOSTED",
    zoho: { available: true, unavailableReason: null, payInvoices: true, updateCard: true, addPaymentMethod: true },
  },
  forwarding: { available: false, payments: true, checkout: "HOSTED", methods: ["HOSTED_PAGE", "SAVED_CARD"], returnDetection: "PAYMENT_STATUS_POLL", paymentStatusMinPollSeconds: 15 },
  services: { forwarding: false, immediateForwarding: false, scheduledForwarding: false, storageFees: false, paidScans: false, autoScan: false, planChange: false, cancellationRequest: true },
  restrictions: { billingHold: { active: false, code: null, reason: null }, mailboxActive: true, uspsComplianceStatus: "UNDER_REVIEW", accountClosureScheduledAt: null, accountDeletionInProgress: false },
};

// HDG con Zoho apagado o sin configurar (§1, al final).
const HDG_ZOHO_OFF = {
  ...HDG,
  billing: {
    ...HDG.billing,
    paymentMethodManagement: "NONE",
    zoho: { available: false, unavailableReason: "ZOHO_ENVIRONMENT_NOT_ENABLED", payInvoices: false, updateCard: false, addPaymentMethod: false },
  },
  forwarding: { available: false, payments: false, checkout: null, methods: [], returnDetection: null, paymentStatusMinPollSeconds: null },
};

const PAST_DUE = {
  ...WORX,
  restrictions: {
    billingHold: { active: true, code: "BILLING_REQUIRED", reason: "Your subscription is past due. Please update payment before requesting services." },
    mailboxActive: true, uspsComplianceStatus: null, accountClosureScheduledAt: "2026-12-01T05:00:00.000Z", accountDeletionInProgress: true,
  },
};

const ALL_ACTIONS = { canRequestScan: true, canRequestForward: true, canRequestPickup: true, canRequestDiscard: true, canRejectAssignment: true, billingRestricted: false };

// ── Stripe ──────────────────────────────────────────────────────────────────

test("Stripe (The Worx): capacidades del contrato v1 tal cual", () => {
  const caps = deriveCapabilities({ capabilities: WORX, expectedTenantSlug: "the_worx" });
  assert.equal(caps.known, true);
  assert.equal(caps.environment, "production");
  assert.equal(caps.provider, "STRIPE");
  assert.equal(caps.paymentMethodManagement, "STRIPE_PORTAL");
  assert.equal(caps.zoho, null);
  assert.deepEqual(caps.center, { slug: "sandlake", displayName: "The Worx Sand Lake" });
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_STRIPE_CHECKOUT);
  assert.equal(savedCardAllowed(caps), false);
  assert.equal(billingView(caps), BILLING_VIEW_STRIPE);
  assert.equal(zohoBillingActions(caps).available, false);
});

test("EMBEDDED sin CHECKOUT_SESSION no se paga con el flujo de la app (no se supone)", () => {
  const caps = deriveCapabilities({ capabilities: { ...WORX, forwarding: { ...WORX.forwarding, methods: ["PAYMENT_INTENT"] } } });
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_UNAVAILABLE);
});

// ── Zoho ────────────────────────────────────────────────────────────────────

test("Zoho (HDG Sandbox): HOSTED, tarjeta guardada y sondeo minimo de 15 s", () => {
  const caps = deriveCapabilities({ capabilities: HDG, expectedTenantSlug: "hdg" });
  assert.equal(caps.environment, "sandbox");
  assert.equal(caps.provider, "ZOHO");
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_ZOHO_HOSTED);
  assert.equal(savedCardAllowed(caps), true);
  assert.equal(paymentStatusMinPollMs(caps), 15000);
  assert.equal(caps.forwarding.returnDetection, "PAYMENT_STATUS_POLL");
  assert.equal(billingView(caps), BILLING_VIEW_ZOHO);
  assert.deepEqual(zohoBillingActions(caps), { available: true, unavailableReason: null, payInvoices: true, updateCard: true, addPaymentMethod: true });
});

test("Zoho: pagar un reenvio ya creado no depende de forwarding.available (eso es pedir uno)", () => {
  const caps = deriveCapabilities({ capabilities: HDG });
  assert.equal(caps.forwarding.available, false);
  assert.equal(caps.forwarding.payments, true);
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_ZOHO_HOSTED);
});

test("Zoho apagado: sin pagos de reenvio ni paginas de Zoho, con el motivo", () => {
  const caps = deriveCapabilities({ capabilities: HDG_ZOHO_OFF });
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_UNAVAILABLE);
  assert.equal(savedCardAllowed(caps), false);
  assert.deepEqual(zohoBillingActions(caps), {
    available: false,
    unavailableReason: "ZOHO_ENVIRONMENT_NOT_ENABLED",
    payInvoices: false,
    updateCard: false,
    addPaymentMethod: false,
  });
  assert.equal(billingView(caps), BILLING_VIEW_ZOHO);
});

test("HOSTED sin SAVED_CARD: solo pagina segura", () => {
  const caps = deriveCapabilities({ capabilities: { ...HDG, forwarding: { ...HDG.forwarding, methods: ["HOSTED_PAGE"] } } });
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_ZOHO_HOSTED);
  assert.equal(savedCardAllowed(caps), false);
});

test("el sondeo nunca baja de 15 s aunque el servidor dijera menos", () => {
  const caps = deriveCapabilities({ capabilities: { ...HDG, forwarding: { ...HDG.forwarding, paymentStatusMinPollSeconds: 2 } } });
  assert.equal(paymentStatusMinPollMs(caps), 15000);
  assert.equal(paymentStatusMinPollMs(deriveCapabilities({ capabilities: { ...HDG, forwarding: { ...HDG.forwarding, paymentStatusMinPollSeconds: 30 } } })), 30000);
});

// ── Sin datos / contrato desconocido ────────────────────────────────────────

test("sin respuesta todo es desconocido, no falso", () => {
  const caps = deriveCapabilities({});
  assert.equal(caps.known, false);
  assert.equal(caps.provider, null);
  assert.equal(caps.services, null);
  assert.equal(caps.environment, null);
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_UNKNOWN);
  assert.equal(billingView(caps), BILLING_VIEW_UNKNOWN);
});

test("un contractVersion que no se conoce no se interpreta", () => {
  const caps = deriveCapabilities({ capabilities: { ...WORX, contractVersion: 2 } });
  assert.equal(caps.known, false);
  assert.equal(caps.reason, "UNSUPPORTED_CONTRACT");
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_UNKNOWN);
});

test("valores fuera del contrato se descartan", () => {
  const caps = deriveCapabilities({
    capabilities: { ...WORX, environment: "staging", billing: { ...WORX.billing, provider: "OTHER", paymentMethodManagement: "X" }, forwarding: { ...WORX.forwarding, checkout: "WEIRD" }, services: { forwarding: true, made_up: true } },
  });
  assert.equal(caps.environment, null);
  assert.equal(caps.provider, null);
  assert.equal(caps.paymentMethodManagement, null);
  assert.equal(caps.forwarding.checkout, null);
  assert.deepEqual(Object.keys(caps.services), SERVICE_KEYS);
  assert.equal(caps.services.paidScans, null);
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_UNAVAILABLE);
});

// ── Servicios deshabilitados y restricciones ────────────────────────────────

test("services.forwarding false quita Forward a la pieza; el resto sigue", () => {
  const caps = deriveCapabilities({ capabilities: HDG });
  assert.equal(serviceAllowed(caps, "forwarding"), false);
  const actions = itemActions(ALL_ACTIONS, caps);
  assert.equal(actions.canRequestForward, false);
  assert.equal(actions.canRequestScan, true, "paidScans no decide si se puede pedir un escaneo incluido");
  assert.equal(actions.canRequestPickup, true);
});

test("las capacidades nunca dan una accion que el backend no da", () => {
  const caps = deriveCapabilities({ capabilities: WORX });
  const none = { canRequestScan: false, canRequestForward: false, canRequestPickup: false, canRequestDiscard: false, canRejectAssignment: false };
  assert.deepEqual(itemActions(none, caps), { ...none, billingRestricted: false });
  assert.deepEqual(itemActions(ALL_ACTIONS, deriveCapabilities({})), ALL_ACTIONS, "sin capacidades manda availableActions");
});

test("billingHold activo: aviso con su motivo y ninguna solicitud de servicio", () => {
  const caps = deriveCapabilities({ capabilities: PAST_DUE });
  assert.equal(billingHold(caps).reason, "Your subscription is past due. Please update payment before requesting services.");
  const actions = itemActions(ALL_ACTIONS, caps);
  assert.equal(actions.billingRestricted, true);
  for (const flag of ["canRequestScan", "canRequestForward", "canRequestPickup", "canRequestDiscard", "canRejectAssignment"]) {
    assert.equal(actions[flag], false, flag);
  }
  assert.equal(caps.restrictions.accountDeletionInProgress, true);
  assert.equal(billingHold(deriveCapabilities({ capabilities: WORX })), null);
});

// ── Aislamiento entre marcas y centros ──────────────────────────────────────

test("las capacidades de otra organizacion no valen en esta app", () => {
  const inHdgApp = deriveCapabilities({ capabilities: WORX, expectedTenantSlug: "hdg" });
  assert.equal(inHdgApp.known, false);
  assert.equal(inHdgApp.reason, "TENANT_MISMATCH");
  assert.equal(forwardPaymentMode(inHdgApp), FORWARD_PAYMENT_UNKNOWN);

  const inWorxApp = deriveCapabilities({ capabilities: HDG, expectedTenantSlug: "the_worx" });
  assert.equal(inWorxApp.known, false);
  assert.equal(inWorxApp.provider, null, "no se usa el proveedor de la otra marca");
});

test("la cache de capacidades va por organizacion y usuario", () => {
  const hdgUser = sessionScope({ id: "u1", tenantId: "hdg" });
  const worxUser = sessionScope({ id: "u1", tenantId: "worx" });
  assert.notDeepEqual(capabilitiesQueryKey(hdgUser), capabilitiesQueryKey(worxUser));
  assert.deepEqual(capabilitiesQueryKey(null), [CAPABILITIES_QUERY_KEY, null]);

  const queryClient = new QueryClient();
  queryClient.setQueryData(capabilitiesQueryKey(hdgUser), HDG);
  queryClient.setQueryData(capabilitiesQueryKey(worxUser), WORX);
  assert.equal(queryClient.getQueryData(capabilitiesQueryKey(hdgUser)).billing.provider, "ZOHO");
  assert.equal(queryClient.getQueryData(capabilitiesQueryKey(worxUser)).billing.provider, "STRIPE");
  assert.equal(queryClient.getQueryData(capabilitiesQueryKey(sessionScope({ id: "u2", tenantId: "worx" }))), undefined);
});

test("ninguna decision de capacidades mira la marca: todo sale de la respuesta", () => {
  for (const file of ["src/lib/capabilities.js", "src/lib/use-capabilities.js", "src/lib/zoho-billing.js", "src/lib/zoho-forward-payment.js", "src/components/common/zoho-forward-payment-card.jsx"]) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(code, /["'](hdg|the_worx|hollywood|sandlake|hallandale|hunterscreek)["']/, file);
    assert.doesNotMatch(code, /brand\.id\b/, file);
  }
});

// ── Releer tras 402/409 de una guarda ───────────────────────────────────────

test("tras un 402/409 de una guarda se piden de nuevo las capacidades", () => {
  const events = [];
  const off = subscribeCapabilitiesStale((reason) => events.push(reason));
  try {
    const conflict = (status, code) => ({ response: { status, data: { error: "x", code } } });
    assert.equal(reportCapabilityError(conflict(409, "ONLINE_PAYMENTS_UNAVAILABLE")), true);
    assert.equal(reportCapabilityError(conflict(409, "CENTER_POLICY_NOT_CONFIGURED")), true);
    assert.equal(reportCapabilityError(conflict(402, "BILLING_REQUIRED")), true);
    assert.equal(reportCapabilityError(conflict(409, "FORWARDING_ALREADY_PAID")), false);
    assert.equal(reportCapabilityError({ response: { status: 402, data: { error: "Payment failed" } } }), false);
    assert.deepEqual(events, ["ONLINE_PAYMENTS_UNAVAILABLE", "CENTER_POLICY_NOT_CONFIGURED", "BILLING_REQUIRED"]);
  } finally {
    off();
  }
  assert.equal(isCapabilityError({ response: { status: 404, data: { code: "ZOHO_CUSTOMER_NOT_LINKED" } } }), true);
});

// ── Cableado ────────────────────────────────────────────────────────────────

test("la app pide /client/capabilities con su sesion y la compara con su organizacion", () => {
  const hook = read("src/lib/use-capabilities.js");
  assert.match(hook, /api\.get\("\/client\/capabilities"\)/);
  assert.match(hook, /queryKey: capabilitiesQueryKey\(scope\)/);
  assert.match(hook, /expectedTenantSlug: brand\.tenantSlug/);
  assert.match(read("src/lib/api-interceptors.js"), /reportCapabilityError\(error\)/);
  assert.match(read("src/app/_layout.jsx"), /<CapabilitiesSync \/>/);
  assert.match(read("src/app/_layout.jsx"), /connectFocusToAppState\(focusManager, AppState\)/);
});

test("el pago del reenvio elige el flujo por las capacidades; el de Stripe sigue igual", () => {
  const detail = read("src/app/(client)/mail-items/[id].jsx");
  const start = detail.indexOf("function ForwardPaymentCard(");
  const card = detail.slice(start, detail.indexOf("\nfunction ", start + 10));
  assert.match(card, /const mode = forwardPaymentMode\(capabilities\);/);
  assert.match(card, /mode === FORWARD_PAYMENT_STRIPE_CHECKOUT \? \(\s*<StripeForwardPayment/);
  assert.match(card, /mode === FORWARD_PAYMENT_ZOHO_HOSTED \? \(\s*<ZohoForwardPaymentCard/);
  assert.match(card, /mode === FORWARD_PAYMENT_UNKNOWN/);
  // Stripe: el mismo Checkout de siempre, en su componente.
  const stripe = read("src/components/common/stripe-forward-payment.jsx");
  assert.match(stripe, /startStripeCheckout\(api, \{/);
  assert.match(read("src/lib/stripe-checkout-flow.js"), /api\.post\(checkoutSessionPath\(serviceRequestId\), body \|\| \{\}\)/);
  assert.match(stripe, /stripeReturnBody\(\{ successUrl: returnUrl, cancelUrl: returnUrl \}\)/);
  assert.match(stripe, /WebBrowser\.openAuthSessionAsync\(session\.url, returnUrl\)/);
});

test("las acciones de la pieza pasan por itemActions", () => {
  const detail = read("src/app/(client)/mail-items/[id].jsx");
  const start = detail.indexOf("function ActionsCard(");
  const actionsCard = detail.slice(start, detail.indexOf("\nfunction ", start + 10));
  assert.match(actionsCard, /const actions = itemActions\(availableActions, capabilities\);/);
  assert.doesNotMatch(actionsCard, /availableActions\?\.(canRequest|canReject|billingRestricted)/);
});

test("Facturacion: vista por /client/capabilities, datos por billing/payment", () => {
  const billing = read("src/app/(client)/billing.jsx");
  assert.match(billing, /const capabilities = useCapabilities\(\);/);
  assert.match(billing, /useQuery\(billingPaymentQueryOptions\(sessionScope\(user\)\)\)/);
  assert.match(billing, /if \(view === BILLING_VIEW_ZOHO\) \{/);
  assert.doesNotMatch(billing, /deriveCapabilities\(/);
});
