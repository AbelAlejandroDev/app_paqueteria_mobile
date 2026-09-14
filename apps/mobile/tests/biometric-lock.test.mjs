import test from "node:test";
import assert from "node:assert/strict";

import {
  GRACE_PERIOD_MS,
  createLockController,
  shouldLockOnResume,
  stateAfterAuthentication,
} from "../src/lib/biometric-lock-policy.js";

/** Reloj controlable para no esperar 30 segundos reales. */
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms) => (now += ms) };
}

test("el periodo de gracia es de 30 segundos", () => {
  assert.equal(GRACE_PERIOD_MS, 30_000);
});

test("16. volver a los 29 segundos no bloquea", () => {
  const time = clock();
  const controller = createLockController({ now: time.now });

  controller.onAppStateChange("background");
  time.advance(29_000);
  assert.equal(controller.onAppStateChange("active"), "none");
});

test("17. volver a los 30 segundos o despues bloquea", () => {
  const time = clock();
  const controller = createLockController({ now: time.now });

  controller.onAppStateChange("background");
  time.advance(30_000);
  assert.equal(controller.onAppStateChange("active"), "lock");

  assert.equal(shouldLockOnResume({ lastBackgroundAt: 0, now: 45_000 }), true);
});

test("17b. en iOS la vuelta pasa por inactive y aun asi bloquea", () => {
  const time = clock();
  const controller = createLockController({ now: time.now });

  controller.onAppStateChange("inactive");
  controller.onAppStateChange("background");
  time.advance(31_000);
  controller.onAppStateChange("inactive");
  assert.equal(controller.onAppStateChange("active"), "lock");
});

test("17c. un tiron del centro de notificaciones (inactive) no cuenta como salir", () => {
  const time = clock();
  const controller = createLockController({ now: time.now });

  controller.onAppStateChange("inactive");
  time.advance(120_000);
  assert.equal(controller.onAppStateChange("active"), "none");
});

test("18. nunca hay dos dialogos biometricos a la vez", async () => {
  const controller = createLockController();
  let prompts = 0;

  // El mismo guardia que usa unlock() en BiometricGate.
  const unlock = async () => {
    if (!controller.beginAuthentication()) return;
    prompts++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.endAuthentication({ success: true });
  };

  await Promise.all([unlock(), unlock(), unlock()]);
  assert.equal(prompts, 1);
  assert.equal(controller.beginAuthentication(), true, "cerrado el primero, se puede volver a pedir");
});

test("19. los cambios de estado del propio dialogo no provocan un bucle", () => {
  const time = clock();
  const controller = createLockController({ now: time.now });

  // Bloqueado al volver: se abre el dialogo.
  controller.onAppStateChange("background");
  time.advance(40_000);
  assert.equal(controller.onAppStateChange("active"), "lock");
  controller.beginAuthentication();

  // El dialogo (y en Android el PIN) mueve la app a inactive/background y la
  // devuelve, y el cliente tarda mas de 30 segundos en autenticarse.
  const during = [
    controller.onAppStateChange("inactive"),
    controller.onAppStateChange("background"),
  ];
  time.advance(60_000);
  during.push(controller.onAppStateChange("active"));
  assert.deepEqual(during, ["none", "none", "none"]);

  controller.endAuthentication({ success: true });

  // Ni la vuelta que sigue al dialogo ni otra posterior vuelven a bloquear.
  assert.equal(controller.onAppStateChange("inactive"), "none");
  assert.equal(controller.onAppStateChange("active"), "none");
});

test("20. cancelar mantiene la app bloqueada", () => {
  assert.equal(stateAfterAuthentication({ success: false, cancelled: true, error: "user_cancel" }), "locked");
  assert.equal(stateAfterAuthentication({ success: false, cancelled: false, error: "lockout" }), "locked");
  assert.equal(stateAfterAuthentication({ success: true }), "unlocked");
});

test("20b. tras cancelar se puede volver a intentar", () => {
  const controller = createLockController();
  controller.beginAuthentication();
  controller.endAuthentication({ success: false, cancelled: true });
  assert.equal(controller.authenticating, false, "se puede reintentar");
});

test("cerrar sesion reinicia el controlador", () => {
  const time = clock();
  const controller = createLockController({ now: time.now });
  controller.onAppStateChange("background");
  controller.beginAuthentication();

  controller.reset();

  assert.equal(controller.authenticating, false);
  assert.equal(controller.lastBackgroundAt, null);
});
