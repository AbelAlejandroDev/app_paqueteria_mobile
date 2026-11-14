/**
 * Las direcciones de reenvio guardadas del cliente, sin React.
 *
 * Salen de /client/forwarding-addresses (`name`, no `recipient`), que devuelve
 * solo las del usuario de la sesion. Settings y el reenvio de paquetes comparten
 * la clave: cambiar la predeterminada en uno se ve en el otro.
 */
export const FORWARDING_ADDRESSES_ENDPOINT = "/client/forwarding-addresses";
export const FORWARDING_ADDRESSES_KEY = ["client-forwarding-addresses"];

/** La que el backend marca como predeterminada. Sin marca no hay ninguna: la primera de la lista no vale. */
export function findDefaultAddress(items) {
  return (Array.isArray(items) ? items : []).find((address) => address?.isDefault === true) || null;
}

/**
 * Los campos del formulario de reenvio para esa direccion.
 *
 * El telefono se sustituye aunque venga vacio: el escrito antes era de otro
 * destino, y si falta lo pide la validacion del formulario.
 */
export function forwardFieldsFromAddress(address) {
  return {
    recipient: address?.name || "",
    address1: address?.addressLine1 || "",
    address2: address?.addressLine2 || "",
    city: address?.city || "",
    state: address?.state || "",
    zip: address?.zip || "",
    phone: address?.phone || "",
  };
}
