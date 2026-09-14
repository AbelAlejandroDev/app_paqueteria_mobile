/**
 * Verificacion de direcciones de reenvio, sin React.
 *
 * Quien decide es el servidor: verifica con Pitney Bowes al guardar, al
 * re-verificar y al crear el reenvio, y cada direccion trae
 * `verification: { status, verifiedAt, message }` (docs/address-verification.md
 * del backend). Aqui solo se traduce a palabras y se decide pronto si una
 * direccion guardada puede usarse, con el mismo criterio que el portal web
 * (src/lib/addressVerification.js).
 */

const COPY = {
  VERIFIED: {
    label: "Verified address",
    tone: "ok",
    hint: "The carrier recognises this address.",
  },
  INVALID: {
    label: "Not recognised",
    tone: "error",
    hint: "The carrier does not recognise this address. Correct it before forwarding.",
  },
  UNVERIFIED: {
    label: "Not verified",
    tone: "warning",
    hint: "This address has not been checked with the carrier yet.",
  },
};

/** Vacio -> undefined: el backend valida longitudes minimas en lo que llega. */
function optional(value) {
  const trimmed = String(value || "").trim();
  return trimmed || undefined;
}

export function describeAddressVerification(verification) {
  const raw = String(verification?.status || "").toUpperCase();
  const status = COPY[raw] ? raw : "UNVERIFIED";
  return { status, ...COPY[status], message: verification?.message || null };
}

/**
 * Si el servidor verifica direcciones. Uno que no lo hace no manda
 * `verification`: no se le exige a la pantalla lo que el servidor no conoce.
 */
export function serverVerifiesAddresses(address) {
  return Boolean(address && Object.prototype.hasOwnProperty.call(address, "verification"));
}

/** Solo una direccion VERIFIED sirve de destino (con un servidor que verifica). */
export function isAddressUsableForForwarding(address) {
  if (!address) return false;
  if (!serverVerifiesAddresses(address)) return true;
  return describeAddressVerification(address.verification).status === "VERIFIED";
}

/**
 * Lo que respondio POST /client/forwarding-addresses/verify.
 *
 * El servidor ya solo manda verified: true con VERIFIED; el estado se mira igual
 * por si responde un servidor anterior, que decia true aunque Pitney dijera FAILED.
 */
export function isVerifiedCheck(result) {
  if (!result?.verified) return false;
  return !/FAIL|INVALID|NOT_VALID/i.test(String(result.status || ""));
}

const ADDRESS_ERROR_CODES = [
  "ADDRESS_NOT_DELIVERABLE",
  "FORWARD_DESTINATION_NOT_VERIFIED",
  "FORWARDING_DESTINATION_INVALID",
];

/** El mensaje de un error de direccion, con lo que dijo el transportista. */
export function addressErrorMessage(error, fallback) {
  const data = error?.response?.data || {};

  if (data.code === "ADDRESS_VERIFICATION_UNAVAILABLE") {
    return "We couldn't check this address with the carrier right now. Please try again in a few minutes.";
  }

  if (ADDRESS_ERROR_CODES.includes(data.code)) {
    const base = data.error || COPY.INVALID.hint;
    return data.providerMessage ? base + " (" + data.providerMessage + ")" : base;
  }

  return data.error || fallback || error?.message || "Something went wrong.";
}

/** Una direccion como la pide la ruta de verificacion. */
export function verifyPayload(address) {
  return {
    recipient: String(address.recipient || "").trim(),
    company: optional(address.company),
    addressLine1: String(address.addressLine1 || "").trim(),
    addressLine2: optional(address.addressLine2),
    city: String(address.city || "").trim(),
    state: address.state,
    zip: String(address.zip || "").trim(),
    phone: optional(address.phone),
  };
}

/**
 * El destino del reenvio de cartas.
 *
 * Una guardada viaja por su id: el servidor usa la que tiene guardada y
 * verificada, no lo que diga la pantalla. Solo un servidor anterior, sin
 * `verification`, recibe los campos sueltos.
 */
export function forwardDestinationFields(destination) {
  if (destination?.id && serverVerifiesAddresses(destination)) {
    return { addressId: destination.id };
  }

  return {
    destinationName: destination.recipient,
    address1: destination.addressLine1,
    address2: optional(destination.addressLine2),
    city: destination.city,
    state: destination.state,
    zip: destination.zip,
    country: destination.country || "US",
    phone: optional(destination.phone),
  };
}

/** Misma direccion a efectos del transportista: sin mayusculas ni espacios de mas. */
export function sameAddress(a, b) {
  const fields = ["addressLine1", "addressLine2", "city", "state", "zip"];
  const clean = (value) => String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  return fields.every((field) => clean(a?.[field]) === clean(b?.[field]));
}
