import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient } from "@tanstack/query-core";

import {
  BILLING_PAYMENT_QUERY_KEY,
  BILLING_VIEW_STRIPE,
  BILLING_VIEW_UNKNOWN,
  BILLING_VIEW_ZOHO,
  billingPaymentQueryKey,
  billingView,
  deriveCapabilities,
  FORWARD_PAYMENT_NOT_IN_APP,
  FORWARD_PAYMENT_STRIPE_CHECKOUT,
  FORWARD_PAYMENT_UNAVAILABLE,
  FORWARD_PAYMENT_UNKNOWN,
  forwardPaymentMode,
  isCapabilityError,
  itemActions,
  PUBLIC_PORTAL_SOURCE,
  SERVICE_KEYS,
  serviceAllowed,
} from "../src/lib/capabilities.js";
import { sessionScope } from "../src/lib/session-scope.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// ── Respuestas reales del backend (handoff HDG B.1 y A.7; ids ficticios) ────

const STRIPE_PAYMENT = {
  billing: { provider: "STRIPE", onlinePayments: true, billingPortal: true, invoices: true, forwardingPayments: true, forwardingPaymentProvider: "STRIPE" },
  plan: { code: "PREMIUM", name: "Premium" },
  subscription: { stripeCustomerId: "cus_example", status: "active" },
  paymentMethod: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
  billingPortal: { available: true, returnUrl: "https://x/billing", unavailableReason: null },
};

// HDG Sandbox hoy: ZOHO_FORWARDING_PAYMENTS_ENABLED apagado.
const ZOHO_PAYMENT = {
  billing: { provider: "ZOHO", onlinePayments: false, billingPortal: false, invoices: false, forwardingPayments: false, forwardingPaymentProvider: null },
  plan: { code: "PREMIUM", name: "Premium", startedAt: "2026-01-01T00:00:00.000Z" },
  billingCycle: { startAt: "2026-11-05T05:00:00.000Z", endAt: "2026-12-05T05:00:00.000Z", source: "zoho_subscription" },
  subscription: null,
  paymentMethod: null,
  billingPortal: { available: false, returnUrl: null, unavailableReason: "Billing is managed by your center." },
  zoho: {
    provider: "ZOHO",
    cards: [{ last4: "1111", expMonth: 12, expYear: 2030, gateway: "test_gateway" }],
    invoices: [{ invoiceId: "1234567000000012345", kind: "MEMBERSHIP", payable: true }],
    payments: [],
    actions: { updateCard: true, addPaymentMethod: true, payInvoices: true, deleteCard: false, setDefaultCard: false },
  },
  zohoUnavailable: null,
};

// /public/portal de HDG Sandbox (A.7) y de The Worx (respuesta real, solo lectura).
const HDG_PORTAL = {
  portal: "member",
  tenant: { slug: "hdg" },
  center: { slug: "hollywood" },
  billing: { onlinePayments: false, billingPortal: false, invoices: false, forwardingPayments: false, forwardingCheckout: null },
  services: { forwarding: false, immediateForwarding: false, scheduledForwarding: false, storageFees: false, paidScans: false, autoScan: false, planChange: false, cancellationRequest: true },
  deployment: "sandbox",
};
const WORX_PORTAL = {
  portal: "member",
  tenant: { slug: "the_worx" },
  center: { slug: "sandlake" },
  billing: { onlinePayments: true, billingPortal: true, invoices: true, forwardingPayments: true, forwardingCheckout: "EMBEDDED" },
  services: { forwarding: true, immediateForwarding: true, scheduledForwarding: true, storageFees: true, paidScans: true, autoScan: true, planChange: true, cancellationRequest: true },
};

const ALL_ACTIONS = { canRequestScan: true, canRequestForward: true, canRequestPickup: true, canRequestDiscard: true, canRejectAssignment: true, billingRestricted: false };

// ── Stripe ──────────────────────────────────────────────────────────────────

test("Stripe: capacidades tal cual las da billing/payment", () => {
  const caps = deriveCapabilities({ billingPayment: STRIPE_PAYMENT });
  assert.equal(caps.known, true);
  assert.equal(caps.provider, "STRIPE");
  assert.equal(caps.onlinePayments, true);
  assert.equal(caps.billingPortal, true);
  assert.equal(caps.billingPortalAvailable, true);
  assert.equal(caps.forwardingPayments, true);
  assert.equal(caps.forwardingPaymentProvider, "STRIPE");
  assert.equal(caps.zoho, null);
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_STRIPE_CHECKOUT);
  assert.equal(billingView(caps), BILLING_VIEW_STRIPE);
});

test("Stripe: sin /public/portal no se inventan services, forwardingCheckout ni deployment", () => {
  const caps = deriveCapabilities({ billingPayment: STRIPE_PAYMENT });
  assert.equal(caps.services, null);
  assert.equal(caps.forwardingCheckout, null, "no se deduce EMBEDDED del proveedor");
  assert.equal(caps.deployment, null);
  assert.deepEqual(caps.sources, { billingPayment: true, publicPortal: false });
  assert.deepEqual(PUBLIC_PORTAL_SOURCE, { available: false, reason: "PUBLIC_PORTAL_REQUIRES_ORIGIN" });
});

// ── Zoho ────────────────────────────────────────────────────────────────────

test("Zoho (HDG Sandbox hoy): sin pagos en linea ni de reenvio", () => {
  const caps = deriveCapabilities({ billingPayment: ZOHO_PAYMENT });
  assert.equal(caps.provider, "ZOHO");
  assert.equal(caps.onlinePayments, false);
  assert.equal(caps.billingPortalAvailable, false);
  assert.equal(caps.billingPortalUnavailableReason, "Billing is managed by your center.");
  assert.equal(caps.forwardingPayments, false);
  assert.equal(caps.forwardingPaymentProvider, null);
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_UNAVAILABLE);
  assert.equal(billingView(caps), BILLING_VIEW_ZOHO);
});

test("Zoho: tarjetas enmascaradas (sin gateway ni marca inventada) y acciones de Zoho", () => {
  const caps = deriveCapabilities({ billingPayment: ZOHO_PAYMENT });
  assert.deepEqual(caps.zoho.cards, [{ last4: "1111", expMonth: 12, expYear: 2030 }]);
  assert.deepEqual(caps.zoho.actions, { updateCard: true, addPaymentMethod: true, payInvoices: true });
  assert.equal(caps.zoho.unavailable, null);
  assert.equal(caps.zoho.loaded, true);
});

test("Zoho con el cobro de reenvios encendido: nunca se le ofrece el Checkout de Stripe", () => {
  const enabled = { ...ZOHO_PAYMENT, billing: { ...ZOHO_PAYMENT.billing, forwardingPayments: true, forwardingPaymentProvider: "ZOHO" } };
  const caps = deriveCapabilities({ billingPayment: enabled });
  assert.equal(caps.forwardingPayments, true);
  assert.equal(caps.forwardingPaymentProvider, "ZOHO");
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_NOT_IN_APP);
});

test("Zoho no responde: la pantalla sigue, con el motivo y sin tarjetas", () => {
  const caps = deriveCapabilities({ billingPayment: { ...ZOHO_PAYMENT, zoho: null, zohoUnavailable: "ZOHO_CUSTOMER_NOT_LINKED" } });
  assert.equal(caps.provider, "ZOHO");
  assert.equal(caps.zoho.unavailable, "ZOHO_CUSTOMER_NOT_LINKED");
  assert.deepEqual(caps.zoho.cards, []);
  assert.equal(caps.zoho.loaded, false);
  assert.deepEqual(caps.zoho.actions, { updateCard: null, addPaymentMethod: null, payInvoices: null });
});

// ── Sin datos ───────────────────────────────────────────────────────────────

test("sin billing/payment todo es desconocido, no falso", () => {
  const caps = deriveCapabilities({});
  assert.equal(caps.known, false);
  for (const key of ["provider", "onlinePayments", "billingPortal", "invoices", "forwardingPayments", "forwardingPaymentProvider", "billingPortalAvailable", "services", "deployment", "zoho"]) {
    assert.equal(caps[key], null, key);
  }
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_UNKNOWN);
  assert.equal(billingView(caps), BILLING_VIEW_UNKNOWN);
});

test("un proveedor desconocido no se trata como Stripe", () => {
  const caps = deriveCapabilities({ billingPayment: { billing: { provider: "OTHER", forwardingPayments: true, forwardingPaymentProvider: "OTHER" } } });
  assert.equal(caps.provider, null);
  assert.equal(caps.forwardingPaymentProvider, null);
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_UNAVAILABLE);
  assert.equal(billingView(caps), BILLING_VIEW_UNKNOWN);
});

// ── /public/portal, si hubiera fuente ───────────────────────────────────────

test("con la respuesta del portal: services, forwardingCheckout y deployment reales", () => {
  const hdg = deriveCapabilities({ billingPayment: ZOHO_PAYMENT, publicPortal: HDG_PORTAL });
  assert.deepEqual(Object.keys(hdg.services), SERVICE_KEYS);
  assert.equal(hdg.services.forwarding, false);
  assert.equal(hdg.services.cancellationRequest, true);
  assert.equal(hdg.deployment, "sandbox");
  assert.equal(hdg.forwardingCheckout, null);

  const worx = deriveCapabilities({ billingPayment: STRIPE_PAYMENT, publicPortal: WORX_PORTAL });
  assert.equal(worx.deployment, "production", "sin el campo, produccion");
  assert.equal(worx.forwardingCheckout, "EMBEDDED");
  assert.equal(worx.services.forwarding, true);
});

test("services con claves de mas o de menos: solo las del contrato, lo que falta es null", () => {
  const caps = deriveCapabilities({ billingPayment: STRIPE_PAYMENT, publicPortal: { services: { forwarding: true, made_up: true } } });
  assert.deepEqual(Object.keys(caps.services), SERVICE_KEYS);
  assert.equal(caps.services.forwarding, true);
  assert.equal(caps.services.paidScans, null);
  assert.equal("made_up" in caps.services, false);
});

// ── Servicios deshabilitados ────────────────────────────────────────────────

test("reenvio apagado en el centro: sin pago de reenvio aunque el proveedor sea Stripe", () => {
  const caps = deriveCapabilities({ billingPayment: STRIPE_PAYMENT, publicPortal: { ...WORX_PORTAL, services: { ...WORX_PORTAL.services, forwarding: false } } });
  assert.equal(serviceAllowed(caps, "forwarding"), false);
  assert.equal(forwardPaymentMode(caps), FORWARD_PAYMENT_UNAVAILABLE);
});

test("reenvio apagado: la pieza pierde Forward aunque availableActions lo diga; el resto sigue", () => {
  const caps = deriveCapabilities({ billingPayment: ZOHO_PAYMENT, publicPortal: HDG_PORTAL });
  const actions = itemActions(ALL_ACTIONS, caps);
  assert.equal(actions.canRequestForward, false);
  assert.equal(actions.canRequestScan, true, "paidScans no decide si se puede pedir un escaneo incluido");
  assert.equal(actions.canRequestPickup, true);
  assert.equal(actions.canRequestDiscard, true);
});

test("services desconocidos no quitan nada; availableActions manda", () => {
  const caps = deriveCapabilities({ billingPayment: ZOHO_PAYMENT });
  assert.deepEqual(itemActions(ALL_ACTIONS, caps), ALL_ACTIONS);
});

test("las capacidades nunca dan una accion que el backend no da", () => {
  const caps = deriveCapabilities({ billingPayment: STRIPE_PAYMENT, publicPortal: WORX_PORTAL });
  const none = { canRequestScan: false, canRequestForward: false, canRequestPickup: false, canRequestDiscard: false, canRejectAssignment: false };
  assert.deepEqual(itemActions(none, caps), { ...none, billingRestricted: false });
  assert.deepEqual(itemActions(null, caps), { ...none, billingRestricted: false });
});

test("mora (billingRestricted): ninguna accion", () => {
  const actions = itemActions({ ...ALL_ACTIONS, billingRestricted: true }, deriveCapabilities({ billingPayment: STRIPE_PAYMENT }));
  assert.equal(actions.billingRestricted, true);
  for (const flag of ["canRequestScan", "canRequestForward", "canRequestPickup", "canRequestDiscard", "canRejectAssignment"]) {
    assert.equal(actions[flag], false, flag);
  }
});

test("los 409 de 'no disponible en este centro' obligan a releer las capacidades", () => {
  const conflict = (code) => ({ response: { status: 409, data: { error: "x", code } } });
  assert.equal(isCapabilityError(conflict("ONLINE_PAYMENTS_UNAVAILABLE")), true);
  assert.equal(isCapabilityError(conflict("CENTER_POLICY_NOT_CONFIGURED")), true);
  assert.equal(isCapabilityError(conflict("FORWARDING_ALREADY_PAID")), false);
  assert.equal(isCapabilityError({ response: { status: 402, data: { code: "BILLING_REQUIRED" } } }), false);
});

// ── Aislamiento entre marcas y centros ──────────────────────────────────────

test("la cache de capacidades va por organizacion y usuario", () => {
  const hollywood = sessionScope({ id: "u1", tenantId: "hdg" });
  const sandlake = sessionScope({ id: "u1", tenantId: "worx" });
  const other = sessionScope({ id: "u2", tenantId: "worx" });
  assert.notDeepEqual(billingPaymentQueryKey(hollywood), billingPaymentQueryKey(sandlake));
  assert.notDeepEqual(billingPaymentQueryKey(sandlake), billingPaymentQueryKey(other));
  assert.deepEqual(billingPaymentQueryKey(null), [BILLING_PAYMENT_QUERY_KEY, null]);

  const queryClient = new QueryClient();
  queryClient.setQueryData(billingPaymentQueryKey(hollywood), ZOHO_PAYMENT);
  queryClient.setQueryData(billingPaymentQueryKey(sandlake), STRIPE_PAYMENT);
  assert.equal(deriveCapabilities({ billingPayment: queryClient.getQueryData(billingPaymentQueryKey(hollywood)) }).provider, "ZOHO");
  assert.equal(deriveCapabilities({ billingPayment: queryClient.getQueryData(billingPaymentQueryKey(sandlake)) }).provider, "STRIPE");
  assert.equal(queryClient.getQueryData(billingPaymentQueryKey(other)), undefined, "otro usuario no hereda nada");
});

test("las invalidaciones existentes por ['client-billing-payment'] alcanzan a todas las cuentas por prefijo", async () => {
  const queryClient = new QueryClient();
  const key = billingPaymentQueryKey("worx:u1");
  queryClient.setQueryData(key, STRIPE_PAYMENT);
  await queryClient.invalidateQueries({ queryKey: ["client-billing-payment"] });
  assert.equal(queryClient.getQueryState(key).isInvalidated, true);
});

test("ninguna decision de capacidades mira la marca: todo sale de las respuestas", () => {
  for (const file of ["src/lib/capabilities.js", "src/lib/use-capabilities.js"]) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(code, /["'](hdg|the_worx|hollywood|sandlake|hallandale|hunterscreek)["']/, file);
    assert.doesNotMatch(code, /brand\.(id|tenantSlug)/, file);
  }
  const detail = read("src/app/(client)/mail-items/[id].jsx");
  const card = detail.slice(detail.indexOf("function ForwardPaymentCard("), detail.indexOf("\nfunction ", detail.indexOf("function ForwardPaymentCard(") + 10));
  assert.doesNotMatch(card, /brand\.(id|tenantSlug)|["']hdg["']/);
  const billing = read("src/app/(client)/billing.jsx");
  assert.doesNotMatch(billing, /brand\.(id|tenantSlug)\s*===|["']hdg["']/);
});

// ── Cableado en las pantallas ───────────────────────────────────────────────

test("el pago del reenvio elige el flujo por las capacidades; el de Stripe solo con Stripe", () => {
  const detail = read("src/app/(client)/mail-items/[id].jsx");
  const card = detail.slice(detail.indexOf("function ForwardPaymentCard("), detail.indexOf("\nfunction ", detail.indexOf("function ForwardPaymentCard(") + 10));
  assert.match(card, /const mode = forwardPaymentMode\(capabilities\);/);
  assert.match(card, /const payInApp = mode === FORWARD_PAYMENT_STRIPE_CHECKOUT \|\| \(!capabilities\.known && !waitingForCapabilities\);/);
  assert.match(card, /mode === FORWARD_PAYMENT_NOT_IN_APP/);
  assert.match(card, /mode === FORWARD_PAYMENT_UNAVAILABLE/);
  assert.match(card, /isCapabilityError\(error\)\) queryClient\.invalidateQueries/);
});

test("las acciones de la pieza pasan por itemActions", () => {
  const detail = read("src/app/(client)/mail-items/[id].jsx");
  const actionsCard = detail.slice(detail.indexOf("function ActionsCard("), detail.indexOf("\nfunction ", detail.indexOf("function ActionsCard(") + 10));
  assert.match(actionsCard, /const actions = itemActions\(availableActions, capabilities\);/);
  assert.doesNotMatch(actionsCard, /availableActions\?\.(canRequest|canReject|billingRestricted)/);
});

test("Facturacion comparte la consulta y enseña la vista del proveedor real", () => {
  const billing = read("src/app/(client)/billing.jsx");
  assert.match(billing, /useQuery\(billingPaymentQueryOptions\(sessionScope\(user\)\)\)/);
  assert.match(billing, /if \(view === BILLING_VIEW_ZOHO\) return <ZohoPaymentTab/);
  assert.match(billing, /if \(view !== BILLING_VIEW_STRIPE\)/);
  assert.doesNotMatch(billing, /queryKey: \["client-billing-payment"\]/);
});

test("las capacidades se refrescan al volver a primer plano", () => {
  assert.match(read("src/app/_layout.jsx"), /connectFocusToAppState\(focusManager, AppState\)/);
  assert.match(read("src/lib/use-capabilities.js"), /staleTime: CAPABILITIES_STALE_MS/);
});
