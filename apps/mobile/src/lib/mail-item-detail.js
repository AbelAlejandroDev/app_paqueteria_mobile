/**
 * Helpers del detalle de mail item, portados de
 * src/pages/client/ClientMailItemDetailPage.jsx del front web.
 *
 * Igual que en mail-item-display.js, los colores van partidos en
 * {container, label} porque en React Native el texto no hereda color.
 */

const ITEM_STATUS_COLORS = {
  READY_FOR_PICKUP: { container: "border-cyan-200 bg-cyan-100", label: "text-cyan-800" },
  PICKED_UP: { container: "border-emerald-200 bg-emerald-100", label: "text-emerald-800" },
  FORWARDED: { container: "border-amber-200 bg-amber-100", label: "text-amber-800" },
  SCAN_REQUESTED: { container: "border-violet-200 bg-violet-100", label: "text-violet-800" },
  SCANNED: { container: "border-blue-200 bg-blue-100", label: "text-blue-800" },
  FORWARD_REQUESTED: { container: "border-orange-200 bg-orange-100", label: "text-orange-800" },
  RECEIVED: { container: "border-slate-200 bg-slate-100", label: "text-slate-700" },
};

const REQUEST_STATUS_COLORS = {
  COMPLETED: { container: "border-emerald-200 bg-emerald-100", label: "text-emerald-800" },
  IN_PROGRESS: { container: "border-sky-200 bg-sky-100", label: "text-sky-800" },
  AWAITING_CLIENT_APPROVAL: { container: "border-amber-200 bg-amber-100", label: "text-amber-800" },
  READY_TO_SHIP: { container: "border-blue-200 bg-blue-100", label: "text-blue-800" },
  REJECTED: { container: "border-rose-200 bg-rose-100", label: "text-rose-800" },
  CANCELLED: { container: "border-rose-200 bg-rose-100", label: "text-rose-800" },
};

const NEUTRAL = { container: "border-slate-200 bg-slate-100", label: "text-slate-700" };

export function itemStatusColor(status) {
  return ITEM_STATUS_COLORS[status] || NEUTRAL;
}

export function requestStatusColor(status) {
  return REQUEST_STATUS_COLORS[status] || NEUTRAL;
}

export function formatMoneyFromCents(value) {
  if (value === null || value === undefined || value === "") return "-";

  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";

  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
}

export function hasDisplayValue(value) {
  return value !== null && value !== undefined && value !== "" && value !== "Not provided";
}

export function formatItemWeight(item) {
  const pounds = Number(item?.weightPounds || 0);
  const ounces = Number(item?.weightOunces || 0);
  const totalPounds = pounds + ounces / 16;

  if (!totalPounds) return "-";

  return Number(totalPounds.toFixed(2)) + " lbs";
}

function isScanAsset(media) {
  return media?.kind === "SCAN_PDF" || (media?.kind === "PHOTO" && String(media?.path || "").includes("/scans/"));
}

export function getScanMedia(item) {
  return (item?.media || []).filter(isScanAsset);
}

/** Los archivos de escaneo solo se muestran cuando el item ya está escaneado. */
export function getVisibleMedia(item) {
  return (item?.media || []).filter((media) => {
    if (!isScanAsset(media)) return true;
    return item?.status === "SCANNED";
  });
}

export function buildTimeline(item) {
  const events = [];

  if (item?.receivedAt) {
    events.push({
      at: item.receivedAt,
      title: "Item received",
      description: "The item was received at the center.",
      kind: "SYSTEM",
    });
  }

  const requests = Array.isArray(item?.serviceRequests) ? item.serviceRequests : [];

  for (const sr of requests) {
    events.push({
      at: sr.createdAt,
      title: "Service request created: " + sr.type,
      description: "Status: " + sr.status,
      kind: "SR",
      sr,
    });

    if (sr.completedAt) {
      events.push({
        at: sr.completedAt,
        title: "Service request completed: " + sr.type,
        description: "Completed by staff.",
        kind: "SR_DONE",
        sr,
      });
    }
  }

  // El modelo no guarda pickedUpAt/forwardedAt, así que el evento final se
  // ancla a receivedAt igual que en la web.
  if (item?.status === "PICKED_UP") {
    events.push({ at: item.receivedAt, title: "Picked up", description: "The item was picked up by the client.", kind: "STATUS" });
  } else if (item?.status === "FORWARDED") {
    events.push({ at: item.receivedAt, title: "Forwarded", description: "The item was forwarded.", kind: "STATUS" });
  } else if (item?.status === "SCANNED") {
    events.push({ at: item.receivedAt, title: "Scanned", description: "The item was scanned.", kind: "STATUS" });
  }

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return events;
}

export function findRequest(requests, predicate, dateField = "createdAt") {
  return (
    (requests || [])
      .filter(predicate)
      .sort((a, b) => new Date(b[dateField] || b.createdAt || 0).getTime() - new Date(a[dateField] || a.createdAt || 0).getTime())[0] || null
  );
}

export const PAYABLE_PAYMENT_STATUSES = [
  "NOT_STARTED",
  "READY_FOR_PAYMENT",
  "PAYMENT_PENDING",
  "RECONFIRMATION_REQUIRED",
  "FAILED",
];
