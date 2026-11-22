/**
 * Add Tracking y Add Insurance en el reenvio: lo que el cliente elige es lo que
 * se cotiza, se compra y se cobra (backend 7de1ae9, filtrado estricto).
 *
 * Reglas que la app NO decide, solo respeta y explica:
 *   - Las dos casillas empiezan apagadas y solo las cambia el cliente. Ningun
 *     boton ni respuesta del servidor las enciende solo.
 *   - Cartas: Insurance ON con Tracking OFF no existe (el seguro solo va en un
 *     servicio rastreado), asi que la peticion no se manda.
 *   - Paquetes: todos los servicios disponibles llevan seguimiento, asi que con
 *     Tracking OFF el backend responde 422 sin tarifas; la app lo explica y
 *     ofrece encenderlo, sin encenderlo ella.
 *   - Paquetes y sobres grandes (LARGE_ENVELOPE, parcelType FLAT): el seguro
 *     adicional no se contrata, asi que la casilla esta deshabilitada y nunca se
 *     pide (el backend responde 422 INSURANCE_NOT_AVAILABLE_FOR_PACKAGES).
 *   - Sobres grandes: Tracking OFF puede tener tarifas (USPS First-Class Flat
 *     sin seguimiento). Que haya o no tarifas lo dice el backend; la app solo
 *     filtra por `trackingIncluded`.
 *   - "Tracking included" e "Insured" se enseñan solo si la tarifa lo trae:
 *     `trackingIncluded` y el servicio especial `Ins` con su valor. El valor
 *     declarado no es un seguro.
 *
 * Sin React ni red: lo usan mail-items/[id].jsx y letter-forward-sheet.jsx, y
 * tests/forwarding-options.test.mjs lo prueba con respuestas simuladas.
 */

export const INSURED_VALUE_MIN_USD = 100;
export const INSURED_VALUE_MAX_USD = 5000;

export const PACKAGE_INSURANCE_UNAVAILABLE_MESSAGE = "Additional insurance is not available for packages yet.";
export const LARGE_ENVELOPE_INSURANCE_UNAVAILABLE_MESSAGE = "Additional insurance is not available for large envelopes yet.";
const ITEM_INSURANCE_UNAVAILABLE_MESSAGE = "Additional insurance is not available for this item yet.";
export const INSURANCE_REQUIRES_TRACKING_MESSAGE =
  "Insurance is only available with a tracked service. Turn on Add Tracking to add insurance.";
export const QUOTE_INVALID_MESSAGE =
  "These rates no longer match the options you chose. Get new rates before continuing.";

/** Motivos de 422 FORWARDING_NO_COMPATIBLE_RATES (compatibility.reason). */
export const COMPATIBILITY_REASONS = Object.freeze({
  TRACKING_INCLUDED_IN_AVAILABLE_SERVICES: "TRACKING_INCLUDED_IN_AVAILABLE_SERVICES",
  INSURANCE_REQUIRES_TRACKED_SERVICE: "INSURANCE_REQUIRES_TRACKED_SERVICE",
  INSURANCE_NOT_AVAILABLE_FOR_SERVICES: "INSURANCE_NOT_AVAILABLE_FOR_SERVICES",
  NO_SERVICE_MATCHES_OPTIONS: "NO_SERVICE_MATCHES_OPTIONS",
});

const COMPATIBILITY_TEXT = {
  TRACKING_INCLUDED_IN_AVAILABLE_SERVICES:
    "Every shipping service available for this item includes tracking. Turn on Add Tracking to see rates.",
  INSURANCE_REQUIRES_TRACKED_SERVICE:
    "Insurance is only available with a tracked service. Turn on Add Tracking to see insured rates.",
  INSURANCE_NOT_AVAILABLE_FOR_SERVICES:
    "None of the services available for this shipment can add insurance. Turn off Add Insurance to see rates.",
  NO_SERVICE_MATCHES_OPTIONS: "No shipping service matches the options you chose. Try changing Add Tracking or Add Insurance.",
};

/** 409 con los que una cotizacion o su tarifa ya no valen: hay que volver a cotizar. */
export const QUOTE_INVALID_CODES = Object.freeze([
  "FORWARDING_QUOTE_OUTDATED",
  "FORWARDING_RATE_OPTIONS_MISMATCH",
  "FORWARDING_QUOTE_OPTIONS_MISMATCH",
  "FORWARD_TRACKING_MISMATCH",
  "FORWARD_INSURANCE_MISMATCH",
]);

const normalizedType = (itemType) => String(itemType || "").trim().toUpperCase();

/**
 * Si la pantalla de cotizacion puede pedir seguro adicional para este tipo.
 * Solo cartas (que lo piden en su formulario, letterForward); ni paquetes ni
 * sobres grandes.
 */
export function insuranceAvailableFor(itemType) {
  return normalizedType(itemType) === "LETTER";
}

/** El texto de la casilla deshabilitada segun el tipo de pieza. */
export function insuranceUnavailableMessage(itemType) {
  const type = normalizedType(itemType);
  if (type === "PACKAGE") return PACKAGE_INSURANCE_UNAVAILABLE_MESSAGE;
  if (type === "LARGE_ENVELOPE") return LARGE_ENVELOPE_INSURANCE_UNAVAILABLE_MESSAGE;
  return ITEM_INSURANCE_UNAVAILABLE_MESSAGE;
}

/**
 * "$1,250.50" -> 125050. null si no es un importe en dolares con dos decimales
 * como mucho (lo escrito no se redondea a algo distinto de lo que se ve).
 */
export function parseInsuredValueCents(text) {
  const cleaned = String(text ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Que le falta al valor declarado, o null si esta entre $100 y $5,000. */
export function insuredValueProblem(text) {
  if (!String(text ?? "").trim()) return "Enter the declared value to insure.";
  const cents = parseInsuredValueCents(text);
  const range =
    "The declared value must be between $" + INSURED_VALUE_MIN_USD + " and $" + INSURED_VALUE_MAX_USD.toLocaleString("en-US") + ".";
  if (cents === null) return range;
  if (cents < INSURED_VALUE_MIN_USD * 100 || cents > INSURED_VALUE_MAX_USD * 100) return range;
  return null;
}

/**
 * Por que estas opciones no se pueden pedir, o null. Lo comprueba antes de
 * tocar la red; el backend lo vuelve a comprobar.
 * @param {{ itemType?: string, letterForward?: boolean, trackingRequested?: boolean, insuranceRequested?: boolean, insuredValue?: string }} options
 */
export function shippingOptionsProblem({ itemType, letterForward = false, trackingRequested = false, insuranceRequested = false, insuredValue = "" } = {}) {
  if (!insuranceRequested) return null;
  if (!letterForward && !insuranceAvailableFor(itemType)) {
    return { code: "INSURANCE_NOT_AVAILABLE_FOR_PACKAGES", message: insuranceUnavailableMessage(itemType) };
  }
  if (letterForward && !trackingRequested) {
    return { code: "INSURANCE_REQUIRES_TRACKED_SERVICE", message: INSURANCE_REQUIRES_TRACKING_MESSAGE };
  }
  const valueProblem = insuredValueProblem(insuredValue);
  return valueProblem ? { code: "INSURED_VALUE_INVALID", message: valueProblem } : null;
}

/**
 * Lo que viaja como `shippingOptions`: exactamente lo elegido. Sin seguro no
 * va `insuredValueCents`; con un tipo sin seguro, el seguro va apagado.
 */
export function buildShippingOptions({ itemType, letterForward = false, trackingRequested = false, insuranceRequested = false, insuredValue = "" } = {}) {
  const insurance = Boolean(insuranceRequested) && (letterForward || insuranceAvailableFor(itemType));
  const insuredValueCents = insurance ? parseInsuredValueCents(insuredValue) : null;
  return {
    trackingRequested: Boolean(trackingRequested),
    insuranceRequested: insurance,
    ...(insurance && insuredValueCents ? { insuredValueCents } : {}),
  };
}

function serverMessage(data) {
  return typeof data?.error === "string" && data.error.trim() ? data.error.trim() : null;
}

/** compatibility del 422 (o de un 200 sin tarifas) en algo que la pantalla enseña. */
export function describeCompatibility(compatibility, message = null) {
  const compat = compatibility && typeof compatibility === "object" ? compatibility : {};
  const reason = typeof compat.reason === "string" ? compat.reason : COMPATIBILITY_REASONS.NO_SERVICE_MATCHES_OPTIONS;
  return {
    kind: "no-compatible-rates",
    reason,
    // Solo se ofrece si el backend lo dice y el cliente aun no lo pidio.
    canEnableTracking: compat.canEnableTracking === true && compat.trackingRequested !== true,
    excludedServices: Array.isArray(compat.excludedServices) ? compat.excludedServices : [],
    // Solo en cotizaciones; al crear la solicitud de una carta puede no venir.
    failedCarriers: Array.isArray(compat.failedCarriers) ? compat.failedCarriers : [],
    message: message || COMPATIBILITY_TEXT[reason] || COMPATIBILITY_TEXT.NO_SERVICE_MATCHES_OPTIONS,
  };
}

/**
 * Que significa un error al cotizar, elegir tarifa o pedir el reenvio.
 *   no-compatible-rates  422: estado vacio con explicacion (y quiza "Turn on Add Tracking").
 *   insurance-unavailable 422 INSURANCE_NOT_AVAILABLE_FOR_PACKAGES.
 *   quote-invalid        409: la tarifa ya no vale; se borran y se vuelve a cotizar.
 *   error                lo demas, con el mensaje del servidor si lo hay.
 */
export function describeForwardingOptionsError(error, fallback = "Failed to load shipping rates", { itemType } = {}) {
  const response = error?.response;
  if (!response) return { kind: "error", message: "We couldn't reach the server. Check your connection and try again." };
  const { status, data } = response;
  const code = data?.code;

  if (status === 422 && code === "FORWARDING_NO_COMPATIBLE_RATES") {
    // compatibility va en la raiz del JSON; failedCarriers tambien, y puede faltar.
    const compat = data?.compatibility && typeof data.compatibility === "object" ? data.compatibility : {};
    return describeCompatibility({ ...compat, failedCarriers: data?.failedCarriers }, serverMessage(data));
  }
  if (status === 422 && code === "INSURANCE_NOT_AVAILABLE_FOR_PACKAGES") {
    return {
      kind: "insurance-unavailable",
      message: itemType ? insuranceUnavailableMessage(itemType) : serverMessage(data) || ITEM_INSURANCE_UNAVAILABLE_MESSAGE,
    };
  }
  if (status === 422 && (code === "INSURANCE_REQUIRES_TRACKED_SERVICE" || data?.compatibility?.reason === "INSURANCE_REQUIRES_TRACKED_SERVICE")) {
    return { kind: "no-compatible-rates", reason: "INSURANCE_REQUIRES_TRACKED_SERVICE", canEnableTracking: false, excludedServices: [], message: serverMessage(data) || INSURANCE_REQUIRES_TRACKING_MESSAGE };
  }
  if (status === 409 && QUOTE_INVALID_CODES.includes(code)) {
    return { kind: "quote-invalid", code, message: QUOTE_INVALID_MESSAGE };
  }
  // Tambien el 400 de un cuerpo invalido: { error, details }, sin code.
  return { kind: "error", code: code || null, message: serverMessage(data) || fallback };
}

/** Valor del servicio especial `Ins` de una tarifa, en centavos; null si no lo trae. */
export function insuredServiceValueCents(rate) {
  const services = Array.isArray(rate?.specialServices) ? rate.specialServices : [];
  const ins = services.find((service) => String(service?.specialServiceId || "").trim().toLowerCase() === "ins");
  if (!ins) return null;
  const params = Array.isArray(ins.inputParameters) ? ins.inputParameters : [];
  const value = params.find((param) => String(param?.name || "").toUpperCase() === "INPUT_VALUE")?.value;
  const cents = parseInsuredValueCents(value);
  return cents && cents > 0 ? cents : null;
}

/**
 * Si una tarifa es lo que se pidio. El backend ya filtra; esto impide que una
 * respuesta distinta (backend anterior, cache) se elija y se pague:
 *   - tracking pedido <-> la tarifa lo incluye;
 *   - seguro pedido <-> la tarifa trae `Ins` por el mismo valor; sin seguro, no lo trae.
 */
export function rateMatchesOptions(rate, shippingOptions) {
  if (!rate || typeof rate !== "object" || !rate.optionId) return false;
  const tracked = rate.trackingIncluded === true;
  if (Boolean(shippingOptions?.trackingRequested) !== tracked) return false;
  const insured = insuredServiceValueCents(rate);
  // insuredValueCents de la tarifa: entero, 0 sin seguro (si faltara, manda `Ins`).
  const declared = Number.isFinite(rate.insuredValueCents) ? rate.insuredValueCents : null;
  if (shippingOptions?.insuranceRequested) {
    const wanted = Number(shippingOptions.insuredValueCents || 0);
    return insured !== null && insured === wanted && (declared === null || declared === wanted);
  }
  return insured === null && (declared === null || declared === 0);
}

/**
 * La respuesta de POST /client/forwarding/quotes: las tarifas que se pueden
 * elegir y, si no queda ninguna, por que.
 */
export function readQuoteResponse(data, shippingOptions) {
  const all = Array.isArray(data?.rates) ? data.rates : [];
  const rates = all.filter((rate) => rateMatchesOptions(rate, shippingOptions));
  if (rates.length) return { rates, empty: null, discarded: all.length - rates.length };
  return {
    rates: [],
    discarded: all.length,
    empty: describeCompatibility(
      data?.compatibility || { trackingRequested: Boolean(shippingOptions?.trackingRequested) },
      all.length ? null : serverMessage(data) || (typeof data?.message === "string" ? data.message : null)
    ),
  };
}

/** Lo que se enseña bajo una tarifa: solo lo que la tarifa trae de verdad. */
export function rateExtras(rate, formatMoney) {
  const extras = [];
  if (rate?.trackingIncluded === true) extras.push("Tracking included");
  const insured = insuredServiceValueCents(rate);
  if (insured !== null) extras.push("Insured for " + formatMoney(insured) + " (additional insurance)");
  return extras;
}
