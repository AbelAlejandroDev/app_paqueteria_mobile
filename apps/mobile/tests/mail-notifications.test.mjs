import test from "node:test";
import assert from "node:assert/strict";

import {
  mailItemCount,
  mailReceivedTitle,
  notificationDisplay,
  routeForMailReceived,
  stackMailNotifications,
  staleMailNotificationIds,
} from "../src/lib/mail-notifications.js";
import { navigationKeyFor, routeForNotification } from "../src/lib/notification-routing.js";
import { consumePendingNavigation, clearPendingNavigation, setPendingNavigation } from "../src/lib/pending-navigation.js";

const mail = (id, extra = {}) => ({
  id,
  type: "MAIL_ITEM_RECEIVED",
  title: "New mail received",
  message: "Package " + id + " was received.",
  data: { mailItemId: "item-" + id, itemCode: id },
  readAt: null,
  createdAt: "2026-09-14T10:00:00Z",
  ...extra,
});

test("el aviso de correo es una sola linea, sin codigo ni remitente", () => {
  assert.equal(mailReceivedTitle(1), "You have a new mail item");
  assert.equal(mailReceivedTitle(2), "You have 2 new mail items");
  assert.deepEqual(notificationDisplay(mail("000029")), { title: "You have a new mail item", message: null });
});

test("la cuenta sale de count, de los ids o vale uno", () => {
  assert.equal(mailItemCount({ count: 3 }), 3);
  assert.equal(mailItemCount({ mailItemIds: ["a", "b"] }), 2);
  assert.equal(mailItemCount({ mailItemId: "a" }), 1);
  assert.equal(mailItemCount(null), 1);
  assert.equal(notificationDisplay(mail("x", { data: { count: 2, mailItemIds: ["a", "b"] } })).title, "You have 2 new mail items");
});

test("otros avisos no repiten el titulo como mensaje", () => {
  assert.deepEqual(notificationDisplay({ type: "X", title: "Hi", message: "Hi" }), { title: "Hi", message: null });
  assert.deepEqual(notificationDisplay({ type: "X", title: "Hi", message: "More" }), { title: "Hi", message: "More" });
});

test("los avisos de correo sin leer se apilan en uno, en el sitio del mas reciente", () => {
  const other = { id: "o1", type: "PAYMENT_FAILED", title: "Payment failed", message: "m", readAt: null };
  const readMail = mail("r1", { readAt: "2026-09-13T00:00:00Z" });
  const list = [mail("n2"), other, mail("n1"), readMail];

  const stacked = stackMailNotifications(list);

  assert.equal(stacked.length, 3);
  assert.equal(stacked[0].id, "n2");
  assert.deepEqual(stacked[0].stackedIds, ["n2", "n1"]);
  assert.equal(stacked[0].data.count, 2);
  assert.deepEqual(stacked[0].data.mailItemIds, ["item-n2", "item-n1"]);
  assert.equal(notificationDisplay(stacked[0]).title, "You have 2 new mail items");
  assert.equal(stacked[1], other);
  assert.equal(stacked[2], readMail, "los leidos no se tocan");
});

test("un aviso ya apilado por el backend suma su cuenta", () => {
  const list = [mail("n2", { data: { count: 2, mailItemIds: ["a", "b"] } }), mail("n1", { data: { mailItemId: "c" } })];
  const [first] = stackMailNotifications(list);
  assert.equal(first.data.count, 3);
  assert.deepEqual(first.data.mailItemIds, ["a", "b", "c"]);
});

test("un solo aviso sin leer no cambia, pero sabe que ids marcar", () => {
  const [only] = stackMailNotifications([mail("n1")]);
  assert.deepEqual(only.stackedIds, ["n1"]);
  assert.deepEqual(stackMailNotifications(null), []);
});

test("una pieza lleva a la pieza; varias, a la bandeja de entrada", () => {
  assert.deepEqual(routeForMailReceived({ mailItemId: "a" }), { pathname: "/mail-items/[id]", params: { id: "a" } });
  assert.deepEqual(routeForMailReceived({ count: 2, mailItemIds: ["a", "b"] }), { pathname: "/mail-items", params: { folder: "inbox" } });
  assert.deepEqual(routeForMailReceived({}), { pathname: "/mail-items", params: { folder: "inbox" } });
});

test("el push de correo va a la pieza o a la bandeja aunque traiga notificationId", () => {
  const single = { type: "MAIL_ITEM_RECEIVED", notificationId: "n1", mailItemId: "a" };
  const stacked = { type: "MAIL_ITEM_RECEIVED", notificationId: "n1", count: 2, mailItemIds: ["a", "b"] };

  assert.deepEqual(routeForNotification(single), { pathname: "/mail-items/[id]", params: { id: "a" } });
  assert.deepEqual(routeForNotification(stacked), { pathname: "/mail-items", params: { folder: "inbox" } });
  // Otro tipo con id sigue yendo a su detalle.
  assert.deepEqual(routeForNotification({ type: "USPS_COMPLIANCE_APPROVED", notificationId: "w1" }), {
    pathname: "/notifications/[id]",
    params: { id: "w1" },
  });
});

test("el push apilado es otro toque: la clave incluye la cuenta", () => {
  const one = navigationKeyFor({ type: "MAIL_ITEM_RECEIVED", notificationId: "n1" });
  const two = navigationKeyFor({ type: "MAIL_ITEM_RECEIVED", notificationId: "n1", count: 2 });
  assert.notEqual(one, two);
  assert.equal(navigationKeyFor({ type: "OTHER", notificationId: "n1" }), "notification:n1");
});

test("la navegacion pendiente entrega los avisos a marcar como leidos", () => {
  clearPendingNavigation();
  setPendingNavigation({ route: "/mail-items", key: "k-read", readIds: ["n1"] });

  let received = null;
  consumePendingNavigation({
    gates: { authenticated: true, termsAccepted: true, unlocked: true },
    navigate: (route, entry) => {
      received = { route, readIds: entry.readIds };
    },
  });

  assert.deepEqual(received, { route: "/mail-items", readIds: ["n1"] });
  clearPendingNavigation();
});

test("en la bandeja del sistema solo queda el aviso de correo mas reciente", () => {
  const presented = [
    { date: 100, request: { identifier: "old", content: { data: { type: "MAIL_ITEM_RECEIVED" } } } },
    { date: 300, request: { identifier: "new", content: { data: { type: "MAIL_ITEM_RECEIVED" } } } },
    { date: 200, request: { identifier: "pay", content: { data: { type: "PAYMENT_FAILED" } } } },
    { date: 150, request: { identifier: "mid", content: { data: { type: "MAIL_ITEM_RECEIVED" } } } },
  ];
  assert.deepEqual(staleMailNotificationIds(presented), ["mid", "old"]);
  assert.deepEqual(staleMailNotificationIds(null), []);
});

test("rechazo, discard completado y cancelacion se dicen para el cliente", async () => {
  const { notificationDisplay: display, serviceRequestDisplay } = await import("../src/lib/mail-notifications.js");
  const sr = (data) => ({ type: "SERVICE_REQUEST_STATUS_UPDATED", title: "Service request updated", message: "DISCARD request is now COMPLETED.", data });

  assert.deepEqual(display(sr({ requestType: "SCAN", status: "REJECTED", rejectionReason: "Envelope is empty" })), {
    title: "Your scan request was rejected",
    message: "Reason: Envelope is empty",
  });
  assert.equal(display(sr({ requestType: "FORWARD", status: "REJECTED" })).message, "Contact your center if you have questions.");
  assert.deepEqual(display(sr({ requestType: "DISCARD", status: "COMPLETED" })), {
    title: "Your discard request was completed",
    message: "The mail item was discarded.",
  });
  assert.equal(display(sr({ requestType: "PICKUP", status: "CANCELLED" })).title, "Your pickup request was cancelled");
  // Sin datos suficientes se queda lo que mando el backend.
  assert.equal(serviceRequestDisplay({ status: "COMPLETED" }), null);
  assert.equal(display(sr({})).title, "Service request updated");
});

test("un item descartado se lee Discarded", async () => {
  const { formatStatusDisplay } = await import("../src/lib/mail-item-display.js");
  assert.equal(formatStatusDisplay("ARCHIVED"), "Discarded");
  assert.equal(formatStatusDisplay("DISCARDED"), "Discarded");
  assert.equal(formatStatusDisplay("PICKED_UP"), "Picked Up");
});

test("el push de correo sigue su screen", () => {
  assert.deepEqual(routeForMailReceived({ screen: "mail-inbox", count: 2, mailItemIds: ["a", "b"], mailItemId: "b" }), {
    pathname: "/mail-items",
    params: { folder: "inbox" },
  });
  assert.deepEqual(routeForMailReceived({ screen: "mail-item", count: 1, mailItemIds: ["a"], mailItemId: "a" }), {
    pathname: "/mail-items/[id]",
    params: { id: "a" },
  });
});

test("una pieza cuya ultima solicitud se rechazo no dice Forward Requested", async () => {
  const { getItemStatusDisplay } = await import("../src/lib/mail-item-display.js");
  const req = (type, status, createdAt) => ({ id: type + status + createdAt, type, status, createdAt });

  // Lo que deja hoy el backend: la pieza en FORWARD_REQUESTED con el reenvio rechazado.
  const stuck = { status: "FORWARD_REQUESTED", serviceRequests: [req("FORWARD", "REJECTED", "2026-09-14T10:00:00Z")] };
  assert.equal(getItemStatusDisplay(stuck).label, "Forward Rejected");

  // Con el backend corregido (RECEIVED) se sigue viendo el rechazo.
  assert.equal(getItemStatusDisplay({ ...stuck, status: "RECEIVED" }).label, "Forward Rejected");

  // La mas reciente manda, aunque lleguen desordenadas.
  const rerequested = {
    status: "FORWARD_REQUESTED",
    serviceRequests: [req("FORWARD", "REJECTED", "2026-09-14T10:00:00Z"), req("FORWARD", "OPEN", "2026-09-15T10:00:00Z")],
  };
  assert.equal(getItemStatusDisplay(rerequested).label, "Forward Requested");

  assert.equal(getItemStatusDisplay({ status: "SCAN_REQUESTED", serviceRequests: [req("SCAN", "CANCELLED", "2026-09-14T10:00:00Z")] }).label, "Scan Cancelled");

  // Un final manda sobre una solicitud cerrada anterior.
  assert.equal(getItemStatusDisplay({ status: "DISCARDED", serviceRequests: [req("FORWARD", "REJECTED", "2026-09-14T10:00:00Z")] }).label, "Discarded");
  assert.equal(getItemStatusDisplay({ status: "RECEIVED" }).label, "Received");
});
