/**
 * Formularios de reenvio: que hay que proteger de un cierre accidental y que
 * invalida una cotizacion. Sin React, para probarlo.
 */

const filled = (value) => String(value ?? "").trim() !== "";

/**
 * Si cerrar el formulario perderia algo que el cliente eligio o escribio. Lo
 * que viene por defecto (la direccion predeterminada ya elegida, las casillas
 * apagadas) no cuenta.
 */
export function hasForwardFormChanges({
  draft = null,
  emptyDraft = {},
  destinationPhone = "",
  trackingRequested = false,
  insuranceRequested = false,
  insuredValue = "",
  pickedAddress = false,
} = {}) {
  if (trackingRequested || insuranceRequested || filled(insuredValue) || filled(destinationPhone) || pickedAddress) return true;
  if (draft && typeof draft === "object") {
    return Object.keys(draft).some((key) => filled(draft[key]) && String(draft[key]).trim() !== String(emptyDraft[key] ?? "").trim());
  }
  return false;
}

/**
 * Campos del formulario de cotizacion (mail-items/[id]) que cambian el precio:
 * si cambia alguno, la cotizacion y la tarifa elegida dejan de valer. El resto
 * (ninguno hoy) se podria cambiar sin volver a cotizar.
 */
export const PRICE_FIELDS = Object.freeze([
  "recipient",
  "address1",
  "address2",
  "city",
  "state",
  "zip",
  "phone",
  "trackingRequested",
  "insuranceRequested",
  "insuredValue",
]);

/** Campos de direccion: cambiarlos invalida tambien el resultado de Check Address. */
export const ADDRESS_FIELDS = Object.freeze(["recipient", "address1", "address2", "city", "state", "zip"]);

export function invalidatesQuote(field) {
  return PRICE_FIELDS.includes(field);
}

export function invalidatesAddressCheck(field) {
  return ADDRESS_FIELDS.includes(field);
}

/** El formulario de [id] (address1/address2) como lo pide POST /client/forwarding-addresses/verify. */
export function verifyDraftFromForwardForm(form) {
  const f = form || {};
  return {
    recipient: f.recipient || "",
    company: "",
    addressLine1: f.address1 || "",
    addressLine2: f.address2 || "",
    city: f.city || "",
    state: f.state || "",
    zip: f.zip || "",
    phone: f.phone || "",
  };
}

/**
 * La correccion que propone el transportista, aplicada al formulario de [id]
 * sin tocar nada mas (telefono, casillas, valor declarado se quedan).
 */
export function applySuggestedToForwardForm(form, suggested) {
  if (!suggested) return form;
  return {
    ...form,
    recipient: suggested.recipient || form.recipient,
    address1: suggested.addressLine1 || form.address1,
    address2: suggested.addressLine2 || "",
    city: suggested.city || form.city,
    state: suggested.state || form.state,
    zip: suggested.zip || form.zip,
  };
}
