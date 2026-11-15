import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BILLING_ROUTE,
  isNotificationDetailRoute,
  navigationKeyFor,
  opensDirectly,
  readIdsForNavigation,
  routeForNotification,
  safeId,
} from "../src/lib/notification-routing.js";
import { relatedAction } from "../src/lib/notification-kind.js";
import { clearPendingNavigation, consumePendingNavigation, peekPendingNavigation, setPendingNavigation } from "../src/lib/pending-navigation.js";
import { foregroundPresentation, isPushSessionActive, pushSupport, setPushSessionActive } from "../src/lib/push-presentation.js";
import { createScopeTracker } from "../src/lib/session-scope.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const APP_DIR = path.join(root, "src/app");

/** La pantalla de expo-router de una ruta (busca dentro de los grupos "(...)"). */
function screenExists(route) {
  const pathname = typeof route === "string" ? route : route.pathname;
  const segments = pathname.split("/").filter(Boolean);
  const find = (dir, rest) => {
    if (!rest.length) return fs.existsSync(path.join(dir, "index.jsx")) ? true : false;
    const [head, ...tail] = rest;
    if (tail.length === 0 && fs.existsSync(path.join(dir, head + ".jsx"))) return true;
    if (fs.existsSync(path.join(dir, head)) && fs.statSync(path.join(dir, head)).isDirectory() && find(path.join(dir, head), tail)) return true;
    for (const entry of fs.readdirSync(dir)) {
      if (/^\(.+\)$/.test(entry) && find(path.join(dir, entry), rest)) return true;
    }
    return false;
  };
  return find(APP_DIR, segments);
}

// Lo que manda el backend (lib/notifications): el data del aviso + type + notificationId.
const push = (type, data = {}) => ({ ...data, type, notificationId: "n" + type.length + "x" + type.slice(0, 6) });

// ── Todos los tipos con push del backend (348c327, src/lib/push.js PUSHABLE_TYPES) ──

const PUSHABLE = {
  MAIL_ITEM_RECEIVED: { mailItemId: "mi1", mailItemIds: ["mi1"], count: 1, screen: "mail-item" },
  SCAN_APPROVAL_REQUIRED: { serviceRequestId: "sr1", mailItemId: "mi1", mailItemIds: ["mi1"], requestType: "SCAN", quotedAmountCents: 200, pageCount: 12 },
  FORWARD_APPROVAL_REQUIRED: { serviceRequestId: "sr1", mailItemId: "mi1" },
  FORWARD_TRACKING_APPROVAL_REQUIRED: { serviceRequestId: "sr1", mailItemId: "mi1", requestType: "FORWARD" },
  FORWARD_SPLIT: { serviceRequestId: "sr1", requestType: "FORWARD" },
  PICKUP_READY: { serviceRequestId: "sr1", mailItemId: "mi1", requestType: "PICKUP" },
  PICKUP_COMPLETED: { serviceRequestId: "sr1", mailItemId: "mi1", requestType: "PICKUP", status: "COMPLETED" },
  FORWARD_DELIVERED: { serviceRequestId: "sr1", mailItemId: "mi1" },
  SCAN_COMPLETED: { serviceRequestId: "sr1", mailItemId: "mi1", requestType: "SCAN" },
  USPS_COMPLIANCE_APPROVED: {},
  FORWARD_DISPATCHED: { serviceRequestId: "sr1", mailItemId: "mi1", trackingNumber: "9400" },
  PACKAGE_STORAGE_FEE_WARNING: { mailItemId: "mi1" },
  SCAN_PAYMENT_FAILED: { serviceRequestId: "sr1", mailItemId: "mi1", requestType: "SCAN", paymentStatus: "PENDING_PAYMENT", stripeInvoiceUrl: null },
  FORWARD_PAYMENT_FAILED: { serviceRequestId: "sr1", mailItemId: "mi1", requestType: "FORWARD", paymentStatus: "FAILED" },
  FORWARD_PAYMENT_REQUIRED: { serviceRequestId: "sr1", mailItemId: "mi1", amountCents: 1450 },
  PICKUP_WINDOW_EXPIRED: { serviceRequestId: "sr1", mailItemId: "mi1", requestType: "PICKUP" },
  PAST_DUE_NEW_MAIL: { mailItemId: "mi1", itemCode: "00012", subscriptionStatus: "past_due" },
  SUBSCRIPTION_PAST_DUE: {},
  ACCOUNT_DELETION_PENDING: { accountDeletionRequestId: "adr1" },
  ACCOUNT_DELETION_WAITING_MEMBERSHIP_CANCELLATION: { accountDeletionRequestId: "adr1" },
  ACCOUNT_DELETION_INFO_REQUIRED: { accountDeletionRequestId: "adr1" },
  ACCOUNT_DELETION_APPROVED: { accountDeletionRequestId: "adr1" },
  ACCOUNT_DELETION_REJECTED: { accountDeletionRequestId: "adr1" },
};

const item = (id = "mi1") => ({ pathname: "/mail-items/[id]", params: { id } });

test("cada tipo con push del backend lleva a una pantalla que existe", () => {
  for (const [type, data] of Object.entries(PUSHABLE)) {
    const route = routeForNotification(push(type, data));
    assert.ok(screenExists(route), `${type} -> ${JSON.stringify(route)} no existe`);
  }
  assert.ok(screenExists("/settings/delete-account"));
  assert.ok(screenExists("/usps-verification"));
  assert.ok(screenExists(BILLING_ROUTE));
});

test("correspondencia: la pieza, o la bandeja si se apilaron", () => {
  assert.deepEqual(routeForNotification(push("MAIL_ITEM_RECEIVED", PUSHABLE.MAIL_ITEM_RECEIVED)), item());
  assert.deepEqual(routeForNotification(push("MAIL_ITEM_RECEIVED", { mailItemIds: ["a", "b"], count: 2, screen: "mail-inbox" })), {
    pathname: "/mail-items",
    params: { folder: "inbox" },
  });
});

test("escaneos y forwarding que piden actuar abren la pieza, donde esta el boton", () => {
  for (const type of ["SCAN_APPROVAL_REQUIRED", "FORWARD_PAYMENT_REQUIRED", "FORWARD_PAYMENT_FAILED", "FORWARD_TRACKING_APPROVAL_REQUIRED", "FORWARD_APPROVAL_REQUIRED"]) {
    assert.deepEqual(routeForNotification(push(type, PUSHABLE[type])), item(), type);
    assert.equal(opensDirectly(push(type, PUSHABLE[type])), true, type);
  }
});

test("los informativos (recogida, entrega, escaneo completado, almacenaje) abren su detalle", () => {
  for (const type of ["PICKUP_READY", "PICKUP_COMPLETED", "FORWARD_DELIVERED", "FORWARD_DISPATCHED", "SCAN_COMPLETED", "PACKAGE_STORAGE_FEE_WARNING", "PICKUP_WINDOW_EXPIRED", "FORWARD_SPLIT", "USPS_COMPLIANCE_APPROVED"]) {
    const route = routeForNotification(push(type, PUSHABLE[type]));
    assert.equal(isNotificationDetailRoute(route), true, type);
  }
});

test("facturacion: los de impago van a Billing (Stripe o Zoho)", () => {
  for (const type of ["SUBSCRIPTION_PAST_DUE", "PAST_DUE_NEW_MAIL"]) {
    assert.equal(routeForNotification(push(type, PUSHABLE[type])), BILLING_ROUTE, type);
    assert.equal(opensDirectly(push(type, PUSHABLE[type])), true, type);
  }
});

test("cobro fallido de un escaneo: el detalle decide por el proveedor (Stripe factura, Zoho Facturacion)", () => {
  const data = push("SCAN_PAYMENT_FAILED", PUSHABLE.SCAN_PAYMENT_FAILED);
  assert.equal(isNotificationDetailRoute(routeForNotification(data)), true);
  const notification = { type: "SCAN_PAYMENT_FAILED", data };
  assert.deepEqual(relatedAction(notification, { provider: "ZOHO" }), { label: "Go to Billing", route: "/billing" });
  const stripe = { type: "SCAN_PAYMENT_FAILED", data: { ...data, stripeInvoiceUrl: "https://invoice.stripe.com/i/acct_1/test_1" } };
  assert.deepEqual(relatedAction(stripe, { provider: "STRIPE" }), { label: "Pay invoice", url: "https://invoice.stripe.com/i/acct_1/test_1" });
  // Con Zoho nunca se abre una URL de Stripe, aunque llegara.
  assert.equal(relatedAction(stripe, { provider: "ZOHO" }).url, undefined);
  // Una URL que no es https no se abre.
  assert.equal(relatedAction({ type: "SCAN_PAYMENT_FAILED", data: { ...data, stripeInvoiceUrl: "javascript:x" } }, { provider: "STRIPE" }).url, undefined);
  // Sin proveedor conocido no se adivina: la pieza.
  assert.deepEqual(relatedAction(notification, {}).route, item());
});

test("borrado de cuenta: el detalle lleva a Ajustes -> borrado", () => {
  for (const type of Object.keys(PUSHABLE).filter((t) => t.startsWith("ACCOUNT_DELETION"))) {
    assert.deepEqual(relatedAction({ type, data: PUSHABLE[type] }), { label: "View account deletion", route: "/settings/delete-account" }, type);
  }
});

test("el detalle pasa el proveedor de /client/capabilities y abre URLs con el navegador del sistema", () => {
  const detail = read("src/app/(client)/notifications/[id].jsx");
  assert.match(detail, /relatedAction\(notification, \{ provider: capabilities\.provider \}\)/);
  assert.match(detail, /action\.url \? WebBrowser\.openBrowserAsync\(action\.url\) : router\.push\(action\.route\)/);
});

// ── Ids del push: nunca rutas raras ─────────────────────────────────────────

test("ids con forma rara se ignoran (no componen rutas)", () => {
  assert.equal(safeId("cm123abcXYZ_-"), "cm123abcXYZ_-");
  for (const bad of ["../billing", "a/b", "a?b=1", "", null, undefined, "x".repeat(65), "id with space"]) {
    assert.equal(safeId(bad), null, String(bad));
  }
  // Un pago con mailItemId raro no abre la pieza: cae en el detalle del aviso.
  assert.equal(isNotificationDetailRoute(routeForNotification(push("FORWARD_PAYMENT_REQUIRED", { mailItemId: "../../billing" }))), true);
  // Sin notificationId ni pieza valida: la lista.
  assert.equal(routeForNotification({ type: "SCAN_COMPLETED", mailItemId: "x/y" }), "/notifications");
  // Correo con ids raros: la bandeja, no una pieza inventada.
  assert.deepEqual(routeForNotification({ type: "MAIL_ITEM_RECEIVED", mailItemIds: ["../x"], count: 1 }), { pathname: "/mail-items", params: { folder: "inbox" } });
});

test("lo que no pasa por el detalle se marca leido al llegar", () => {
  const pay = push("FORWARD_PAYMENT_REQUIRED", PUSHABLE.FORWARD_PAYMENT_REQUIRED);
  assert.deepEqual(readIdsForNavigation(pay, routeForNotification(pay)), [pay.notificationId]);
  const pastDue = push("SUBSCRIPTION_PAST_DUE");
  assert.deepEqual(readIdsForNavigation(pastDue, routeForNotification(pastDue)), [pastDue.notificationId]);
  const info = push("PICKUP_READY", PUSHABLE.PICKUP_READY);
  assert.deepEqual(readIdsForNavigation(info, routeForNotification(info)), [], "el detalle lo marca");
  assert.match(read("src/components/common/push-intent-capture.jsx"), /readIds: readIdsForNavigation\(data, route\)/);
});

// ── Primer plano, segundo plano y app cerrada (simulados) ───────────────────

/** Lo que hace PushIntentCapture con un toque (sin React). */
function capture(data, requestId) {
  const route = routeForNotification(data);
  return setPendingNavigation({ route, key: navigationKeyFor(data, requestId), readIds: readIdsForNavigation(data, route) });
}

function navigator() {
  const visits = [];
  return { visits, navigate: (route, entry) => visits.push({ route, readIds: entry.readIds }) };
}

const OPEN = { authenticated: true, termsAccepted: true, unlocked: true };

test("primer plano: con sesion se enseña el aviso; sin sesion, nada", () => {
  assert.deepEqual(foregroundPresentation({ sessionActive: true }), { shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true });
  assert.deepEqual(foregroundPresentation({ sessionActive: false }), { shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false });
  setPushSessionActive(true);
  assert.equal(isPushSessionActive(), true);
  setPushSessionActive(false);
  assert.equal(isPushSessionActive(), false);
  assert.match(read("src/lib/push-notifications.js"), /handleNotification: async \(\) => foregroundPresentation\(\{ sessionActive: isPushSessionActive\(\) \}\)/);
  assert.match(read("src/context/AuthContext.jsx"), /setPushSessionActive\(Boolean\(nextUser\)\)/);
});

test("primer plano: tocar el aviso con la app abierta navega una vez", () => {
  clearPendingNavigation();
  const nav = navigator();
  capture(push("SCAN_APPROVAL_REQUIRED", PUSHABLE.SCAN_APPROVAL_REQUIRED), "req-1");
  assert.equal(consumePendingNavigation({ gates: OPEN, navigate: nav.navigate }), true);
  assert.deepEqual(nav.visits[0].route, item());
  assert.equal(consumePendingNavigation({ gates: OPEN, navigate: nav.navigate }), false);
});

test("segundo plano: con el bloqueo biometrico puesto, espera a que se desbloquee", () => {
  clearPendingNavigation();
  const nav = navigator();
  capture(push("FORWARD_PAYMENT_FAILED", PUSHABLE.FORWARD_PAYMENT_FAILED), "req-2");
  assert.equal(consumePendingNavigation({ gates: { ...OPEN, unlocked: false }, navigate: nav.navigate }), false);
  assert.ok(peekPendingNavigation(), "la intencion se conserva");
  assert.equal(consumePendingNavigation({ gates: OPEN, navigate: nav.navigate }), true);
  assert.equal(nav.visits.length, 1);
});

test("app cerrada: el toque se lee al arrancar, espera a la sesion y no se abre dos veces", () => {
  clearPendingNavigation();
  const nav = navigator();
  const data = push("PICKUP_READY", PUSHABLE.PICKUP_READY);
  capture(data, "initial-req");
  // Antes de comprobar la sesion guardada: no navega.
  assert.equal(consumePendingNavigation({ gates: { ...OPEN, authenticated: false }, navigate: nav.navigate }), false);
  assert.equal(consumePendingNavigation({ gates: OPEN, navigate: nav.navigate }), true);
  // El mismo toque llega tambien por el listener: misma clave, no se repite.
  assert.equal(capture(data, "listener-req"), false);
  assert.equal(consumePendingNavigation({ gates: OPEN, navigate: nav.navigate }), false);
  assert.equal(nav.visits.length, 1);
});

test("sin sesion valida no se abre nada, y si entra OTRA cuenta el toque se descarta", () => {
  clearPendingNavigation();
  const nav = navigator();
  // Arranque sin sesion (undefined -> null) y un aviso de la cuenta anterior en la bandeja.
  const track = createScopeTracker(() => clearPendingNavigation());
  track(null);
  capture(push("FORWARD_PAYMENT_REQUIRED", PUSHABLE.FORWARD_PAYMENT_REQUIRED), "req-old");
  assert.equal(consumePendingNavigation({ gates: { ...OPEN, authenticated: false }, navigate: nav.navigate }), false);
  // Entra otra persona: el cambio de ambito vacia la navegacion pendiente.
  track({ id: "bob", tenantId: "worx" });
  assert.equal(peekPendingNavigation(), null);
  assert.equal(consumePendingNavigation({ gates: OPEN, navigate: nav.navigate }), false);
  assert.equal(nav.visits.length, 0);
});

test("con la sesion guardada (misma cuenta) el toque de app cerrada si se abre", () => {
  clearPendingNavigation();
  const nav = navigator();
  const track = createScopeTracker(() => clearPendingNavigation());
  capture(push("SCAN_APPROVAL_REQUIRED", PUSHABLE.SCAN_APPROVAL_REQUIRED), "req-cold");
  track({ id: "ana", tenantId: "hdg" }); // arranque con usuario guardado: no vacia
  assert.equal(consumePendingNavigation({ gates: OPEN, navigate: nav.navigate }), true);
});

test("al cerrar sesion se vacia la bandeja del sistema", () => {
  const auth = read("src/context/AuthContext.jsx");
  const end = auth.slice(auth.indexOf("const endLocalSession = useCallback("), auth.indexOf("}, [applyUser]);"));
  assert.match(end, /dismissAllNotifications\(\);/);
  assert.match(read("src/lib/push-notifications.js"), /Notifications\.dismissAllNotificationsAsync\(\)/);
});

// ── Registro: Android sin Firebase no lo intenta ────────────────────────────

test("Android sin google-services.json de su marca: no intenta registrarse y lo dice", () => {
  const base = { isExpoGo: false, hasModule: true, isDevice: true, projectId: "p" };
  assert.equal(pushSupport({ ...base, platform: "android", androidFcmConfigured: false }).available, false);
  assert.match(pushSupport({ ...base, platform: "android", androidFcmConfigured: false }).reason, /Firebase/);
  assert.equal(pushSupport({ ...base, platform: "android", androidFcmConfigured: true }).available, true);
  assert.equal(pushSupport({ ...base, platform: "ios", androidFcmConfigured: false }).available, true, "iOS no usa Firebase");
  assert.equal(pushSupport({ ...base, platform: "android" }).available, true, "una build sin el dato no se bloquea");
  assert.equal(pushSupport({ ...base, isDevice: false, platform: "ios" }).available, false, "simulador");
  assert.equal(pushSupport({ ...base, projectId: null, platform: "ios" }).available, false);
});
