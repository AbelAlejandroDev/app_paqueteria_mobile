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

  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
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
  inbox: "Bandeja de entrada",
  pending: "Pendiente",
  action_required: "Accion requerida",
  completed: "Completada",
  trash: "Papelera",
};

export const FOLDER_ORDER = ["inbox", "pending", "action_required", "completed", "trash"];

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
