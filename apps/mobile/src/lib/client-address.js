/**
 * Direccion del cliente tal y como la envia la API.
 *
 * `serializeAuthUser` devuelve el perfil con los campos planos addressLine1,
 * addressLine2, city, state y zip. Buscarla en `clientProfile.forwardingAddress`
 * no encuentra nada y acaba mostrando "No forwarding address on file" aunque
 * este bien guardada.
 *
 * Se conservan las formas anidadas como respaldo, porque el mismo usuario
 * puede venir de una respuesta antigua que las traiga.
 */
function resolveAddressSource(user) {
  const profile = user?.clientProfile || {};
  return profile.forwardingAddress || user?.forwardingAddress || user?.address || profile;
}

/** Campos sueltos, para pintarlos por separado. */
export function getClientAddress(user) {
  const address = resolveAddressSource(user);

  return {
    name: address.name || user?.name || "",
    address1: address.addressLine1 || address.address1 || address.line1 || "",
    address2: address.addressLine2 || address.address2 || address.line2 || "",
    city: address.city || "",
    state: address.state || "",
    zip: address.zip || address.postalCode || "",
    country: address.country || "US",
  };
}

/** Una linea, para la cabecera del panel. */
export function formatClientAddress(user, fallback = "No forwarding address on file") {
  const address = getClientAddress(user);
  const parts = [address.address1, address.address2, address.city, address.state, address.zip].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : fallback;
}

/** Si no hay ni calle ni ciudad, no hay direccion utilizable. */
export function hasClientAddress(user) {
  const address = getClientAddress(user);
  return Boolean(address.address1 || address.city);
}
