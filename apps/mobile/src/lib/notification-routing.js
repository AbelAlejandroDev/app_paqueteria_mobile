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

/**
 * Ids que llegan en el data de un push. Solo se usan para componer una ruta si
 * tienen la forma de un id del backend (cuid: letras, numeros, - y _). Un push
 * no puede meter una ruta ni un parametro raro en la navegacion; lo que no
 * encaja se ignora y se cae al siguiente destino.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function safeId(value) {
  const id = value === null || value === undefined ? "" : String(value);
  return ID_PATTERN.test(id) ? id : null;
}

/**
 * Avisos que piden al cliente hacer algo en una pieza: se abren en esa pieza,
 * donde esta el boton, y no en el detalle del aviso (que no tiene ninguno).
 *   FORWARD_PAYMENT_REQUIRED / FORWARD_PAYMENT_FAILED  pagar o reintentar el franqueo.
 *   SCAN_APPROVAL_REQUIRED                             aprobar el escaneo (backend quoteScan.js).
 *   FORWARD_TRACKING_APPROVAL_REQUIRED                 aceptar o rechazar el seguimiento.
 *   FORWARD_APPROVAL_REQUIRED                          avisos antiguos de aprobar un reenvio.
 * El de pago lleva a la pieza principal del envio, tambien para las cartas que
 * van en el mismo sobre. Los informativos (recogida, entrega, escaneo
 * completado...) abren su detalle, que enseña el grupo y lleva a la pieza.
 */
const ITEM_ACTION_TYPES = new Set([
  "FORWARD_PAYMENT_REQUIRED",
  "FORWARD_PAYMENT_FAILED",
  "SCAN_APPROVAL_REQUIRED",
  "FORWARD_TRACKING_APPROVAL_REQUIRED",
  "FORWARD_APPROVAL_REQUIRED",
]);

/**
 * Avisos de impago: su accion esta en Facturacion (handoff HDG F.3), sea Stripe
 * o Zoho. SCAN_PAYMENT_FAILED no va aqui: con Stripe se paga su factura y con
 * Zoho desde Facturacion, y eso lo decide el detalle con las capacidades.
 */
const BILLING_ACTION_TYPES = new Set(["SUBSCRIPTION_PAST_DUE", "PAST_DUE_NEW_MAIL"]);

export const BILLING_ROUTE = "/billing";

export function isItemActionNotification(data) {
  return Boolean(data && ITEM_ACTION_TYPES.has(data.type) && safeId(data.mailItemId));
}

export function isBillingActionNotification(data) {
  return Boolean(data && BILLING_ACTION_TYPES.has(data.type));
}

/** Avisos que se abren directamente en su accion, sin pasar por su detalle. */
export function opensDirectly(data) {
  return isItemActionNotification(data) || isBillingActionNotification(data);
}

function itemRoute(mailItemId) {
  return { pathname: "/mail-items/[id]", params: { id: String(mailItemId) } };
}

function detailRoute(id) {
  return { pathname: "/notifications/[id]", params: { id: String(id) } };
}

export function isNotificationDetailRoute(route) {
  return Boolean(route && typeof route === "object" && route.pathname === "/notifications/[id]");
}

export function routeForNotification(data) {
  if (!data) return "/notifications";

  // Correo recibido: su sitio es la pieza, o la bandeja si se apilaron varias.
  // Va antes que notificationId porque el detalle del aviso no ensena las piezas.
  if (isMailReceived(data)) return routeForMailReceived(data);

  // Un aviso que pide hacer algo va a donde se hace.
  if (isItemActionNotification(data)) return itemRoute(safeId(data.mailItemId));
  if (isBillingActionNotification(data)) return BILLING_ROUTE;

  // El caso normal: el backend manda el id exacto.
  const notificationId = safeId(data.notificationId);
  if (notificationId) return detailRoute(notificationId);

  // El resto de avisos hablan de una pieza concreta: su sitio es esa pieza.
  const mailItemId = safeId(data.mailItemId);
  if (mailItemId) return itemRoute(mailItemId);

  return legacyRouteWithoutId(data);
}

/**
 * Que avisos quedan leidos al navegar. El detalle marca el suyo al abrirse;
 * cualquier otro destino (la pieza, la bandeja, Facturacion) no sabe de avisos,
 * asi que se marca al llegar.
 */
export function readIdsForNavigation(data, route) {
  if (isNotificationDetailRoute(route)) return [];
  const notificationId = safeId(data?.notificationId);
  return notificationId ? [notificationId] : [];
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
