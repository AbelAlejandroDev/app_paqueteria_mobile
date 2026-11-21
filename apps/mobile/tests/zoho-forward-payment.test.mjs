import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AxiosError } from "axios";

import { configureStorage, createApiClient, setTokens } from "@paqueteria/core";
import {
  autoChargeOutcome,
  COLLECT_UNCONFIRMED_HOLD_MS,
  confirmRepricedRatePath,
  createStatusPoller,
  interpretPaymentStatus,
  interpretPrepareResponse,
  isPaymentLinkExpired,
  paymentBreakdown,
  paymentStatusPath,
  preparePaymentError,
  preparePaymentPath,
  REVIEW_BODY,
  SAVED_CARD_BODY,
} from "../src/lib/zoho-forward-payment.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// Respuesta de revision (handoff HDG D.4, ficticia).
const REVIEW = {
  success: true,
  provider: "ZOHO",
  autoCharge: null,
  paymentUrl: "https://billing.zoho.example/hostedpage/example",
  expiresAt: "2026-11-13T13:00:00.000Z",
  invoiceNumber: "INV-000123",
  reference: "MW-FWD-cm123examplesr-1",
  amount: 1450,
  postageAmount: 1250,
  postageFeeAmount: 300,
  adminFeeAmount: 200,
  currency: "USD",
  reused: false,
};

const err = (status, data) => ({ response: { status, data } });

test("rutas y cuerpos: revision {} y tarjeta guardada { useSavedCard: true }, nada mas", () => {
  assert.equal(preparePaymentPath("sr1"), "/client/forwarding/sr1/prepare-payment");
  assert.equal(confirmRepricedRatePath("sr1"), "/client/forwarding/sr1/confirm-repriced-rate");
  assert.equal(paymentStatusPath("sr1"), "/client/forwarding/sr1/payment-status");
  assert.equal(preparePaymentPath("a/b"), "/client/forwarding/a%2Fb/prepare-payment");
  assert.deepEqual(REVIEW_BODY, {});
  assert.deepEqual(SAVED_CARD_BODY, { useSavedCard: true });
  assert.ok(Object.isFrozen(REVIEW_BODY) && Object.isFrozen(SAVED_CARD_BODY));
});

test("desglose como el portal web: franqueo = postage - gestion", () => {
  assert.deepEqual(paymentBreakdown(REVIEW), { postage: 950, handling: 300, surcharge: 200, total: 1450, currency: "USD", invoiceNumber: "INV-000123" });
});

test("prepare-payment: factura abierta con su pagina, o pagado", () => {
  const result = interpretPrepareResponse(REVIEW);
  assert.equal(result.kind, "invoice");
  assert.equal(result.paymentUrl, REVIEW.paymentUrl);
  assert.equal(result.autoCharge, null, "la revision no intenta cobrar");

  assert.equal(interpretPrepareResponse({ success: true, provider: "ZOHO", paid: true, paymentStatus: "PAID", autoCharge: { attempted: true, paid: true } }).kind, "paid");
  assert.equal(interpretPrepareResponse({ provider: "ZOHO", alreadyPaid: true, paymentStatus: "PAID" }).kind, "paid");
  assert.equal(interpretPrepareResponse({ ...REVIEW, paymentUrl: "http://insecure.example" }).kind, "invalid");
  assert.equal(interpretPrepareResponse({ ...REVIEW, paymentUrl: null }).kind, "invalid");
});

test("autoCharge.reason: que ofrecer en cada caso", () => {
  assert.equal(autoChargeOutcome(null), null);
  const none = autoChargeOutcome({ attempted: false, paid: false, reason: "NO_SAVED_CARD" });
  assert.equal(none.offerAddPaymentMethod, true);
  const declined = autoChargeOutcome({ attempted: true, paid: false, reason: "DECLINED" });
  assert.equal(declined.offerUpdateCard, true);
  assert.match(declined.message, /not charged/);
  const unconfirmed = autoChargeOutcome({ attempted: true, paid: false, reason: "COLLECT_UNCONFIRMED" });
  assert.equal(unconfirmed.holdMs, COLLECT_UNCONFIRMED_HOLD_MS);
  assert.equal(COLLECT_UNCONFIRMED_HOLD_MS, 30 * 60 * 1000);
  assert.match(unconfirmed.message, /Nothing new was charged/);
  assert.equal(autoChargeOutcome({ attempted: true, paid: true }).reason, "PAID");
});

test("enlace caducado (o a menos de un minuto): se pide una pagina nueva", () => {
  const now = Date.parse("2026-11-13T12:00:00.000Z");
  assert.equal(isPaymentLinkExpired("2026-11-13T11:59:00.000Z", now), true);
  assert.equal(isPaymentLinkExpired("2026-11-13T12:00:30.000Z", now), true, "margen de 60 s");
  assert.equal(isPaymentLinkExpired("2026-11-13T12:30:00.000Z", now), false);
  assert.equal(isPaymentLinkExpired(null, now), false);
  assert.equal(isPaymentLinkExpired("no-date", now), false);
});

test("payment-status: completado, pendiente, fallido, revision, reembolsado, cancelado y enlace caducado", () => {
  assert.deepEqual(
    [
      { paymentStatus: "PAID" },
      { paymentStatus: "PAYMENT_PENDING", chargeStatus: "INVOICE_OPEN", paymentLinkExpired: false },
      { paymentStatus: "FAILED", chargeStatus: "FAILED" },
      { paymentStatus: "PAYMENT_PENDING", chargeStatus: "REVIEW" },
      { paymentStatus: "REFUNDED" },
      { paymentStatus: "CANCELLED" },
      { paymentStatus: "PAYMENT_PENDING", chargeStatus: "INVOICE_OPEN", paymentLinkExpired: true },
      {},
    ].map((s) => interpretPaymentStatus(s).state),
    ["paid", "pending", "failed", "review", "refunded", "cancelled", "link-expired", "pending"]
  );
  assert.equal(interpretPaymentStatus({ paymentStatus: "PAYMENT_PENDING" }).terminal, false);
  assert.equal(interpretPaymentStatus({ paymentStatus: "PAID" }).terminal, true);
});

test("errores de prepare-payment: recotizacion, ya pagado, revision, en curso, resultado incierto", () => {
  const reprice = preparePaymentError(err(409, { error: "x", code: "FORWARDING_PRICE_RECONFIRMATION_REQUIRED", reprice: { previousAmount: 950, currentAmount: 1100, currency: "USD" } }));
  assert.equal(reprice.kind, "reprice");
  assert.equal(reprice.currentAmount, 1100);
  assert.equal(preparePaymentError(err(409, { code: "FORWARDING_ALREADY_PAID" })).kind, "paid");
  assert.equal(preparePaymentError(err(409, { code: "ZOHO_PAYMENT_UNDER_REVIEW" })).retryable, false);
  assert.equal(preparePaymentError(err(409, { code: "ZOHO_PAYMENT_IN_PROGRESS" })).checkStatus, true);
  const uncertain = preparePaymentError(err(503, { error: "x", code: "ZOHO_OUTCOME_UNCERTAIN" }));
  assert.equal(uncertain.kind, "unknown-outcome");
  assert.equal(uncertain.retryable, false, "no se vuelve a cobrar a ciegas");
  assert.equal(preparePaymentError(err(409, { code: "ONLINE_PAYMENTS_UNAVAILABLE" })).kind, "unavailable");
  assert.equal(preparePaymentError(err(409, { code: "FORWARDING_PACKAGE_CHANGED" })).kind, "not-payable");
  assert.equal(preparePaymentError(err(409, { code: "FORWARDING_REPRICE_EXPIRED" })).kind, "reprice-expired");
  // Sin respuesta (timeout, red): el resultado es desconocido. Se comprueba el estado, no se reintenta.
  const timeout = preparePaymentError(new AxiosError("timeout", "ECONNABORTED", {}, {}));
  assert.equal(timeout.kind, "unknown-outcome");
  assert.equal(timeout.retryable, false);
  assert.equal(timeout.checkStatus, true);
});

// ── Sondeo de payment-status ────────────────────────────────────────────────

function fakeClock(start = 1_000_000) {
  let now = start;
  const queue = [];
  return {
    now: () => now,
    schedule: (fn, delay) => {
      const task = { fn, at: now + delay, delay, cancelled: false };
      queue.push(task);
      return task;
    },
    cancel: (task) => task && (task.cancelled = true),
    // Avanza tarea a tarea: cada una corre en su hora, como un reloj de verdad.
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue.find((t) => !t.cancelled && t.at <= target);
        if (!next) break;
        next.cancelled = true;
        now = Math.max(now, next.at);
        await next.fn();
      }
      now = target;
    },
    queue,
  };
}

test("el sondeo: como mucho cada 15 s, 4 intentos, y para al confirmarse", async () => {
  const clock = fakeClock();
  const calls = [];
  const results = [];
  let status = { paymentStatus: "PAYMENT_PENDING", chargeStatus: "INVOICE_OPEN" };
  const poller = createStatusPoller({
    fetchStatus: async () => (calls.push(clock.now()), status),
    onResult: (r) => results.push(r.reading.state),
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  poller.start();
  await clock.advance(0);
  assert.equal(calls.length, 1, "al volver del navegador, una consulta");
  await clock.advance(14_999);
  assert.equal(calls.length, 1, "nunca antes de 15 s");
  await clock.advance(1);
  assert.equal(calls.length, 2);

  status = { paymentStatus: "PAID" };
  await clock.advance(15_000);
  assert.equal(calls.length, 3);
  assert.deepEqual(results, ["pending", "pending", "paid"]);
  await clock.advance(120_000);
  assert.equal(calls.length, 3, "confirmado: no se pregunta mas");
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i] - calls[i - 1] >= 15_000);
});

test("sin confirmacion: 4 intentos y para; 'Check again' respeta los 15 s", async () => {
  const clock = fakeClock();
  let calls = 0;
  const poller = createStatusPoller({
    fetchStatus: async () => (calls++, { paymentStatus: "PAYMENT_PENDING" }),
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  poller.start();
  await clock.advance(0);
  await clock.advance(15_000 * 5);
  assert.equal(calls, 4);

  // Recien consultado: "Check again" espera lo que falta en vez de preguntar ya.
  const wait = poller.checkNow();
  assert.equal(wait, 0, "pasaron mas de 15 s desde la ultima");
  await clock.advance(0);
  assert.equal(calls, 5);
  const tooSoon = poller.checkNow();
  assert.ok(tooSoon > 0 && tooSoon <= 15_000);
  await clock.advance(tooSoon - 1);
  assert.equal(calls, 5);
  await clock.advance(1);
  assert.equal(calls, 6);
});

test("el sondeo no baja de 15 s aunque se le pida menos, y solo lee", async () => {
  const clock = fakeClock();
  const urls = [];
  const poller = createStatusPoller({
    minIntervalMs: 1000,
    fetchStatus: async () => (urls.push("payment-status"), { paymentStatus: "PAYMENT_PENDING" }),
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  poller.start();
  await clock.advance(0);
  await clock.advance(5000);
  assert.equal(urls.length, 1);
  poller.stop();
  await clock.advance(60_000);
  assert.equal(urls.length, 1, "parado no pregunta");
});

test("un error de red en el sondeo no para nada ni cobra: sigue preguntando a su ritmo", async () => {
  const clock = fakeClock();
  let calls = 0;
  const poller = createStatusPoller({
    fetchStatus: async () => {
      calls++;
      if (calls === 1) throw new AxiosError("Network Error", "ERR_NETWORK");
      return { paymentStatus: "PAID" };
    },
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  poller.start();
  await clock.advance(0);
  await clock.advance(15_000);
  assert.equal(calls, 2);
});

// ── Sin cobros sin accion del cliente, sin repetir cobros ───────────────────

test("prepare-payment solo dentro de mutaciones (acciones del cliente), nunca en efectos ni al montar", () => {
  const card = read("src/components/common/zoho-forward-payment-card.jsx");
  const code = card.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  // Sin efectos: lo que pasa solo (sondeo, volver a primer plano) es lib/use-payment-status, que solo lee.
  assert.doesNotMatch(code, /useEffect\(/);
  const hook = read("src/lib/use-payment-status.js").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(hook, /api\.post|preparePaymentPath|checkout-session|\.mutate/);
  assert.match(hook, /api\.get\(paymentStatusPath\(serviceRequestId\)\)/);
  const prepareCalls = code.match(/api\.post\(preparePaymentPath\(request\.id\)/g) || [];
  assert.equal(prepareCalls.length, 3, "revision, tarjeta guardada y regenerar la pagina caducada");
  for (const mutation of code.match(/useMutation\(\{[\s\S]*?\n  \}\);/g) || []) {
    assert.doesNotMatch(mutation, /\bretry\s*:/);
  }
  // La tarjeta guardada solo se ofrece en revision (con la factura ya vista).
  assert.ok(code.indexOf("allowSavedCard ? (") > code.indexOf("!invoice ? ("));
  // Abre el navegador del sistema; nunca un WebView.
  assert.match(code, /WebBrowser\.openBrowserAsync\(current\.paymentUrl\)/);
  assert.doesNotMatch(code, /WebView/);
  // payment-status: el hook comun (solo GET).
  assert.match(code, /usePaymentStatus\(\{/);
});

test("un prepare-payment con la tarjeta guardada que agota el timeout se envia una sola vez", async () => {
  const data = new Map();
  const store = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
  configureStorage({ ...store, secure: store });
  await setTokens({ accessToken: "a", refreshToken: "r" });
  let posts = 0;
  const api = createApiClient({
    baseURL: "https://sandbox-core.hdgexecutivesuites.com/api/v1",
    adapter: (config) => {
      posts++;
      return Promise.reject(new AxiosError("timeout of 20000ms exceeded", "ECONNABORTED", config, {}));
    },
  });
  await assert.rejects(api.post(preparePaymentPath("sr1"), SAVED_CARD_BODY));
  assert.equal(posts, 1);
});
