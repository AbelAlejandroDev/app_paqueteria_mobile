/**
 * Capacidades del centro y del usuario. Sin React, para poder probarlo; el hook
 * es lib/use-capabilities.
 *
 * Fuente principal: GET /client/capabilities (contrato v1, backend 348c327,
 * docs/mobile/capacidades-y-health.md y src/lib/clientCapabilities.js). El
 * centro lo decide el backend por el buzon de la sesion; no llama a Zoho,
 * Stripe ni Pitney. Las capacidades NO autorizan nada: solo dicen que pintar.
 * Cada ruta sigue aplicando su guarda y la app sigue tratando sus 402/409.
 *
 * Reglas:
 *   - Tres valores: true, false o null (no se sabe). Lo que no da el backend
 *     no se rellena.
 *   - Stripe y Zoho no funcionan igual: el flujo de pago sale de
 *     `forwarding.checkout` y `forwarding.methods`, no se supone.
 *   - Nada de `if (marca)`: todo sale de la respuesta. La marca solo sirve para
 *     comprobar que la respuesta es de la organizacion de esta app.
 */

export const CAPABILITIES_CONTRACT_VERSION = 1;
export const CAPABILITIES_QUERY_KEY = "client-capabilities";

export const PROVIDER_STRIPE = "STRIPE";
export const PROVIDER_ZOHO = "ZOHO";

/** Claves de `services` (backend lib/jobPolicies.portalServices). */
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

const ENVIRONMENTS = ["sandbox", "production", "unspecified"];
const CHECKOUTS = ["EMBEDDED", "HOSTED"];
const PAYMENT_METHOD_MANAGEMENT = ["STRIPE_PORTAL", "ZOHO_HOSTED", "NONE"];

/** Zoho no se relee mas a menudo (backend STATUS_CHECK_INTERVAL_MS). Nunca por debajo. */
export const MIN_PAYMENT_STATUS_POLL_SECONDS = 15;

/**
 * Clave de cada consulta por ambito de sesion (organizacion:usuario): lo de un
 * centro nunca se sirve a la cuenta de otro, aunque la cache no se hubiera
 * vaciado (que si se vacia: lib/session-scope).
 */
export function capabilitiesQueryKey(scope) {
  return [CAPABILITIES_QUERY_KEY, scope ?? null];
}

/** GET /client/billing/payment (Facturacion; con Zoho lee Zoho en el momento). */
export const BILLING_PAYMENT_QUERY_KEY = "client-billing-payment";

export function billingPaymentQueryKey(scope) {
  return [BILLING_PAYMENT_QUERY_KEY, scope ?? null];
}

const triState = (value) => (value === true ? true : value === false ? false : null);
const oneOf = (value, allowed) => (allowed.includes(value) ? value : null);
const normalizeSlug = (value) => String(value || "").trim().toLowerCase() || null;

function pickServices(services) {
  if (!services || typeof services !== "object") return null;
  const out = {};
  for (const key of SERVICE_KEYS) out[key] = triState(services[key]);
  return out;
}

function pickZoho(zoho) {
  if (!zoho || typeof zoho !== "object") return null;
  return {
    available: triState(zoho.available),
    unavailableReason: typeof zoho.unavailableReason === "string" ? zoho.unavailableReason : null,
    payInvoices: triState(zoho.payInvoices),
    updateCard: triState(zoho.updateCard),
    addPaymentMethod: triState(zoho.addPaymentMethod),
  };
}

function pickForwarding(forwarding) {
  const f = forwarding && typeof forwarding === "object" ? forwarding : {};
  const minPoll = Number(f.paymentStatusMinPollSeconds);
  return {
    available: triState(f.available),
    payments: triState(f.payments),
    checkout: oneOf(f.checkout, CHECKOUTS),
    methods: Array.isArray(f.methods) ? f.methods.filter((m) => typeof m === "string") : [],
    returnDetection: f.returnDetection === "PAYMENT_STATUS_POLL" ? "PAYMENT_STATUS_POLL" : null,
    paymentStatusMinPollSeconds: Number.isFinite(minPoll) && minPoll > 0 ? minPoll : null,
  };
}

function pickRestrictions(restrictions) {
  if (!restrictions || typeof restrictions !== "object") return null;
  const hold = restrictions.billingHold || {};
  return {
    billingHold: {
      active: hold.active === true,
      code: hold.code === "BILLING_REQUIRED" ? "BILLING_REQUIRED" : null,
      reason: typeof hold.reason === "string" && hold.reason.trim() ? hold.reason.trim() : null,
    },
    mailboxActive: triState(restrictions.mailboxActive),
    uspsComplianceStatus: typeof restrictions.uspsComplianceStatus === "string" ? restrictions.uspsComplianceStatus : null,
    accountClosureScheduledAt: typeof restrictions.accountClosureScheduledAt === "string" ? restrictions.accountClosureScheduledAt : null,
    accountDeletionInProgress: triState(restrictions.accountDeletionInProgress),
  };
}

/**
 * `legal` (backend 51ee69d): `{ privacyPolicyUrl: string | null }`. Un backend
 * anterior no lo manda: entonces null ("no se sabe"), que no es lo mismo que
 * `{ privacyPolicyUrl: null }` ("no hay politica configurada": no se enseña).
 */
function pickLegal(legal) {
  if (!legal || typeof legal !== "object") return null;
  return { privacyPolicyUrl: typeof legal.privacyPolicyUrl === "string" ? legal.privacyPolicyUrl : null };
}

const UNKNOWN = Object.freeze({
  known: false,
  reason: "NOT_LOADED",
  environment: null,
  tenantSlug: null,
  center: null,
  provider: null,
  onlinePayments: null,
  billingPortal: null,
  invoices: null,
  paymentMethodManagement: null,
  zoho: null,
  forwarding: pickForwarding(null),
  services: null,
  legal: null,
  restrictions: null,
});

/**
 * @param {object} sources
 * @param {object|null} [sources.capabilities] - cuerpo de GET /client/capabilities
 * @param {string} [sources.expectedTenantSlug] - la organizacion de esta app (brand.tenantSlug)
 */
export function deriveCapabilities({ capabilities = null, expectedTenantSlug } = {}) {
  if (!capabilities || typeof capabilities !== "object") return { ...UNKNOWN };

  // Un contrato que no se conoce no se interpreta: mejor "no se sabe" que leerlo mal.
  if (capabilities.contractVersion !== CAPABILITIES_CONTRACT_VERSION) {
    return { ...UNKNOWN, reason: "UNSUPPORTED_CONTRACT" };
  }

  const tenantSlug = normalizeSlug(capabilities.tenant?.slug);
  // Las capacidades de otra organizacion no valen para esta app (y la sesion
  // tampoco: lo comprueba AuthContext con el usuario).
  if (expectedTenantSlug && tenantSlug !== normalizeSlug(expectedTenantSlug)) {
    return { ...UNKNOWN, reason: "TENANT_MISMATCH", tenantSlug };
  }

  const billing = capabilities.billing || {};
  return {
    known: true,
    reason: null,
    environment: oneOf(capabilities.environment, ENVIRONMENTS),
    tenantSlug,
    center: capabilities.center && typeof capabilities.center === "object"
      ? { slug: capabilities.center.slug ?? null, displayName: capabilities.center.displayName ?? null }
      : null,
    provider: oneOf(billing.provider, [PROVIDER_STRIPE, PROVIDER_ZOHO]),
    onlinePayments: triState(billing.onlinePayments),
    billingPortal: triState(billing.billingPortal),
    invoices: triState(billing.invoices),
    paymentMethodManagement: oneOf(billing.paymentMethodManagement, PAYMENT_METHOD_MANAGEMENT),
    zoho: pickZoho(billing.zoho),
    forwarding: pickForwarding(capabilities.forwarding),
    services: pickServices(capabilities.services),
    legal: pickLegal(capabilities.legal),
    restrictions: pickRestrictions(capabilities.restrictions),
  };
}

/** true / false / null: si el centro tiene ese servicio. null = no se sabe. */
export function serviceAllowed(capabilities, key) {
  return triState(capabilities?.services?.[key]);
}

/** La retencion por impago (402 BILLING_REQUIRED en las solicitudes de servicio). */
export function billingHold(capabilities) {
  return capabilities?.restrictions?.billingHold?.active === true ? capabilities.restrictions.billingHold : null;
}

// ── Pago del reenvio ────────────────────────────────────────────────────────

export const FORWARD_PAYMENT_STRIPE_CHECKOUT = "stripe-checkout";
export const FORWARD_PAYMENT_ZOHO_HOSTED = "zoho-hosted";
export const FORWARD_PAYMENT_UNAVAILABLE = "unavailable";
export const FORWARD_PAYMENT_UNKNOWN = "unknown";

/**
 * Como se paga un reenvio ya creado en esta cuenta.
 *
 * - EMBEDDED con CHECKOUT_SESSION: el Checkout alojado de Stripe (POST
 *   checkout-session), el flujo que ya usa la app con The Worx.
 * - HOSTED con HOSTED_PAGE: factura de Zoho, tarjeta guardada (SAVED_CARD) o
 *   pagina segura de Zoho (lib/zoho-forward-payment).
 * - forwarding.payments false: no se paga desde la app.
 *
 * `forwarding.available` (services.forwarding) es para PEDIR un reenvio
 * (quotes, quotes/select); pagar uno que ya existe lo decide
 * requireForwardingPayments, que es `forwarding.payments`.
 */
export function forwardPaymentMode(capabilities) {
  if (!capabilities?.known) return FORWARD_PAYMENT_UNKNOWN;
  const forwarding = capabilities.forwarding || {};
  if (forwarding.payments !== true) return FORWARD_PAYMENT_UNAVAILABLE;
  if (forwarding.checkout === "EMBEDDED" && forwarding.methods.includes("CHECKOUT_SESSION")) {
    return FORWARD_PAYMENT_STRIPE_CHECKOUT;
  }
  if (forwarding.checkout === "HOSTED" && forwarding.methods.includes("HOSTED_PAGE")) return FORWARD_PAYMENT_ZOHO_HOSTED;
  return FORWARD_PAYMENT_UNAVAILABLE;
}

/** Si se puede intentar la tarjeta guardada de Zoho (useSavedCard). */
export function savedCardAllowed(capabilities) {
  return forwardPaymentMode(capabilities) === FORWARD_PAYMENT_ZOHO_HOSTED && capabilities.forwarding.methods.includes("SAVED_CARD");
}

/** Cada cuanto, como poco, se pregunta payment-status (nunca menos de 15 s). */
export function paymentStatusMinPollMs(capabilities) {
  const seconds = capabilities?.forwarding?.paymentStatusMinPollSeconds;
  return Math.max(MIN_PAYMENT_STATUS_POLL_SECONDS, Number(seconds) || 0) * 1000;
}

// ── Facturacion ─────────────────────────────────────────────────────────────

export const BILLING_VIEW_STRIPE = "stripe";
export const BILLING_VIEW_ZOHO = "zoho";
export const BILLING_VIEW_UNKNOWN = "unknown";

/** Que pantalla de pago enseñar. */
export function billingView(capabilities) {
  if (capabilities?.provider === PROVIDER_STRIPE) return BILLING_VIEW_STRIPE;
  if (capabilities?.provider === PROVIDER_ZOHO) return BILLING_VIEW_ZOHO;
  return BILLING_VIEW_UNKNOWN;
}

/** Acciones de Zoho (paginas seguras) que se pueden ofrecer. Todas false si Zoho no esta disponible. */
export function zohoBillingActions(capabilities) {
  const zoho = capabilities?.zoho;
  const usable = capabilities?.paymentMethodManagement === "ZOHO_HOSTED" && zoho?.available === true;
  return {
    available: usable,
    unavailableReason: usable ? null : zoho?.unavailableReason || null,
    payInvoices: usable && zoho.payInvoices === true,
    updateCard: usable && zoho.updateCard === true,
    addPaymentMethod: usable && zoho.addPaymentMethod === true,
  };
}

// ── Acciones de una pieza ───────────────────────────────────────────────────

const ITEM_ACTION_FLAGS = ["canRequestScan", "canRequestForward", "canRequestPickup", "canRequestDiscard", "canRejectAssignment"];

/**
 * Las acciones de una pieza: las de `availableActions` del backend, que manda.
 * Las capacidades solo pueden quitar: services.forwarding === false quita
 * Forward, y la retencion por impago (billingHold, igual que billingRestricted)
 * quita todas.
 */
export function itemActions(availableActions, capabilities) {
  const actions = availableActions || {};
  const restricted = actions.billingRestricted === true || Boolean(billingHold(capabilities));
  const out = { billingRestricted: restricted };

  for (const flag of ITEM_ACTION_FLAGS) {
    const blockedByService = flag === "canRequestForward" && serviceAllowed(capabilities, "forwarding") === false;
    out[flag] = !restricted && actions[flag] === true && !blockedByService;
  }
  return out;
}

/**
 * Errores de guarda que obligan a releer las capacidades (contrato §1: "tras
 * cualquier 402/409 de una guarda").
 */
export const CAPABILITY_ERROR_CODES = [
  "ONLINE_PAYMENTS_UNAVAILABLE",
  "CENTER_POLICY_NOT_CONFIGURED",
  "BILLING_PROVIDER_NOT_STRIPE",
  "BILLING_PROVIDER_NOT_ZOHO",
  "ZOHO_FORWARDING_PAYMENTS_UNAVAILABLE",
  "ZOHO_ACCOUNT_NOT_CONFIGURED",
  "ZOHO_ENVIRONMENT_NOT_ENABLED",
  "ZOHO_CUSTOMER_NOT_LINKED",
];

export function isCapabilityError(error) {
  const status = error?.response?.status;
  const code = error?.response?.data?.code;
  if (status === 402 && code === "BILLING_REQUIRED") return true;
  return (status === 409 || status === 404) && CAPABILITY_ERROR_CODES.includes(code);
}
