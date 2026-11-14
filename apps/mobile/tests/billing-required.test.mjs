import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AxiosError } from "axios";

import { configureStorage, createApiClient, getTokens, setTokens } from "@paqueteria/core";
import { attachAppInterceptors } from "../src/lib/api-interceptors.js";
import {
  BILLING_PROMPT_COOLDOWN_MS,
  billingRequiredMessage,
  createBillingPromptGate,
  isBillingRequiredError,
  isOnBillingRoute,
  shouldPromptBillingRequired,
  subscribeBillingRequired,
} from "../src/lib/billing-required.js";
import { resetServiceStatusForTests } from "../src/lib/service-status.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// Forma real (src/lib/clientBillingStatus.js:106-121 del backend).
const BILLING_REQUIRED = {
  error: "Your membership payment is past due.",
  code: "BILLING_REQUIRED",
  billing: { exists: true, restricted: true, subscriptionStatus: "past_due", paymentStatus: "failed", reason: "past_due" },
};

const err = (status, data) => ({ response: { status, data } });

test("solo el 402 con code BILLING_REQUIRED cuenta", () => {
  assert.equal(isBillingRequiredError(err(402, BILLING_REQUIRED)), true);
  // approve-scan: cobro del escaneo no confirmado. Lo trata su pantalla.
  assert.equal(isBillingRequiredError(err(402, { error: "Payment failed", reason: "x", pending: true })), false);
  assert.equal(isBillingRequiredError(err(409, { error: "x", code: "BILLING_REQUIRED" })), false);
  assert.equal(isBillingRequiredError(err(402, "<html>")), false);
  assert.equal(isBillingRequiredError(new AxiosError("Network Error", "ERR_NETWORK")), false);
});

test("el mensaje es el del backend, con uno generico de respaldo", () => {
  assert.equal(billingRequiredMessage(err(402, BILLING_REQUIRED)), BILLING_REQUIRED.error);
  assert.match(billingRequiredMessage(err(402, { code: "BILLING_REQUIRED" })), /billing issue/);
});

test("el interceptor avisa una vez por cada 402 BILLING_REQUIRED y deja pasar el error", async () => {
  resetServiceStatusForTests();
  configureStorage({ getItem: async () => null, setItem: async () => {}, removeItem: async () => {} });
  const api = attachAppInterceptors(
    createApiClient({
      baseURL: "https://api.example.test/api/v1",
      adapter: (config) => {
        const status = config.url.includes("scan") ? 402 : 402;
        const data = config.url.includes("approve-scan") ? { error: "Payment failed", pending: true } : BILLING_REQUIRED;
        return Promise.reject(new AxiosError("402", "ERR_BAD_REQUEST", config, {}, { status, data, headers: {}, config }));
      },
    })
  );
  const events = [];
  const off = subscribeBillingRequired((e) => events.push(e));
  try {
    await assert.rejects(api.post("/client/service-requests", {}), (e) => e.response.status === 402);
    await assert.rejects(api.post("/client/service-requests/sr1/approve-scan", {}));
    assert.equal(events.length, 1);
    assert.equal(events[0].message, BILLING_REQUIRED.error);
    assert.deepEqual(events[0].billing, BILLING_REQUIRED.billing);
  } finally {
    off();
  }
});

test("un 402 no toca la sesion", async () => {
  const data = new Map();
  const store = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
  configureStorage({ ...store, secure: store });
  await setTokens({ accessToken: "a", refreshToken: "r" });
  const api = attachAppInterceptors(
    createApiClient({
      baseURL: "https://api.example.test/api/v1",
      onUnauthorized: () => assert.fail("no se manda al login"),
      adapter: (config) => Promise.reject(new AxiosError("402", "ERR_BAD_REQUEST", config, {}, { status: 402, data: BILLING_REQUIRED, headers: {}, config })),
    })
  );
  await assert.rejects(api.post("/client/service-requests", {}));
  assert.deepEqual(await getTokens(), { accessToken: "a", refreshToken: "r" });
});

test("no se avisa estando ya en Facturacion", () => {
  assert.equal(isOnBillingRoute("/billing"), true);
  assert.equal(isOnBillingRoute("/billing/whatever"), true);
  assert.equal(isOnBillingRoute("/billing-history"), false);
  assert.equal(shouldPromptBillingRequired({ pathname: "/billing" }), false);
  assert.equal(shouldPromptBillingRequired({ pathname: "/mail-items/1" }), true);
});

test("sin bucles: uno a la vez y como mucho uno por minuto", () => {
  let clock = 1_000_000;
  const gate = createBillingPromptGate({ now: () => clock });

  // Cinco peticiones devuelven 402 a la vez: un solo aviso.
  const opened = [1, 2, 3, 4, 5].map(() => gate.tryOpen("/dashboard"));
  assert.deepEqual(opened, [true, false, false, false, false]);

  // El cliente lo cierra ("Not now"): durante un minuto no vuelve a salir.
  gate.close();
  clock += 10_000;
  assert.equal(gate.tryOpen("/dashboard"), false);

  // Va a Facturacion: alli nunca sale, aunque pase el minuto y algo devuelva 402.
  clock += BILLING_PROMPT_COOLDOWN_MS;
  assert.equal(gate.tryOpen("/billing"), false);

  // Fuera de Facturacion, pasado el minuto, vuelve a avisar.
  assert.equal(gate.tryOpen("/mail-items/1"), true);
});

test("el aviso pregunta y navega con navigate (no apila), solo dentro del area de cliente", () => {
  const handler = read("src/components/common/billing-required-handler.jsx");
  assert.match(handler, /billingPromptGate\.tryOpen\(pathname\)/);
  assert.match(handler, /router\.navigate\(BILLING_ROUTE\)/);
  assert.doesNotMatch(handler, /router\.(push|replace)\(/);
  assert.match(handler, /"Not now"/);
  // Cada salida del aviso cierra la puerta.
  assert.equal((handler.match(/billingPromptGate\.close\(\)/g) || []).length, 3);
  assert.match(read("src/app/(client)/_layout.jsx"), /<BillingRequiredHandler \/>/);
});
