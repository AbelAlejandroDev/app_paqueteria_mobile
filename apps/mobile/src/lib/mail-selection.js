/**
 * Seleccion de varias piezas en la bandeja, sin React.
 *
 * Que se puede pedir sobre cada pieza lo decide el backend
 * (computeAvailableActions en controllers/client/mailItems/shared/helpers.js).
 * La lista trae availableActions en cada pieza y se usan tal cual. Si faltan (un
 * servidor anterior), se aplica aqui la misma regla con el estado y las
 * solicitudes. Al crear la solicitud, el servidor vuelve a comprobarlo.
 */

const TERMINAL_STATUSES = ["PICKED_UP", "FORWARDED", "DISCARDED", "ARCHIVED"];
const ACTIVE_REQUEST_STATUSES = ["OPEN", "PROCESSING", "IN_PROGRESS", "AWAITING_CLIENT_APPROVAL", "READY_TO_SHIP"];

/**
 * Las solicitudes que se pueden pedir para varias piezas a la vez, en orden de menu.
 * NOT_MINE no es una solicitud de servicio: abre una revision de asignacion por
 * pieza (POST /client/mail-items/:id/reject-assignment).
 */
export const BULK_ACTIONS = ["FORWARD", "SCAN", "DISCARD", "NOT_MINE"];

/** Las availableActions de la pieza: las del servidor si vienen, o calculadas igual. */
export function availableActionsFor(item) {
  const status = item?.status;
  const fromServer = item?.availableActions;

  if (fromServer && typeof fromServer === "object") {
    return {
      canRequestScan: Boolean(fromServer.canRequestScan),
      canRequestForward: Boolean(fromServer.canRequestForward),
      canRequestPickup: Boolean(fromServer.canRequestPickup),
      canRequestDiscard: Boolean(fromServer.canRequestDiscard),
      // La lista no manda canRejectAssignment; es la regla de get.js con lo que si manda.
      canRejectAssignment:
        typeof fromServer.canRejectAssignment === "boolean"
          ? fromServer.canRejectAssignment
          : !TERMINAL_STATUSES.includes(status) && !fromServer.hasActiveDisposition,
    };
  }

  if (TERMINAL_STATUSES.includes(status)) {
    return {
      canRequestScan: false,
      canRequestForward: false,
      canRequestPickup: false,
      canRequestDiscard: false,
      canRejectAssignment: false,
    };
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
    // Como get.js: la lista ya excluye las piezas con una revision abierta.
    canRejectAssignment: !hasActiveDisposition,
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
  if (action === "NOT_MINE") return actions.canRejectAssignment;
  return false;
}

function hasActiveRequest(item, types) {
  return (Array.isArray(item?.serviceRequests) ? item.serviceRequests : []).some(
    (request) => types.includes(request?.type) && ACTIVE_REQUEST_STATUSES.includes(request?.status)
  );
}

const DISPOSITIONS = ["FORWARD", "PICKUP", "DISCARD"];

/** Por que una pieza no admite una solicitud en grupo (codigo), o null si la admite. */
export function bulkBlockReason(item, action) {
  if (canBulkRequest(item, action)) return null;
  if (TERMINAL_STATUSES.includes(item?.status)) return "FINISHED";

  if (action === "FORWARD") {
    if (item?.type !== "LETTER") return "NOT_A_LETTER";
    return "REQUEST_IN_PROGRESS";
  }
  if (action === "SCAN") {
    if (item?.type === "PACKAGE") return "PACKAGE_NO_SCAN";
    if (item?.status === "SCANNED") return "ALREADY_SCANNED";
    if (hasActiveRequest(item, ["SCAN"])) return "SCAN_IN_PROGRESS";
    return "REQUEST_IN_PROGRESS";
  }
  if (action === "DISCARD") {
    if (hasActiveRequest(item, ["SCAN"]) && !hasActiveRequest(item, DISPOSITIONS)) return "SCAN_IN_PROGRESS";
    return "REQUEST_IN_PROGRESS";
  }
  return "REQUEST_IN_PROGRESS";
}

const REASON_TEXT = {
  PACKAGE_NO_SCAN: (n) => (n === 1 ? "Packages can't be scanned." : n + " are packages, and packages can't be scanned."),
  ALREADY_SCANNED: (n) => (n === 1 ? "1 item is already scanned." : n + " items are already scanned."),
  SCAN_IN_PROGRESS: (n) => (n === 1 ? "1 item has a scan in progress." : n + " items have a scan in progress."),
  NOT_A_LETTER: (n) =>
    n === 1
      ? "Only letters can be forwarded together. Forward it from its own page."
      : "Only letters can be forwarded together. " + n + " items aren't letters.",
  REQUEST_IN_PROGRESS: (n) =>
    n === 1
      ? "1 item already has a pickup, forward or discard in progress."
      : n + " items already have a pickup, forward or discard in progress.",
  FINISHED: (n) => (n === 1 ? "1 item has already left your mailbox." : n + " items have already left your mailbox."),
};

/** Los motivos de las que se quedan fuera, agrupados y dichos para el cliente. */
export function bulkBlockReasons(items, action) {
  const counts = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const code = bulkBlockReason(item, action);
    if (code) counts.set(code, (counts.get(code) || 0) + 1);
  }
  return [...counts.entries()].map(([code, count]) => ({ code, count, text: REASON_TEXT[code](count) }));
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
    return { action, eligible, skipped: items.length - eligible.length, reasons: bulkBlockReasons(items, action) };
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
