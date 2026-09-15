/**
 * Seleccion de varias piezas en la bandeja, sin React.
 *
 * Que se puede pedir sobre cada pieza lo decide el backend
 * (computeAvailableActions en controllers/client/mailItems/shared/helpers.js).
 * La lista no trae availableActions, pero si el estado y las solicitudes, asi
 * que aqui se aplica la misma regla para saber de antemano cuantas de las
 * elegidas admiten cada solicitud. Al crearla, el servidor vuelve a comprobarlo.
 */

const TERMINAL_STATUSES = ["PICKED_UP", "FORWARDED", "DISCARDED", "ARCHIVED"];
const ACTIVE_REQUEST_STATUSES = ["OPEN", "PROCESSING", "IN_PROGRESS", "AWAITING_CLIENT_APPROVAL", "READY_TO_SHIP"];

/** Las solicitudes que se pueden pedir para varias piezas a la vez, en orden de menu. */
export const BULK_ACTIONS = ["FORWARD", "SCAN", "DISCARD"];

/** Lo mismo que availableActions del backend, calculado con lo que trae la lista. */
export function availableActionsFor(item) {
  const status = item?.status;
  if (TERMINAL_STATUSES.includes(status)) {
    return { canRequestScan: false, canRequestForward: false, canRequestPickup: false, canRequestDiscard: false };
  }

  const active = (Array.isArray(item?.serviceRequests) ? item.serviceRequests : []).filter((request) =>
    ACTIVE_REQUEST_STATUSES.includes(request?.status)
  );
  const hasActive = (type) => active.some((request) => request.type === type);

  // Recoger, reenviar y descartar deciden por donde sale la pieza: se pisan
  // entre si. El escaneo no bloquea destinos, pero si impide descartar.
  const hasActiveDisposition = hasActive("FORWARD") || hasActive("PICKUP") || hasActive("DISCARD");
  const hasActiveRequest = hasActive("SCAN") || hasActiveDisposition;

  return {
    canRequestScan: item?.type !== "PACKAGE" && status !== "SCANNED" && !hasActiveRequest,
    canRequestForward: status !== "FORWARDED" && !hasActiveDisposition,
    canRequestPickup: status !== "PICKED_UP" && !hasActiveDisposition,
    canRequestDiscard: !hasActiveRequest,
  };
}

/**
 * Si una pieza admite una solicitud en grupo.
 *
 * El reenvio en grupo es solo de cartas, igual que en el portal: van juntas en
 * un sobre. Un paquete se cotiza por separado desde su detalle.
 */
export function canBulkRequest(item, action) {
  const actions = availableActionsFor(item);
  if (action === "FORWARD") return item?.type === "LETTER" && actions.canRequestForward;
  if (action === "SCAN") return actions.canRequestScan;
  if (action === "DISCARD") return actions.canRequestDiscard;
  return false;
}

/** Si una pieza admite al menos una solicitud en grupo: solo esas se pueden marcar. */
export function isSelectable(item) {
  return BULK_ACTIONS.some((action) => canBulkRequest(item, action));
}

/** Para cada solicitud, cuales de las elegidas la admiten. */
export function bulkActionSummary(selectedItems) {
  const items = Array.isArray(selectedItems) ? selectedItems : [];
  return BULK_ACTIONS.map((action) => {
    const eligible = items.filter((item) => canBulkRequest(item, action));
    return { action, eligible, skipped: items.length - eligible.length };
  });
}

export function toggleId(ids, id) {
  const key = String(id);
  return ids.includes(key) ? ids.filter((current) => current !== key) : [...ids, key];
}

/** Marca todas las seleccionables o, si ya lo estaban, las desmarca. */
export function toggleAll(ids, items) {
  const selectable = (Array.isArray(items) ? items : []).filter(isSelectable).map((item) => String(item.id));
  const allSelected = selectable.length > 0 && selectable.every((id) => ids.includes(id));
  return allSelected ? ids.filter((id) => !selectable.includes(id)) : [...new Set([...ids, ...selectable])];
}

/** Las elegidas que siguen en la lista y siguen siendo seleccionables (la lista se refresca). */
export function selectedItemsFrom(ids, items) {
  return (Array.isArray(items) ? items : []).filter((item) => ids.includes(String(item.id)) && isSelectable(item));
}

/** Cuerpo de POST /client/service-requests para varias piezas (SCAN o DISCARD). */
export function bulkRequestBody(action, items) {
  const ids = items.map((item) => String(item.id));
  return {
    type: action,
    mailItemId: ids[0],
    mailItemIds: ids,
    ...(action === "SCAN" ? { chargeConsent: true } : {}),
  };
}
