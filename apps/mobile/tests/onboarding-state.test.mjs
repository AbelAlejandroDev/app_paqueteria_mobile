import test from "node:test";
import assert from "node:assert/strict";

import { configureStorage } from "../../../packages/core/src/storage.js";
import {
  CLIENT_ONBOARDING_VERSION,
  getOnboardingRecord,
  needsOnboarding,
  onboardingScope,
  saveOnboardingStatus,
} from "../src/lib/onboarding-state.js";

// Un almacen en memoria con la misma forma que AsyncStorage.
function memoryStore() {
  const data = new Map();
  const backend = {
    getItem: async (key) => (data.has(key) ? data.get(key) : null),
    setItem: async (key, value) => void data.set(key, value),
    removeItem: async (key) => void data.delete(key),
  };
  return { ...backend, secure: backend };
}

const clientA = { id: "a", tenantId: "worx", role: "CLIENT" };
const clientB = { id: "b", tenantId: "worx", role: "CLIENT" };

test("un cliente nuevo ve el tutorial; staff y admin nunca", () => {
  assert.equal(needsOnboarding(clientA, null), true);
  assert.equal(needsOnboarding({ id: "s", role: "STAFF" }, null), false);
  assert.equal(needsOnboarding({ id: "x", role: "ADMIN" }, null), false);
  assert.equal(needsOnboarding(null, null), false);
});

test("completado u omitido no vuelve a salir; una version nueva si", () => {
  assert.equal(needsOnboarding(clientA, { version: CLIENT_ONBOARDING_VERSION, status: "completed" }), false);
  assert.equal(needsOnboarding(clientA, { version: CLIENT_ONBOARDING_VERSION, status: "skipped" }), false);
  assert.equal(needsOnboarding(clientA, { version: 1, status: "completed" }, 2), true);
});

test("la clave separa cuentas y organizaciones", () => {
  assert.notEqual(onboardingScope(clientA), onboardingScope(clientB));
  assert.notEqual(onboardingScope(clientA), onboardingScope({ ...clientA, tenantId: "hdg" }));
  assert.equal(onboardingScope({}), null);
});

test("skip y finish se guardan por cuenta, sin mezclar A con B ni con otro tenant", async () => {
  configureStorage(memoryStore());

  await saveOnboardingStatus(clientA, "skipped");
  assert.equal((await getOnboardingRecord(clientA)).status, "skipped");
  assert.equal(await getOnboardingRecord(clientB), null);
  assert.equal(await getOnboardingRecord({ ...clientA, tenantId: "hdg" }), null);

  await saveOnboardingStatus(clientB, "completed");
  assert.equal((await getOnboardingRecord(clientB)).status, "completed");
  assert.equal((await getOnboardingRecord(clientA)).status, "skipped");
  assert.equal(needsOnboarding(clientB, await getOnboardingRecord(clientB)), false);
});

test("tras Skip o Finish el registro en memoria lleva la version y no reabre el tutorial", () => {
  // Es el registro que guarda el provider al cerrar; sin version se leia como
  // pendiente y el tutorial se abria otra vez en bucle.
  for (const status of ["skipped", "completed"]) {
    assert.equal(needsOnboarding(clientA, { version: CLIENT_ONBOARDING_VERSION, status }), false);
  }
  assert.equal(needsOnboarding(clientA, { status: "skipped" }), true, "sin version si se reabriria");
});
