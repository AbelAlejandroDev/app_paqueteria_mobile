/**
 * Que paso con POST /client/service-requests (FORWARD) cuando no llego un 201.
 * Sin React, para probarlo.
 *
 * Lo que garantiza el backend (controllers/client/mailItems/createServiceRequest):
 *   - Crear el reenvio es UNA transaccion: o se crea todo o nada. Despues del
 *     commit solo queda responder 201; un 4xx o un 500 con respuesta del
 *     servidor dice que NO se creo.
 *   - Un indice unico impide dos reenvios activos de la misma pieza: el segundo
 *     recibe 409 ACTIVE_FORWARD_REQUEST_EXISTS. No hay duplicados en el
 *     servidor, pero la app tampoco debe invitar a pedirlo otra vez.
 *   - Antes de la transaccion se verifica la direccion con Pitney: puede tardar,
 *     y si la app corta (timeout) o un proxy devuelve 502/503/504, el servidor
 *     pudo terminar y crearlo. Eso es "uncertain": se comprueba antes de dejar
 *     pedirlo otra vez.
 */

/** Estados de una solicitud activa (los del backend, ACTIVE_SR_STATUSES). */
export const ACTIVE_FORWARD_STATUSES = Object.freeze(["OPEN", "PROCESSING", "IN_PROGRESS", "AWAITING_CLIENT_APPROVAL", "READY_TO_SHIP"]);

/** Respuestas de un intermediario (proxy, balanceador): el servidor pudo seguir. */
const GATEWAY_STATUSES = [502, 503, 504];

function serverText(data) {
  if (!data || typeof data !== "object") return null;
  for (const key of ["reason", "message", "error"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim() && value.trim() !== "Conflict") return value.trim();
  }
  return null;
}

/**
 * "HTTP 409 · CODE": para que el cliente (y quien le ayuda) sepa exactamente que
 * respondio el servidor. null sin respuesta.
 */
export function errorReference(error) {
  const status = error?.response?.status;
  if (!status) return null;
  const code = error.response.data?.code;
  return "HTTP " + status + (typeof code === "string" && code ? " · " + code : "");
}

/**
 * @returns {{ outcome: "not-created" | "already-requested" | "uncertain", message: string|null, code: string|null, status: number|null, reference: string|null }}
 *   not-created        el servidor respondio que no: se puede corregir y volver a pedir.
 *   already-requested  ya hay un reenvio activo de la pieza (este u otro anterior).
 *   uncertain          no se sabe si se creo: comprobar antes de dejar pedirlo otra vez.
 */
export function classifyForwardSubmitError(error, fallbackMessage = null) {
  const response = error?.response;
  if (!response) {
    return { outcome: "uncertain", message: null, code: null, status: null, reference: null };
  }
  const { status, data } = response;
  const code = typeof data?.code === "string" ? data.code : null;
  const reference = errorReference(error);
  if (GATEWAY_STATUSES.includes(status)) {
    return { outcome: "uncertain", message: null, code, status, reference };
  }
  if (status === 409 && code === "ACTIVE_FORWARD_REQUEST_EXISTS") {
    return { outcome: "already-requested", message: serverText(data), code, status, reference };
  }
  return { outcome: "not-created", message: serverText(data) || fallbackMessage, code, status, reference };
}

/**
 * El reenvio activo de una pieza en la respuesta de GET /client/mail-items/:id,
 * o null. Basta con que haya uno: si existe, la pieza no se puede volver a pedir
 * (el backend lo rechazaria) y es el que el cliente tiene que ver.
 */
export function findActiveForward(mailItemResponse) {
  const item = mailItemResponse?.item || mailItemResponse;
  const requests = Array.isArray(item?.serviceRequests) ? item.serviceRequests : [];
  return requests.find((r) => r?.type === "FORWARD" && ACTIVE_FORWARD_STATUSES.includes(r?.status)) || null;
}

/**
 * Comprueba si el reenvio quedo creado: lee la primera pieza (las demas van en
 * la misma solicitud). Solo lee.
 * @returns {Promise<{ created: boolean, request: object|null }>} lanza si la lectura falla.
 */
export async function verifyForwardCreated({ fetchMailItem, mailItemIds }) {
  const firstId = Array.isArray(mailItemIds) ? mailItemIds[0] : null;
  if (!firstId) return { created: false, request: null };
  const request = findActiveForward(await fetchMailItem(firstId));
  return { created: Boolean(request), request };
}
