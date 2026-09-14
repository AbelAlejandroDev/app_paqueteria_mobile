/**
 * A donde lleva una notificacion al tocarla.
 *
 * Un solo sitio para el push y para la lista, sobre las rutas que ya existen.
 * No hay un segundo sistema de navegacion: todo termina en un router.push.
 */

import { isMailReceived, mailItemCount, routeForMailReceived } from "./mail-notifications.js";

export const NOTIFICATION_DETAIL_SCREEN = "notification-detail";

/**
 * Clave de la lista. Empieza por "client-notifications" a proposito: el resto de
 * la app invalida ese prefijo al marcar avisos como leidos, y asi la lista se
 * entera sin conocer a nadie.
 */
export const NOTIFICATIONS_QUERY_KEY = ["client-notifications", "list"];

export function notificationDetailQueryKey(id) {
  return ["client-notifications", "detail", String(id)];
}

export function notificationDetailPath(id) {
  return "/client/notifications/" + encodeURIComponent(String(id));
}

/** El detalle se pide por su id; no se busca dentro de la lista. */
export async function loadNotificationDetail(api, id) {
  const response = await api.get(notificationDetailPath(id));
  return response.data?.notification || null;
}

function detailRoute(id) {
  return { pathname: "/notifications/[id]", params: { id: String(id) } };
}

export function routeForNotification(data) {
  if (!data) return "/notifications";

  // Correo recibido: su sitio es la pieza, o la bandeja si se apilaron varias.
  // Va antes que notificationId porque el detalle del aviso no ensena las piezas.
  if (isMailReceived(data)) return routeForMailReceived(data);

  // El caso normal: el backend manda el id exacto.
  if (data.notificationId) return detailRoute(data.notificationId);

  // El resto de avisos hablan de una pieza concreta: su sitio es esa pieza.
  if (data.mailItemId) {
    return { pathname: "/mail-items/[id]", params: { id: String(data.mailItemId) } };
  }

  return legacyRouteWithoutId(data);
}

/**
 * Compatibilidad con pushes antiguos que no traian el id.
 *
 * Separado a proposito y nunca alcanzable cuando hay notificationId: abre la
 * lista y deja que ella busque la mas reciente de ese tipo. Solo sirve para
 * pushes enviados antes de que el backend incluyera el id.
 */
function legacyRouteWithoutId(data) {
  if (data.type === "USPS_COMPLIANCE_APPROVED") {
    return { pathname: "/notifications", params: { openType: data.type } };
  }
  return "/notifications";
}

/** Clave para no navegar dos veces por el mismo aviso. */
export function navigationKeyFor(data, requestId) {
  if (!data?.notificationId) return requestId || null;
  // Un aviso de correo apilado conserva su id y cambia la cuenta: el push de
  // "2 new mail items" es otro toque distinto del de "a new mail item".
  if (isMailReceived(data)) return "notification:" + data.notificationId + ":" + mailItemCount(data);
  return "notification:" + data.notificationId;
}
