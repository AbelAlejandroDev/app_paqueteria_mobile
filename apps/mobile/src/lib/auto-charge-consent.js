/**
 * Autorizacion de cobro automatico de reenvios (HDG). Sin React, para probarlo.
 *
 * Contrato (docs/hdg-cartas-cobro-automatico.md, version
 * HDG-FWD-AUTOCHARGE-2026-11-24.3; backend 103ddd7):
 *
 *   GET /client/forwarding/auto-charge-consent
 *     { available, valid, enabled, missing, maxOfferedCents, maxAmountCents,
 *       currency, version, text, authorization }
 *     - `text` es la oferta actual completa para `maxOfferedCents`/`currency`:
 *       se ensena tal cual, con una casilla que empieza desmarcada.
 *     - `maxAmountCents` (raiz) es el maximo EFECTIVO (el menor del aceptado y
 *       el tope actual) y solo vale con `valid: true`; si no, null.
 *     - `authorization` es null o { id, centerId, maxAmountCents, currency,
 *       grantedAt, textVersion, text }; su maximo es el aceptado en su dia y
 *       su `text` el historico (null si no se pudo verificar). Aunque no sea
 *       valida (otro centro, otra version, tope apagado) se puede retirar.
 *   PUT  /client/forwarding/auto-charge-consent
 *     alta:     { enabled: true, acceptedVersion, maxAmountCents }
 *     retirada: { enabled: false }   (idempotente)
 *     Devuelve la misma forma que el GET: es lo unico que se guarda en cache.
 *     Cabecera opcional x-client-platform (ios/android).
 *
 * Reglas que no se negocian:
 *   - Nada se da por autorizado sin `valid: true` del backend. Una tarjeta
 *     guardada NO es una autorizacion.
 *   - La casilla nunca viene marcada, y se desmarca si cambia el texto, la
 *     version, el importe o la moneda de la oferta.
 *   - Sin tope configurado (MAX_NOT_CONFIGURED) o sin oferta completa (texto,
 *     version e importe), no se ofrece el alta.
 *   - El importe no esta en el codigo: sale siempre de la API.
 */

import { isStaffPreparedForward } from "./forward-form.js";

export const AUTO_CHARGE_CONSENT_PATH = "/client/forwarding/auto-charge-consent";
export const AUTO_CHARGE_CONSENT_QUERY_KEY = "client-forwarding-auto-charge-consent";

/** Retirar la autorizacion: el unico cuerpo de baja. */
export const REVOKE_CONSENT_BODY = Object.freeze({ enabled: false });

/** `missing` con los que se ofrece el alta (con la oferta completa). */
export const GRANTABLE_MISSING = Object.freeze(["CLIENT_CONSENT", "CONSENT_VERSION_OUTDATED", "CENTER_CHANGED"]);

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/-/g, "_");
}

const text = (value) => (typeof value === "string" && value.trim() ? value : null);

/** Centavos enteros > 0, o null. Un importe que falta nunca es 0. */
export function positiveCents(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Si esta app ofrece la autorizacion a este usuario: solo la marca que la
 * tiene encendida (brands/index.js, `forwardingAutoCharge`) y solo para su
 * propia organizacion. The Worx no la tiene: ni siquiera llama al endpoint.
 */
export function autoChargeConsentEnabled(tenantSlug, appBrand) {
  if (appBrand?.forwardingAutoCharge !== true) return false;
  const slug = normalizeSlug(tenantSlug);
  return Boolean(slug) && slug === normalizeSlug(appBrand?.tenantSlug);
}

/**
 * Si Settings enseña "Automatic Forwarding Charges".
 *
 * Ademas de la marca, el centro tiene que ofrecer reenvios: con
 * `services.forwarding === false` (HDG Production en su lanzamiento) la
 * pantalla solo diria "Not available", y una opcion de cobros de algo que no
 * existe parece una funcion rota (Apple 2.1). Solo un `false` explicito la
 * quita: si las capacidades fallan o no lo dicen, se sigue viendo, para que
 * quien ya autorizo pueda retirarlo siempre. Mientras cargan no sale, para que
 * no aparezca y desaparezca.
 *
 * @param {{ tenantSlug?: string, brand?: object, forwardingAllowed?: boolean|null, loading?: boolean }} input
 */
export function autoChargeSettingsVisible({ tenantSlug, brand: appBrand, forwardingAllowed = null, loading = false } = {}) {
  if (!autoChargeConsentEnabled(tenantSlug, appBrand)) return false;
  if (loading) return false;
  return forwardingAllowed !== false;
}

/** "$75.00 USD": el importe con el codigo de moneda, como pide el contrato. */
export function formatConsentAmount(cents, currency) {
  const value = positiveCents(cents);
  if (value === null) return null;
  const code = text(currency) ? currency.trim().toUpperCase() : null;
  if (!code) return null;
  const amount = (value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (code === "USD" ? "$" + amount : amount) + " " + code;
}

function readAuthorization(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: value.id ?? null,
    centerId: value.centerId ?? null,
    maxAmountCents: positiveCents(value.maxAmountCents),
    currency: text(value.currency),
    grantedAt: value.grantedAt || null,
    textVersion: text(value.textVersion),
    text: text(value.text),
  };
}

/**
 * La oferta que se puede aceptar, o null si falta algo: sin texto, version o
 * importe no hay nada que el cliente pueda leer y aceptar.
 */
function readOffer(data) {
  const maxOfferedCents = positiveCents(data?.maxOfferedCents);
  const version = text(data?.version);
  const offerText = text(data?.text);
  const currency = text(data?.currency);
  if (maxOfferedCents === null || !version || !offerText || !currency) return null;
  return {
    maxOfferedCents,
    version,
    text: offerText,
    currency,
    amountLabel: formatConsentAmount(maxOfferedCents, currency),
    // Cambia si cambia cualquier cosa de lo aceptado: la casilla se desmarca.
    key: JSON.stringify([version, maxOfferedCents, currency, offerText]),
  };
}

/**
 * Lo que la app hace con la respuesta del GET (o del PUT).
 *
 * state:
 *   "authorized"      valid: true con maximo efectivo.
 *   "not-authorized"  CLIENT_CONSENT: se ofrece la casilla.
 *   "outdated"        CONSENT_VERSION_OUTDATED: texto nuevo, aceptar otra vez.
 *   "center-changed"  CENTER_CHANGED: la anterior era de otro centro.
 *   "unavailable"     available: false, MAX_NOT_CONFIGURED o sin oferta completa.
 *   "unknown"         no hay respuesta que leer.
 */
export function describeConsent(data) {
  if (!data || typeof data !== "object") {
    return {
      state: "unknown",
      valid: false,
      missing: null,
      currency: null,
      effectiveMaxCents: null,
      effectiveMaxLabel: null,
      offer: null,
      authorization: null,
      canGrant: false,
      canRevoke: false,
    };
  }

  const authorization = readAuthorization(data.authorization);
  const currency = text(data.currency);
  const effectiveMaxCents = data.valid === true && data.enabled === true ? positiveCents(data.maxAmountCents) : null;
  // Valida, pero sin maximo efectivo: no se puede comparar nada, no se da por buena.
  const valid = effectiveMaxCents !== null && Boolean(currency);
  const missing = text(data.missing);

  const grantable = !valid && data.available === true && GRANTABLE_MISSING.includes(missing);
  const offer = grantable ? readOffer(data) : null;

  let state = "unavailable";
  if (valid) state = "authorized";
  else if (offer && missing === "CONSENT_VERSION_OUTDATED") state = "outdated";
  else if (offer && missing === "CENTER_CHANGED") state = "center-changed";
  else if (offer) state = "not-authorized";

  return {
    state,
    valid,
    missing,
    currency,
    effectiveMaxCents,
    effectiveMaxLabel: valid ? formatConsentAmount(effectiveMaxCents, currency) : null,
    offer,
    authorization,
    canGrant: Boolean(offer),
    // Retirar es siempre posible si hay algo que retirar, valido o no.
    canRevoke: valid || Boolean(authorization),
  };
}

/** El cuerpo del alta: la version y el importe de la oferta que se ENSENO. */
export function grantConsentBody(offer) {
  if (!offer || positiveCents(offer.maxOfferedCents) === null || !text(offer.version)) {
    throw new Error("AUTO_CHARGE_OFFER_INCOMPLETE");
  }
  return { enabled: true, acceptedVersion: offer.version, maxAmountCents: offer.maxOfferedCents };
}

/** Cabecera opcional del rastro: solo ios/android. */
export function consentPlatformHeaders(platform) {
  return platform === "ios" || platform === "android" ? { "x-client-platform": platform } : {};
}

/** Si la casilla sigue valiendo para la oferta actual (se desmarca si cambia). */
export function isOfferAccepted(acceptedKey, offer) {
  return Boolean(offer) && typeof acceptedKey === "string" && acceptedKey === offer.key;
}

/**
 * Que decir de un error del PUT. `refetch`: la oferta pudo cambiar, hay que
 * volver a leerla (y la casilla se desmarca). Nada se guarda como aceptado.
 */
export function consentErrorOutcome(error) {
  if (!error?.response) {
    return {
      kind: "unknown",
      refetch: true,
      message: "We couldn't confirm the change. Nothing is saved until your center confirms it. Pull down to check the current status.",
    };
  }
  const { status, data } = error.response;
  const code = data?.code;
  if (code === "AUTO_CHARGE_CONSENT_VERSION_MISMATCH") {
    return { kind: "outdated", refetch: true, message: "The authorization text was updated. Read the new text and check the box again." };
  }
  if (code === "AUTO_CHARGE_MAX_ABOVE_CAP") {
    return { kind: "cap-changed", refetch: true, message: "The maximum your center offers has changed. Review the new amount and check the box again." };
  }
  if (code === "AUTO_CHARGE_MAX_REQUIRED") {
    return { kind: "invalid", refetch: true, message: "The maximum amount is missing. Pull down to refresh and try again." };
  }
  if (code === "AUTO_CHARGE_NOT_AVAILABLE") {
    return { kind: "unavailable", refetch: true, message: "Automatic charges aren't available for your account right now." };
  }
  if (status === 400) {
    return { kind: "invalid", refetch: true, message: "The authorization couldn't be saved. Pull down to refresh and try again." };
  }
  if (status >= 500) {
    return { kind: "temporary", refetch: true, message: "The authorization couldn't be saved right now. Please try again in a few minutes." };
  }
  return { kind: "error", refetch: true, message: (typeof data?.error === "string" && data.error) || "The authorization couldn't be saved." };
}

// ── Cobro iniciado por el centro ────────────────────────────────────────────

const centsOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/**
 * Total estimado de un reenvio preparado por el centro:
 * (repricedAmount ?? quotedAmountCents) + Mail Forwarding Fee, con el fee de
 * GET /client/forwarding/immediate-preview. null si falta algo.
 *
 * El mismo orden que el backend (forwardingPayments.amountForPayment):
 * `acceptedRepricedAmount` NO cuenta, porque aceptar una subida no puede ganarle
 * a un precio vigente mas bajo. Los dos campos viajan en forwardDetails
 * (controllers/client/mailItems/shared/selects.js).
 */
export function estimatedForwardCharge(details, feeCents) {
  const d = details || {};
  const base = centsOrNull(d.repricedAmount) ?? centsOrNull(d.quotedAmountCents);
  const fee = typeof feeCents === "number" && Number.isInteger(feeCents) && feeCents >= 0 ? feeCents : null;
  if (base === null || base <= 0 || fee === null) {
    return { shippingAndHandling: base !== null && base > 0 ? base : null, mailForwardingFee: fee, total: null };
  }
  return { shippingAndHandling: base, mailForwardingFee: fee, total: base + fee };
}

/**
 * Si el cliente puede esperar al cobro del centro en vez de Review & Pay.
 *
 * Solo en READY_FOR_PAYMENT, para cartas y sobres grandes, con autorizacion
 * valida y el total estimado dentro del maximo efectivo. En cualquier otro caso
 * (sin autorizacion, por encima del maximo, sin total, otra moneda, otro tipo)
 * se queda el pago manual de siempre.
 *
 * @returns {{ mode: "staff-charge", totalCents, maxCents, maxLabel, charge } | { mode: "manual", reason }}
 */
export function staffChargeDecision({ itemType, details, consent, feeCents }) {
  const d = details || {};
  if (!isStaffPreparedForward(itemType)) return { mode: "manual", reason: "NOT_ELIGIBLE" };
  if (d.paymentStatus !== "READY_FOR_PAYMENT") return { mode: "manual", reason: "STATUS" };
  if (!consent?.valid || consent.effectiveMaxCents === null) return { mode: "manual", reason: "NOT_AUTHORIZED" };
  // forwardDetails no trae `currency`: la del cobro es, como en el backend
  // (currencyForPayment), la aceptada, la recotizada o la cotizada. Sin
  // ninguna, el backend cobra en USD; aqui no se compara (y el backend vuelve
  // a comprobar la moneda antes de cobrar: CURRENCY_MISMATCH).
  const detailsCurrency = text(d.acceptedRepricedCurrency) || text(d.repricedCurrency) || text(d.quotedCurrency);
  if (detailsCurrency && detailsCurrency.toUpperCase() !== String(consent.currency).toUpperCase()) {
    return { mode: "manual", reason: "CURRENCY_MISMATCH" };
  }
  const charge = estimatedForwardCharge(d, feeCents);
  if (charge.total === null) return { mode: "manual", reason: "TOTAL_UNKNOWN" };
  if (charge.total > consent.effectiveMaxCents) return { mode: "manual", reason: "LIMIT_EXCEEDED" };
  return {
    mode: "staff-charge",
    totalCents: charge.total,
    maxCents: consent.effectiveMaxCents,
    maxLabel: consent.effectiveMaxLabel,
    charge,
  };
}

/**
 * prepare-payment sin pagina (`paymentUrl: null`) porque el centro ya tiene un
 * cobro en curso o sin confirmar: se consulta el estado, nunca otro intento.
 */
export const COLLECT_PENDING_REASONS = Object.freeze(["COLLECT_IN_PROGRESS", "COLLECT_UNCONFIRMED"]);

export function collectPendingReason(data) {
  if (!data || typeof data !== "object" || text(data.paymentUrl)) return null;
  const reason = text(data.reason) || text(data.autoCharge?.reason) || text(data.code);
  return COLLECT_PENDING_REASONS.includes(reason) ? reason : null;
}
