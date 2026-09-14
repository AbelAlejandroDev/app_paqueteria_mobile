/**
 * Avisos de correo recibido, sin React.
 *
 * Antes cada pieza era un aviso con su codigo ("New mail received" / "Package
 * 000029 was received"). Ahora se dice solo "You have a new mail item" y, si
 * llegan varias antes de que el cliente abra el aviso, se apilan en uno:
 * "You have 2 new mail items".
 *
 * El apilado lo hace el backend (un solo aviso sin leer que suma `count` y
 * `mailItemIds`). Mientras un backend anterior siga mandando un aviso por pieza,
 * la app apila los no leidos en su lado con la misma regla, para que la lista
 * se vea igual con uno y con otro.
 */

export const MAIL_RECEIVED_TYPE = "MAIL_ITEM_RECEIVED";
export const SERVICE_REQUEST_STATUS_TYPE = "SERVICE_REQUEST_STATUS_UPDATED";

const REQUEST_LABELS = { SCAN: "scan", FORWARD: "forward", PICKUP: "pickup", DISCARD: "discard" };

export function isMailReceived(notification) {
  return notification?.type === MAIL_RECEIVED_TYPE;
}

/** Cuantas piezas cuenta un aviso: `count` del backend, o sus ids, o una. */
export function mailItemCount(data) {
  const count = Number(data?.count);
  if (Number.isFinite(count) && count >= 1) return Math.floor(count);
  if (Array.isArray(data?.mailItemIds) && data.mailItemIds.length) return data.mailItemIds.length;
  return 1;
}

export function mailReceivedTitle(count) {
  return count > 1 ? "You have " + count + " new mail items" : "You have a new mail item";
}

function mailItemIdsOf(data) {
  if (Array.isArray(data?.mailItemIds) && data.mailItemIds.length) return data.mailItemIds.map(String);
  return data?.mailItemId ? [String(data.mailItemId)] : [];
}

/**
 * Cambio de estado de una solicitud, dicho para el cliente.
 *
 * El backend manda hoy "DISCARD request is now COMPLETED." o "Your scan request
 * was rejected: motivo". Se reescribe con requestType, status y rejectionReason,
 * que vienen en data. Devuelve null si faltan datos para decir algo mejor.
 */
export function serviceRequestDisplay(data) {
  const label = REQUEST_LABELS[String(data?.requestType || "").toUpperCase()];
  const status = String(data?.status || "").toUpperCase();
  if (!label) return null;

  if (status === "REJECTED") {
    const reason = String(data?.rejectionReason || "").trim();
    return {
      title: "Your " + label + " request was rejected",
      message: reason ? "Reason: " + reason : "Contact your center if you have questions.",
    };
  }

  if (status === "COMPLETED") {
    if (label === "discard") {
      return { title: "Your discard request was completed", message: "The mail item was discarded." };
    }
    return { title: "Your " + label + " request was completed", message: null };
  }

  if (status === "CANCELLED") {
    return { title: "Your " + label + " request was cancelled", message: null };
  }

  return null;
}

/**
 * Lo que se enseña de un aviso: el titulo y, solo si dice algo mas, el mensaje.
 * Un aviso de correo es una sola linea, sin codigo ni remitente.
 */
export function notificationDisplay(notification) {
  if (isMailReceived(notification)) {
    return { title: mailReceivedTitle(mailItemCount(notification.data)), message: null };
  }

  if (notification?.type === SERVICE_REQUEST_STATUS_TYPE) {
    const display = serviceRequestDisplay(notification.data);
    if (display) return display;
  }

  const title = notification?.title || "Mailbox update";
  const message = notification?.message && notification.message.trim() !== title.trim() ? notification.message : null;
  return { title, message };
}

/**
 * La lista con los avisos de correo sin leer apilados en uno, en el sitio del
 * mas reciente. Los leidos se quedan como estaban: ya se vieron.
 *
 * Cada fila apilada lleva `stackedIds` (los avisos que hay que marcar leidos al
 * abrirla) y `data.count` / `data.mailItemIds` con el total.
 */
export function stackMailNotifications(items) {
  const list = Array.isArray(items) ? items : [];
  const unreadMail = list.filter((item) => isMailReceived(item) && !item.readAt);
  if (unreadMail.length <= 1) {
    return list.map((item) => (item === unreadMail[0] ? { ...item, stackedIds: [item.id] } : item));
  }

  // La lista llega ordenada de la mas reciente a la mas antigua.
  const newest = unreadMail[0];
  const mailItemIds = [...new Set(unreadMail.flatMap((item) => mailItemIdsOf(item.data)))];
  const count = unreadMail.reduce((total, item) => total + mailItemCount(item.data), 0);

  const stacked = {
    ...newest,
    stackedIds: unreadMail.map((item) => item.id),
    data: { ...(newest.data || {}), count, mailItemIds },
  };

  return list
    .filter((item) => !(isMailReceived(item) && !item.readAt) || item === newest)
    .map((item) => (item === newest ? stacked : item));
}

/**
 * A donde lleva un aviso de correo: con una pieza, a esa pieza; con varias, a
 * la bandeja de entrada, que es donde estan todas.
 */
export function routeForMailReceived(data) {
  const ids = mailItemIdsOf(data);
  const latest = data?.mailItemId ? String(data.mailItemId) : ids[0];

  // El push trae screen: se sigue tal cual. Sin el (la lista, avisos antiguos) se
  // decide por la cuenta.
  if (data?.screen === "mail-inbox") return { pathname: "/mail-items", params: { folder: "inbox" } };
  if (data?.screen === "mail-item" && latest) return { pathname: "/mail-items/[id]", params: { id: latest } };

  if (mailItemCount(data) === 1 && ids.length === 1) {
    return { pathname: "/mail-items/[id]", params: { id: ids[0] } };
  }
  return { pathname: "/mail-items", params: { folder: "inbox" } };
}

/**
 * De los avisos de correo que hay en la bandeja del sistema, cuales sobran: todos
 * menos el mas reciente, que es el que lleva la cuenta al dia. Recibe lo que
 * devuelve getPresentedNotificationsAsync y devuelve identificadores.
 */
export function staleMailNotificationIds(presented) {
  const mail = (Array.isArray(presented) ? presented : [])
    .filter((entry) => entry?.request?.content?.data?.type === MAIL_RECEIVED_TYPE)
    .sort((a, b) => Number(b?.date || 0) - Number(a?.date || 0));

  return mail.slice(1).map((entry) => entry.request.identifier).filter(Boolean);
}
