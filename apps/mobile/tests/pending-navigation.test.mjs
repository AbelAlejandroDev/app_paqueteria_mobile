import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  clearPendingNavigation,
  consumePendingNavigation,
  peekPendingNavigation,
  setPendingNavigation,
} from "../src/lib/pending-navigation.js";
import { navigationKeyFor, routeForNotification } from "../src/lib/notification-routing.js";

const PUSH = { type: "USPS_COMPLIANCE_APPROVED", notificationId: "n1", screen: "notification-detail" };
const OPEN = { authenticated: true, termsAccepted: true, unlocked: true };

/** Lo que hace PushIntentCapture al recibir un toque. */
function capture(data, requestId = "req-1") {
  return setPendingNavigation({ route: routeForNotification(data), key: navigationKeyFor(data, requestId) });
}

/** Lo que hace NotificationTapHandler cada vez que cambia algo. */
function attempt(gates, navigations) {
  return consumePendingNavigation({ gates, navigate: (route) => navigations.push(route) });
}

beforeEach(() => clearPendingNavigation());

test("9. push con la app delante: navega en cuanto llega", () => {
  const navigations = [];
  capture(PUSH);
  assert.equal(attempt(OPEN, navigations), true);
  assert.deepEqual(navigations, [{ pathname: "/notifications/[id]", params: { id: "n1" } }]);
});

test("10. push en segundo plano con la app bloqueada: espera al desbloqueo", () => {
  const navigations = [];
  capture(PUSH);

  assert.equal(attempt({ ...OPEN, unlocked: false }, navigations), false);
  assert.equal(navigations.length, 0);

  assert.equal(attempt(OPEN, navigations), true);
  assert.equal(navigations.length, 1);
});

test("11. push con la app cerrada: se guarda antes de nada y se abre al pasar todo", () => {
  const navigations = [];
  capture(PUSH);

  attempt({ authenticated: false, termsAccepted: false, unlocked: false }, navigations);
  attempt({ authenticated: true, termsAccepted: false, unlocked: false }, navigations);
  attempt({ authenticated: true, termsAccepted: true, unlocked: false }, navigations);
  assert.equal(navigations.length, 0);

  attempt(OPEN, navigations);
  assert.equal(navigations.length, 1);
});

test("12. la navegacion pendiente espera al login", () => {
  const navigations = [];
  capture(PUSH);
  assert.equal(attempt({ ...OPEN, authenticated: false }, navigations), false);
  assert.ok(peekPendingNavigation(), "la intencion se conserva");
});

test("13. la navegacion pendiente espera a los terminos", () => {
  const navigations = [];
  capture(PUSH);
  assert.equal(attempt({ ...OPEN, termsAccepted: false }, navigations), false);
  assert.ok(peekPendingNavigation());
});

test("14. la navegacion pendiente espera a la biometria", () => {
  const navigations = [];
  capture(PUSH);
  assert.equal(attempt({ ...OPEN, unlocked: false }, navigations), false);
  assert.ok(peekPendingNavigation());
});

test("15. el mismo toque por las dos vias abre una sola pantalla", () => {
  const navigations = [];
  // En frio llega por la ultima respuesta guardada y por el listener.
  capture(PUSH, "req-1");
  capture(PUSH, "req-1");
  attempt(OPEN, navigations);
  capture(PUSH, "req-1");
  attempt(OPEN, navigations);
  assert.equal(navigations.length, 1);
});

test("21. cerrar sesion desde el bloqueo limpia la navegacion pendiente", () => {
  const navigations = [];
  capture(PUSH);
  clearPendingNavigation();

  assert.equal(peekPendingNavigation(), null);
  attempt(OPEN, navigations);
  assert.equal(navigations.length, 0);
});

test("21b. tras cerrar sesion, el siguiente usuario puede abrir sus propias notificaciones", () => {
  const navigations = [];
  capture(PUSH);
  attempt(OPEN, navigations);
  clearPendingNavigation();

  capture(PUSH);
  attempt(OPEN, navigations);
  assert.equal(navigations.length, 2);
});
