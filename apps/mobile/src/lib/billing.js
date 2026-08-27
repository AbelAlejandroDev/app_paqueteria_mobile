/**
 * Formato y clasificación de los datos de facturación.
 *
 * Los importes llegan del backend en céntimos (`*AmountCents`) porque Stripe
 * trabaja así; se dividen entre 100 solo al pintarlos.
 */

import { formatDate } from "@/lib/utils";

/** Estados que el backend considera resueltos a favor del cliente. */
// `PAYMENT_SUCCEEDED` no está en la lista de la web y por eso allí sale en
// gris pese a ser un cobro correcto; aquí cuenta como positivo.
const POSITIVE_STATUSES = ["SENT", "PAID", "CURRENT", "ACTIVE", "COMPLETED", "PAYMENT_SUCCEEDED", "SUCCEEDED"];
const NEGATIVE_STATUSES = ["FAILED", "PAST_DUE", "CANCELLED", "CANCELED"];
const WAITING_STATUSES = ["PENDING", "OPEN", "AWAITING_CLIENT_APPROVAL", "READY_TO_SHIP"];

/**
 * En React Native el color del texto no se hereda del contenedor, así que
 * cada estado necesita las dos mitades por separado.
 */
const POSITIVE = { container: "border-emerald-200 bg-emerald-100", label: "text-emerald-800" };
const NEGATIVE = { container: "border-rose-200 bg-rose-100", label: "text-rose-800" };
const WAITING = { container: "border-amber-200 bg-amber-100", label: "text-amber-800" };
const NEUTRAL = { container: "border-slate-200 bg-slate-100", label: "text-slate-800" };

export function getStatusColor(status) {
  const normalized = String(status || "").toUpperCase();

  if (POSITIVE_STATUSES.includes(normalized)) return POSITIVE;
  if (NEGATIVE_STATUSES.includes(normalized)) return NEGATIVE;
  if (WAITING_STATUSES.includes(normalized)) return WAITING;
  return NEUTRAL;
}

export function formatMoneyCents(value, currency = "USD") {
  const amount = Number(value || 0) / 100;

  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount);
  } catch (error) {
    // Un código de divisa inesperado hace lanzar a Intl; mejor un importe
    // legible que una pantalla en rojo.
    return "$" + amount.toFixed(2);
  }
}

/**
 * Fecha sin hora. `formatDate` de core usa `toLocaleString()`, que incluye
 * hora y minutos: eso está bien para la traza de un envío, pero en un rango
 * de ciclo de facturación ocupa cuatro líneas en un móvil sin aportar nada.
 */
export function formatDateOnly(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);

  return date.toLocaleDateString();
}

export function formatCycle(cycle) {
  if (!cycle?.startAt || !cycle?.endAt) return "-";
  return formatDateOnly(cycle.startAt) + " - " + formatDateOnly(cycle.endAt);
}

/**
 * Evita el "Payment Payment Succeeded" que sale en la web: el propio estado
 * ya empieza por la palabra que se le antepone como etiqueta.
 */
export function labelWithPrefix(prefix, value) {
  const text = titleCase(value);
  if (!text) return null;

  return text.toLowerCase().startsWith(prefix.toLowerCase()) ? text : prefix + " " + text;
}

/**
 * `Number(null)` es 0, y 0 es finito: comprobar solo `Number.isFinite` daba
 * por bueno un cupo inexistente y pintaba "2 / null included".
 */
export function hasIncludedQuota(included) {
  return included != null && Number.isFinite(Number(included));
}

export function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Porcentaje consumido del cupo del ciclo. Se limita a 100 para que la barra
 * no se salga cuando el cliente pasa de lo incluido.
 */
export function getUsagePercent(used, included) {
  if (!hasIncludedQuota(included)) return 100;

  const total = Math.max(Number(included), Number(used || 0), 1);
  return Math.min(Math.round((Number(used || 0) / total) * 100), 100);
}
