/**
 * Capacidades del centro y del usuario, a partir de respuestas reales del
 * backend. Sin React, para poder probarlo; el hook es lib/use-capabilities.
 *
 * Fuentes (contrato: docs/operacion/HDG_MOBILE_HANDOFF.md del backend):
 *
 *   1. GET /client/billing/payment (con sesion). `billing` =
 *      billingCapabilitiesForCenter: { provider: "STRIPE"|"ZOHO", onlinePayments,
 *      billingPortal, invoices, forwardingPayments, forwardingPaymentProvider }.
 *      Ademas `billingPortal { available, unavailableReason }` y, con Zoho,
 *      `zoho { cards, invoices, payments, actions }` y `zohoUnavailable`.
 *   2. GET /public/portal: `billing { ..., forwardingCheckout }`, `services.*`
 *      y `deployment`. Necesita un portal resuelto por Origin/Referer/Host, que
 *      una app nativa no tiene: hoy NO se consulta (PUBLIC_PORTAL_SOURCE y
 *      docs/backend-contract-gaps.md). Si llega a existir, se pasa aqui.
 *   3. Por pieza: `availableActions` de GET /client/mail-items/:id, que el
 *      backend ya calcula con las reglas del centro (canRequestForward respeta
 *      services.forwarding) y con la mora (billingRestricted).
 *
 * Reglas:
 *   - Tres valores: true, false o null (no se sabe). Lo que no da el backend
 *     no se rellena: null no es false ni true.
 *   - Stripe y Zoho no funcionan igual: el flujo de pago se elige por
 *     `forwardingPaymentProvider`, no se supone.
 *   - Nada de `if (marca)`: todo sale de las respuestas.
 */

export const PROVIDER_STRIPE = "STRIPE";
export const PROVIDER_ZOHO = "ZOHO";

/** Las claves de `services` en GET /public/portal (backend src/lib/jobPolicies.js, portalServices). */
export const SERVICE_KEYS = [
  "forwarding",
  "immediateForwarding",
  "scheduledForwarding",
  "storageFees",
  "paidScans",
  "autoScan",
  "planChange",
  "cancellationRequest",
];

/**
 * Clave de GET /client/billing/payment, con el ambito de la sesion
 * (organizacion:usuario): las capacidades de un centro nunca se sirven a la
 * cuenta de otro, aunque la cache no se hubiera vaciado (que si se vacia:
 * lib/session-scope). Las invalidaciones por ["client-billing-payment"] valen
 * por prefijo.
 */
export const BILLING_PAYMENT_QUERY_KEY = "client-billing-payment";

export function billingPaymentQueryKey(scope) {
  return [BILLING_PAYMENT_QUERY_KEY, scope ?? null];
}

/** Por que no se usa /public/portal desde la app (ver docs/backend-contract-gaps.md). */
export const PUBLIC_PORTAL_SOURCE = Object.freeze({
  available: false,
  reason: "PUBLIC_PORTAL_REQUIRES_ORIGIN",
});

const triState = (value) => (value === true ? true : value === false ? false : null);

function pickServices(services) {
  if (!services || typeof services !== "object") return null;
  const out = {};
  for (const key of SERVICE_KEYS) out[key] = triState(services[key]);
  return out;
}

function zohoSummary(billingPayment) {
  const zoho = billingPayment?.zoho;
  const cards = Array.isArray(zoho?.cards)
    ? zoho.cards.map((card) => ({
        last4: card?.last4 ?? null,
        expMonth: card?.expMonth ?? null,
        expYear: card?.expYear ?? null,
      }))
    : [];
  const actions = zoho?.actions || {};
  return {
    loaded: Boolean(zoho),
    // Si Zoho no respondio: la pantalla sigue, sin estos datos.
    unavailable: billingPayment?.zohoUnavailable || null,
    cards,
    actions: {
      updateCard: triState(actions.updateCard),
      addPaymentMethod: triState(actions.addPaymentMethod),
      payInvoices: triState(actions.payInvoices),
    },
  };
}

/**
 * @param {object} sources
 * @param {object|null} [sources.billingPayment] - cuerpo de GET /client/billing/payment
 * @param {object|null} [sources.publicPortal] - cuerpo de GET /public/portal, si se tuviera
 */
export function deriveCapabilities({ billingPayment = null, publicPortal = null } = {}) {
  const billing = billingPayment?.billing || null;
  const portalBilling = publicPortal?.billing || null;
  const provider = billing?.provider === PROVIDER_STRIPE || billing?.provider === PROVIDER_ZOHO ? billing.provider : null;

  const fromBilling = (key) => triState(billing ? billing[key] : portalBilling?.[key]);

  return {
    /** Si hay datos con sesion (billing/payment). Sin ellos todo es null. */
    known: Boolean(billing),
    provider,
    onlinePayments: fromBilling("onlinePayments"),
    billingPortal: fromBilling("billingPortal"),
    invoices: fromBilling("invoices"),
    // El portal de facturacion de Stripe de ESTA cuenta (puede no estarlo aunque el centro lo tenga).
    billingPortalAvailable: billingPayment ? billingPayment.billingPortal?.available === true : null,
    billingPortalUnavailableReason: billingPayment?.billingPortal?.unavailableReason || null,
    forwardingPayments: fromBilling("forwardingPayments"),
    forwardingPaymentProvider:
      billing?.forwardingPaymentProvider === PROVIDER_STRIPE || billing?.forwardingPaymentProvider === PROVIDER_ZOHO
        ? billing.forwardingPaymentProvider
        : null,
    // Solo lo da /public/portal ("EMBEDDED" | "HOSTED" | null); no se deduce.
    forwardingCheckout: portalBilling ? portalBilling.forwardingCheckout ?? null : null,
    services: pickServices(publicPortal?.services),
    // /public/portal solo trae `deployment: "sandbox"`; sin el campo, produccion.
    deployment: publicPortal ? (publicPortal.deployment === "sandbox" ? "sandbox" : "production") : null,
    zoho: provider === PROVIDER_ZOHO ? zohoSummary(billingPayment) : null,
    sources: {
      billingPayment: Boolean(billingPayment),
      publicPortal: Boolean(publicPortal),
    },
  };
}

/** true / false / null: si el centro tiene ese servicio. null = no se sabe. */
export function serviceAllowed(capabilities, key) {
  return triState(capabilities?.services?.[key]);
}

// ── Pago del reenvio ────────────────────────────────────────────────────────

export const FORWARD_PAYMENT_STRIPE_CHECKOUT = "stripe-checkout";
export const FORWARD_PAYMENT_NOT_IN_APP = "not-in-app";
export const FORWARD_PAYMENT_UNAVAILABLE = "unavailable";
export const FORWARD_PAYMENT_UNKNOWN = "unknown";

/**
 * Como se paga un reenvio en esta cuenta.
 *
 * - Stripe: Checkout alojado de Stripe (POST checkout-session), el flujo que
 *   ya usa la app; el backend lo admite solo con Stripe (requireStripeBilling).
 * - Zoho: factura de Zoho + tarjeta guardada o pagina de Zoho (prepare-payment
 *   con useSavedCard). Es otro flujo, todavia no esta en la app: no se le
 *   ofrece el de Stripe (daria 409 ONLINE_PAYMENTS_UNAVAILABLE).
 * - forwardingPayments false (o el servicio de reenvio apagado): no se paga
 *   desde la app.
 * - Sin datos todavia: unknown (la pantalla espera; si fallo la carga, deja
 *   intentarlo y el backend decide sin cobrar nada).
 */
export function forwardPaymentMode(capabilities) {
  if (!capabilities?.known) return FORWARD_PAYMENT_UNKNOWN;
  if (serviceAllowed(capabilities, "forwarding") === false) return FORWARD_PAYMENT_UNAVAILABLE;
  if (capabilities.forwardingPayments !== true) return FORWARD_PAYMENT_UNAVAILABLE;
  if (capabilities.forwardingPaymentProvider === PROVIDER_STRIPE) return FORWARD_PAYMENT_STRIPE_CHECKOUT;
  if (capabilities.forwardingPaymentProvider === PROVIDER_ZOHO) return FORWARD_PAYMENT_NOT_IN_APP;
  return FORWARD_PAYMENT_UNAVAILABLE;
}

// ── Facturacion ─────────────────────────────────────────────────────────────

export const BILLING_VIEW_STRIPE = "stripe";
export const BILLING_VIEW_ZOHO = "zoho";
export const BILLING_VIEW_UNKNOWN = "unknown";

/** Que pantalla de pago enseñar: la de Stripe, la de Zoho, o nada concreto. */
export function billingView(capabilities) {
  if (capabilities?.provider === PROVIDER_STRIPE) return BILLING_VIEW_STRIPE;
  if (capabilities?.provider === PROVIDER_ZOHO) return BILLING_VIEW_ZOHO;
  return BILLING_VIEW_UNKNOWN;
}

// ── Acciones de una pieza ───────────────────────────────────────────────────

const ITEM_ACTION_SERVICE = {
  // canRequestForward ya lo calcula el backend con services.forwarding; si la
  // app llegara a conocer services, solo puede quitar, nunca dar.
  canRequestForward: "forwarding",
};

const ITEM_ACTION_FLAGS = ["canRequestScan", "canRequestForward", "canRequestPickup", "canRequestDiscard", "canRejectAssignment"];

/**
 * Las acciones de una pieza: las de `availableActions` del backend, que manda.
 * Las capacidades del centro solo pueden quitar (services.forwarding === false),
 * y la mora (billingRestricted) las quita todas, como hace el backend.
 */
export function itemActions(availableActions, capabilities) {
  const actions = availableActions || {};
  const restricted = actions.billingRestricted === true;
  const out = { billingRestricted: restricted };

  for (const flag of ITEM_ACTION_FLAGS) {
    const service = ITEM_ACTION_SERVICE[flag];
    out[flag] = !restricted && actions[flag] === true && (!service || serviceAllowed(capabilities, service) !== false);
  }
  return out;
}

/** Errores del backend que dicen "esto no esta disponible en este centro": hay que releer las capacidades. */
export const CAPABILITY_ERROR_CODES = [
  "ONLINE_PAYMENTS_UNAVAILABLE",
  "CENTER_POLICY_NOT_CONFIGURED",
  "BILLING_PROVIDER_NOT_STRIPE",
  "BILLING_PROVIDER_NOT_ZOHO",
  "ZOHO_FORWARDING_PAYMENTS_UNAVAILABLE",
];

export function isCapabilityError(error) {
  return error?.response?.status === 409 && CAPABILITY_ERROR_CODES.includes(error.response.data?.code);
}
