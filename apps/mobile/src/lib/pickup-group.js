/**
 * La recogida de una pieza y las demas piezas que van con ella.
 *
 * El staff puede abrir una sola recogida con varias piezas del cliente (rama
 * feat/grouped-pickup del backend). GET /client/mail-items/:id devuelve esa
 * solicitud en cualquiera de sus piezas, dentro de item.serviceRequests, con
 * `requestItems`: [{ itemOrder, mailItem: { id, itemCode, type, status } }]
 * ordenadas por itemOrder.
 *
 * - Una recogida de una sola pieza (y las antiguas) trae `requestItems` vacio:
 *   su pieza es el escalar `mailItemId` de la solicitud, o sea esta misma.
 * - Un backend anterior no manda el campo: se trata igual que una sola pieza.
 * - Al cancelarse o rechazarse, el backend desactiva esas filas y la lista
 *   llega vacia: se ve el estado de la solicitud sin la lista.
 *
 * Solo se lee la respuesta del detalle (nunca la cache del listado, que no
 * lleva `requestItems` a proposito). Sin React, para poder probarlo.
 */

const OPEN_STATUSES = ["OPEN", "PROCESSING", "IN_PROGRESS", "READY_TO_SHIP", "AWAITING_CLIENT_APPROVAL"];

/** Lo que ve el cliente del estado de la recogida, no el codigo interno. */
const PICKUP_STATUS_LABELS = {
  OPEN: "Ready for Pickup",
  PROCESSING: "Ready for Pickup",
  IN_PROGRESS: "Ready for Pickup",
  COMPLETED: "Picked Up",
  CANCELLED: "Cancelled",
  REJECTED: "Cancelled",
};

const time = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * La recogida que importa en esta pieza: la abierta si la hay; si no, la mas
 * reciente (entregada o cancelada). null si la pieza nunca tuvo recogida.
 */
export function findPickupRequest(serviceRequests) {
  const pickups = (Array.isArray(serviceRequests) ? serviceRequests : []).filter((r) => r?.type === "PICKUP");
  if (pickups.length === 0) return null;
  const byNewest = [...pickups].sort((a, b) => time(b.createdAt) - time(a.createdAt));
  return byNewest.find((r) => OPEN_STATUSES.includes(r.status)) || byNewest[0];
}

export function pickupStatusLabel(status) {
  if (PICKUP_STATUS_LABELS[status]) return PICKUP_STATUS_LABELS[status];
  return String(status || "")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Las piezas de la recogida, en su orden y sin repetir, marcando la que se
 * esta viendo. Sin `requestItems` (una sola pieza, legacy o backend anterior)
 * devuelve solo la pieza actual.
 */
export function pickupGroupItems(request, currentItem) {
  const currentId = currentItem?.id ? String(currentItem.id) : null;
  const rows = Array.isArray(request?.requestItems) ? request.requestItems : [];

  const seen = new Set();
  const items = [...rows]
    .sort((a, b) => Number(a?.itemOrder ?? 0) - Number(b?.itemOrder ?? 0))
    .map((row) => row?.mailItem)
    .filter((mailItem) => {
      if (!mailItem?.id) return false;
      const id = String(mailItem.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((mailItem) => ({
      id: String(mailItem.id),
      itemCode: mailItem.itemCode || null,
      type: mailItem.type || null,
      status: mailItem.status || null,
      isCurrent: String(mailItem.id) === currentId,
    }));

  if (items.length > 0) return items;
  if (!currentId) return [];
  return [
    {
      id: currentId,
      itemCode: currentItem.itemCode || null,
      type: currentItem.type || null,
      status: currentItem.status || null,
      isCurrent: true,
    },
  ];
}

/** Lo que pinta la tarjeta: estado y piezas. null si no hay recogida. */
export function describePickupGroup(serviceRequests, currentItem) {
  const request = findPickupRequest(serviceRequests);
  if (!request) return null;
  const items = pickupGroupItems(request, currentItem);
  return {
    requestId: request.id || null,
    status: request.status || null,
    statusLabel: pickupStatusLabel(request.status),
    items,
    grouped: items.length > 1,
  };
}
