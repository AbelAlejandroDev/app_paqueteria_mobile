/**
 * De que va un aviso, para elegir su icono y su color en la lista.
 *
 * El backend guarda `type` como texto libre y crea tipos nuevos con el tiempo
 * (FORWARD_DELIVERED, SCAN_OVERAGE...), asi que se clasifica por familia y no
 * con una tabla cerrada: un tipo que aun no existe cae en la familia que su
 * nombre indica, y si no encaja en ninguna, en la generica.
 */

/** Familias que pinta la lista; "general" es la de reserva. */
export const NOTIFICATION_KINDS = [
  "mail",
  "scan",
  "forward",
  "label",
  "pickup",
  "discard",
  "payment",
  "storage",
  "account",
  "notice",
  "general",
];

const REQUEST_KIND = { SCAN: "scan", FORWARD: "forward", PICKUP: "pickup", DISCARD: "discard" };

export function notificationKind(notification) {
  const type = String(notification?.type || "").toUpperCase();
  const data = notification?.data || {};

  if (type === "MAIL_ITEM_RECEIVED") return "mail";

  // El cambio de estado de una solicitud dice de que es en data.requestType.
  if (type.startsWith("SERVICE_REQUEST")) {
    return REQUEST_KIND[String(data.requestType || "").toUpperCase()] || "general";
  }

  // Antes que SCAN y FORWARD: un cobro fallido de un escaneo es un problema de
  // pago, no un escaneo.
  if (/PAST_DUE|PAYMENT|SUBSCRIPTION|BILLING|INVOICE|NONPAYMENT/.test(type)) return "payment";
  if (/STORAGE/.test(type)) return "storage";
  if (type === "FORWARD_LABEL_READY" || type === "LETTER_FORWARDING_ENVELOPE") return "label";
  if (/SCAN/.test(type)) return "scan";
  if (/FORWARD/.test(type)) return "forward";
  if (/PICKUP/.test(type)) return "pickup";
  if (/DISCARD/.test(type)) return "discard";
  if (/MEMBERSHIP|USPS|1583|ACCOUNT|COMPLIANCE/.test(type)) return "account";
  if (type === "SERVICE_NOTICE" || notification?.scope === "CENTER") return "notice";

  return "general";
}

/**
 * La pestaña "Updates": lo que cuenta como va algo que ya estaba en marcha
 * (solicitudes, envios, escaneos, la cuenta), o sea todo menos el aviso de
 * correo nuevo, que tiene su propia bandeja.
 */
export function isUpdateNotification(notification) {
  return notificationKind(notification) !== "mail";
}
