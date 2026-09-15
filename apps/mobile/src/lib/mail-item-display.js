/**
 * Helpers de presentación de mail items, portados de
 * src/pages/client/ClientMailItemsPortalPage.jsx del front web.
 *
 * Los colores se devuelven partidos en contenedor y texto: en React Native
 * el color de texto no se hereda del padre.
 */

const STATUS_COLORS = {
  RECEIVED: { container: "border-slate-200 bg-slate-100", label: "text-slate-700" },
  READY_FOR_PICKUP: { container: "border-cyan-200 bg-cyan-100", label: "text-cyan-800" },
  PICKED_UP: { container: "border-emerald-200 bg-emerald-100", label: "text-emerald-800" },
  FORWARDED: { container: "border-amber-200 bg-amber-100", label: "text-amber-800" },
  SCAN_REQUESTED: { container: "border-violet-200 bg-violet-100", label: "text-violet-800" },
  SCANNED: { container: "border-blue-200 bg-blue-100", label: "text-blue-800" },
  FORWARD_REQUESTED: { container: "border-orange-200 bg-orange-100", label: "text-orange-800" },
  ARCHIVED: { container: "border-rose-200 bg-rose-100", label: "text-rose-800" },
  DISCARDED: { container: "border-rose-200 bg-rose-100", label: "text-rose-800" },
};

/**
 * Estados que no se leen bien partiendo el nombre. Un item descartado lo guarda
 * el backend como ARCHIVED (discard completado o correo ajeno descartado por el
 * staff), pero para el cliente es "Discarded". DISCARDED queda cubierto para
 * cuando el backend renombre el estado.
 */
const STATUS_LABELS = {
  ARCHIVED: "Discarded",
  DISCARDED: "Discarded",
};

const DEFAULT_STATUS_COLOR = { container: "border-slate-200 bg-slate-100", label: "text-slate-700" };

export const INBOX_EXCLUDED_STATUSES = ["PICKED_UP", "FORWARDED", "SCANNED"];
export const ACTION_STATUSES = ["READY_FOR_PICKUP", "SCAN_REQUESTED", "FORWARD_REQUESTED"];
export const COMPLETED_STATUSES = ["PICKED_UP", "FORWARDED", "SCANNED"];

export function getStatusColor(status) {
  return STATUS_COLORS[status] || DEFAULT_STATUS_COLOR;
}

export function formatStatusDisplay(status) {
  if (!status) return "-";
  if (STATUS_LABELS[status]) return STATUS_LABELS[status];

  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

const REQUEST_TYPE_LABELS = { SCAN: "Scan", FORWARD: "Forward", PICKUP: "Pickup", DISCARD: "Discard" };
const CLOSED_REQUEST_LABELS = { REJECTED: "Rejected", CANCELLED: "Cancelled" };
const CLOSED_REQUEST_COLOR = { container: "border-rose-200 bg-rose-100", label: "text-rose-800" };

/**
 * Estados de pieza que no son un final: sobre ellos, una solicitud cerrada sin
 * hacerse es la ultima noticia. En PICKED_UP, FORWARDED o DISCARDED lo que manda
 * es el final.
 */
const OPEN_ITEM_STATUSES = ["RECEIVED", "READY_FOR_PICKUP", "SCAN_REQUESTED", "SCANNED", "FORWARD_REQUESTED"];

/** La solicitud mas reciente de la pieza (incluidas las de un reenvio agrupado). */
export function latestServiceRequest(item) {
  const requests = Array.isArray(item?.serviceRequests) ? item.serviceRequests : [];
  return [...requests].sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0))[0] || null;
}

/**
 * El estado que se le enseña al cliente.
 *
 * Si la ultima solicitud se rechazo o cancelo, eso es lo que paso: "Forward
 * Rejected". El backend deja la pieza en FORWARD_REQUESTED o SCAN_REQUESTED
 * cuando el staff rechaza desde su panel, y la lista seguia diciendo "Forward
 * Requested" de algo que ya no esta en marcha. Con el backend corregido la pieza
 * vuelve a RECEIVED y se sigue viendo el rechazo, que es la noticia reciente.
 */
export function getItemStatusDisplay(item) {
  const status = item?.status;
  const latest = latestServiceRequest(item);
  const closed = latest ? CLOSED_REQUEST_LABELS[latest.status] : null;
  const type = latest ? REQUEST_TYPE_LABELS[latest.type] : null;

  if (closed && type && OPEN_ITEM_STATUSES.includes(status)) {
    return { label: type + " " + closed, color: CLOSED_REQUEST_COLOR };
  }

  return { label: formatStatusDisplay(status), color: getStatusColor(status) };
}

export function getMailTypeLabel(type) {
  if (type === "LARGE_ENVELOPE") return "Large Envelope";
  if (type === "PACKAGE") return "Package";
  if (type === "LETTER") return "Letter";
  return type || "-";
}

export function getCurrentStatusLabel(item) {
  return item?.currentStatus || (item?.viewStatus === "VIEWED" || item?.viewedAt ? "Viewed" : "New");
}

export function getCurrentStatusColor(item) {
  return getCurrentStatusLabel(item) === "Viewed"
    ? { container: "border-emerald-200 bg-emerald-50", label: "text-emerald-700" }
    : { container: "border-sky-200 bg-sky-50", label: "text-sky-700" };
}

export function getPrimaryPhoto(item) {
  return (item?.media || []).find((media) => media.kind === "PHOTO" && media.signedUrl) || null;
}

export function getMailItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.mailItems)) return payload.mailItems;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export const FOLDER_LABELS = {
  inbox: "Inbox",
  pending: "Pending",
  action_required: "Action Required",
  completed: "Completed",
  // Se conserva la etiqueta por si llega en una respuesta antigua, aunque el
  // backend ya no ofrezca la carpeta: lo descartado vive en Completada.
  trash: "Trash",
};

export const FOLDER_ORDER = ["inbox", "pending", "action_required", "completed"];

export function normalizeFolders(folders = []) {
  const byKey = new Map((folders || []).map((folder) => [folder.key, folder]));

  return FOLDER_ORDER.map((key) => ({
    key,
    label: FOLDER_LABELS[key],
    count: 0,
    notificationCount: 0,
    ...byKey.get(key),
  }));
}
