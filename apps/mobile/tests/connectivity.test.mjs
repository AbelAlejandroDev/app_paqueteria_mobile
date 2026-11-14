import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { AxiosError } from "axios";
import { MutationObserver, QueryClient } from "@tanstack/query-core";

import {
  AVAILABILITY_OFFLINE,
  AVAILABILITY_TIMEOUT,
  AVAILABILITY_UNAVAILABLE,
  AUTH_USER_UPDATED_EVENT,
  classifyAvailability,
  configureStorage,
  createApiClient,
  createApiProbe,
  DEFAULT_TIMEOUT_MS,
  getAuthUser,
  getTokens,
  on,
  PROBE_PATH,
  setAuthUser,
  setTokens,
} from "@paqueteria/core";
import { attachAppInterceptors } from "../src/lib/api-interceptors.js";
import {
  getServiceStatus,
  nextProbeDelay,
  reportServiceFailure,
  reportServiceRecovered,
  resetServiceStatusForTests,
  SERVICE_OK,
  startRecoveryLoop,
} from "../src/lib/service-status.js";
import { QUERY_DEFAULT_OPTIONS, shouldRetryQuery, UPLOAD_TIMEOUT_MS } from "../src/lib/query-defaults.js";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const { resolveApiTimeout, DEFAULT_API_TIMEOUT_MS } = require("../brands/api-environment.js");

// ── Utilidades ─────────────────────────────────────────────────────────────

function memoryStore() {
  const data = new Map();
  const backend = {
    getItem: async (key) => (data.has(key) ? data.get(key) : null),
    setItem: async (key, value) => void data.set(key, value),
    removeItem: async (key) => void data.delete(key),
  };
  return { ...backend, secure: backend };
}

function reply(config, status, data) {
  const response = { data, status, statusText: String(status), headers: {}, config };
  if (status >= 200 && status < 300) return Promise.resolve(response);
  return Promise.reject(new AxiosError("Request failed with status code " + status, "ERR_BAD_RESPONSE", config, {}, response));
}
const networkError = (config) => Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config, {}));
const timeoutError = (config) =>
  Promise.reject(new AxiosError("timeout of " + config.timeout + "ms exceeded", "ECONNABORTED", config, {}));
const httpError = (status, data) => ({ response: { status, data } });

/** Cliente de la app (core + interceptores de la app) contra un servidor simulado. */
async function appClient(handler) {
  resetServiceStatusForTests();
  configureStorage(memoryStore());
  await setTokens({ accessToken: "access", refreshToken: "refresh" });
  await setAuthUser({ id: "u1", tenantId: "worx", role: "CLIENT" });
  const calls = [];
  const unauthorized = [];
  const broadcasts = [];
  const off = on(AUTH_USER_UPDATED_EVENT, (u) => broadcasts.push(u));
  const api = attachAppInterceptors(
    createApiClient({
      baseURL: "https://api.example.test/api/v1",
      onUnauthorized: (reason) => unauthorized.push(reason),
      adapter: (config) => {
        calls.push({ method: config.method, url: config.url, timeout: config.timeout });
        return handler(config, calls.length);
      },
    })
  );
  return { api, calls, unauthorized, broadcasts, off };
}

async function assertSessionKept(ctx) {
  assert.deepEqual(await getTokens(), { accessToken: "access", refreshToken: "refresh" });
  assert.deepEqual(await getAuthUser(), { id: "u1", tenantId: "worx", role: "CLIENT" });
  assert.deepEqual(ctx.unauthorized, []);
  assert.deepEqual(ctx.broadcasts, []);
}

/** Un setTimeout manual: los tests deciden cuando corre cada espera. */
function manualScheduler() {
  const queue = [];
  return {
    queue,
    schedule: (fn, delay) => {
      const task = { fn, delay, cancelled: false };
      queue.push(task);
      return task;
    },
    cancel: (task) => {
      if (task) task.cancelled = true;
    },
    async runNext() {
      const task = queue.shift();
      if (task && !task.cancelled) await task.fn();
      return task;
    },
  };
}

// ── Que cuenta como "servicio no disponible" ───────────────────────────────

test("sin red es offline; un timeout es timeout", () => {
  assert.equal(classifyAvailability(new AxiosError("Network Error", "ERR_NETWORK", {}, {})), AVAILABILITY_OFFLINE);
  assert.equal(classifyAvailability(new AxiosError("timeout of 20000ms exceeded", "ECONNABORTED", {}, {})), AVAILABILITY_TIMEOUT);
  assert.equal(classifyAvailability(new AxiosError("timeout", "ETIMEDOUT", {}, {})), AVAILABILITY_TIMEOUT);
});

test("502, 503 y 504 del proxy (sin el JSON del backend) son una caida", () => {
  for (const status of [502, 503, 504]) {
    assert.equal(classifyAvailability(httpError(status, "<html>Bad Gateway</html>")), AVAILABILITY_UNAVAILABLE, String(status));
    assert.equal(classifyAvailability(httpError(status, "")), AVAILABILITY_UNAVAILABLE, String(status));
  }
  // Otros 5xx sin el cuerpo del backend (un proxy, una CDN): tambien.
  assert.equal(classifyAvailability(httpError(500, "<html>")), AVAILABILITY_UNAVAILABLE);
  assert.equal(classifyAvailability(httpError(520, null)), AVAILABILITY_UNAVAILABLE);
});

test("un 5xx con el JSON del backend es un error de esa peticion, no mantenimiento", () => {
  // Contratos reales del backend (handoff HDG, D.4 y G.4).
  assert.equal(classifyAvailability(httpError(503, { error: "x", code: "ADDRESS_VERIFICATION_UNAVAILABLE" })), null);
  assert.equal(classifyAvailability(httpError(503, { error: "x", code: "ZOHO_OUTCOME_UNCERTAIN" })), null);
  assert.equal(classifyAvailability(httpError(502, { error: "x", code: "ZOHO_PAYMENT_PAGE_UNAVAILABLE" })), null);
  assert.equal(classifyAvailability(httpError(504, { error: "x", code: "PITNEY_BOWES_TIMEOUT" })), null);
  assert.equal(classifyAvailability(httpError(500, { error: "Internal server error" })), null);
});

test("4xx y cancelaciones no son una caida", () => {
  for (const status of [400, 401, 402, 403, 404, 409, 429]) {
    assert.equal(classifyAvailability(httpError(status, { error: "x" })), null, String(status));
  }
  assert.equal(classifyAvailability(new AxiosError("canceled", "ERR_CANCELED")), null);
  assert.equal(classifyAvailability(null), null);
});

// ── Recuperacion despues de un 503 ─────────────────────────────────────────

test("tras un 503 la app marca el servicio caido, sondea y se recupera sin perder la sesion", async () => {
  let up = false;
  const ctx = await appClient((config) => (up ? reply(config, 200, { ok: true }) : reply(config, 503, "<html>503</html>")));
  try {
    await assert.rejects(ctx.api.get("/client/mail-items"));
    assert.equal(getServiceStatus().status, AVAILABILITY_UNAVAILABLE);
    await assertSessionKept(ctx);

    // La sonda: GET /auth/me sin token. Primero sigue caido, luego responde 401 JSON.
    const probeCalls = [];
    const probe = createApiProbe({
      baseURL: "https://api.example.test/api/v1",
      adapter: (config) => {
        probeCalls.push(config);
        return Promise.resolve({
          data: up ? { error: "Missing Bearer token" } : "<html>503</html>",
          status: up ? 401 : 503,
          headers: {},
          config,
        });
      },
    });

    const timers = manualScheduler();
    let recovered = 0;
    startRecoveryLoop({
      probe,
      onRecovered: () => {
        recovered += 1;
        reportServiceRecovered();
      },
      schedule: timers.schedule,
      cancel: timers.cancel,
    });

    assert.equal(timers.queue[0].delay, 5000);
    await timers.runNext();
    assert.equal(recovered, 0, "sigue caido");
    assert.equal(timers.queue[0].delay, 10000, "espera creciente");

    up = true;
    await timers.runNext();
    assert.equal(recovered, 1);
    assert.equal(getServiceStatus().status, SERVICE_OK);
    assert.equal(timers.queue.length, 0, "deja de sondear");

    // La sonda nunca lleva el token ni toca la sesion.
    assert.equal(probeCalls.length, 2);
    for (const call of probeCalls) {
      assert.equal(call.url, PROBE_PATH);
      assert.equal(call.headers?.Authorization || call.headers?.get?.("Authorization") || undefined, undefined);
    }
    await assertSessionKept(ctx);

    // La app vuelve a funcionar.
    assert.deepEqual((await ctx.api.get("/client/mail-items")).data, { ok: true });
  } finally {
    ctx.off();
  }
});

test("cualquier respuesta del backend (aunque sea un error) marca el servicio como disponible", async () => {
  const ctx = await appClient((config, n) =>
    n === 1 ? networkError(config) : reply(config, 409, { error: "Conflict", code: "CENTER_POLICY_NOT_CONFIGURED" })
  );
  try {
    await assert.rejects(ctx.api.get("/client/a"));
    assert.equal(getServiceStatus().status, AVAILABILITY_OFFLINE);
    await assert.rejects(ctx.api.get("/client/b"));
    assert.equal(getServiceStatus().status, SERVICE_OK);
  } finally {
    ctx.off();
  }
});

test("un 503 propio del backend (Pitney) no enciende la pantalla de mantenimiento", async () => {
  const ctx = await appClient((config) => reply(config, 503, { error: "x", code: "ADDRESS_VERIFICATION_UNAVAILABLE" }));
  try {
    await assert.rejects(ctx.api.post("/client/forwarding-addresses/verify", {}), (e) => e.response.data.code === "ADDRESS_VERIFICATION_UNAVAILABLE");
    assert.equal(getServiceStatus().status, SERVICE_OK);
  } finally {
    ctx.off();
  }
});

test("el bucle de recuperacion: 'Try again' comprueba ya, stop() lo para, y una sonda que lanza cuenta como caida", async () => {
  const timers = manualScheduler();
  let ok = false;
  let recovered = 0;
  const loop = startRecoveryLoop({
    probe: async () => {
      if (!ok) throw new Error("boom");
      return true;
    },
    onRecovered: () => (recovered += 1),
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  assert.equal(await loop.checkNow(), false);
  ok = true;
  assert.equal(await loop.checkNow(), true);
  assert.equal(recovered, 1);

  const stopped = startRecoveryLoop({ probe: async () => true, onRecovered: () => assert.fail("parado"), schedule: timers.schedule, cancel: timers.cancel });
  stopped.stop();
  await timers.runNext();
});

test("espera entre sondas: 5, 10, 20, 30 y luego 60 s", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 50].map(nextProbeDelay), [5000, 10000, 20000, 30000, 60000, 60000, 60000]);
});

test("el estado guarda desde cuando esta caido y vuelve a ok", () => {
  resetServiceStatusForTests();
  reportServiceFailure(AVAILABILITY_OFFLINE, 1000);
  reportServiceFailure(AVAILABILITY_TIMEOUT, 5000);
  assert.deepEqual(getServiceStatus(), { status: AVAILABILITY_TIMEOUT, reason: AVAILABILITY_TIMEOUT, since: 1000 });
  reportServiceFailure("otra-cosa");
  assert.equal(getServiceStatus().status, AVAILABILITY_TIMEOUT, "motivos desconocidos se ignoran");
  reportServiceRecovered();
  assert.deepEqual(getServiceStatus(), { status: SERVICE_OK, reason: null, since: null });
});

// ── Sin conexion y timeout ─────────────────────────────────────────────────

test("sin conexion: pantalla offline y la sesion intacta", async () => {
  const ctx = await appClient(networkError);
  try {
    await assert.rejects(ctx.api.get("/client/mail-items"));
    assert.equal(getServiceStatus().status, AVAILABILITY_OFFLINE);
    await assertSessionKept(ctx);
  } finally {
    ctx.off();
  }
});

test("timeout: pantalla de timeout y la sesion intacta", async () => {
  const ctx = await appClient(timeoutError);
  try {
    await assert.rejects(ctx.api.get("/client/mail-items"));
    assert.equal(getServiceStatus().status, AVAILABILITY_TIMEOUT);
    await assertSessionKept(ctx);
  } finally {
    ctx.off();
  }
});

test("el cliente HTTP lleva un timeout por defecto, configurable y ampliable por peticion", async () => {
  const ctx = await appClient((config) => reply(config, 200, {}));
  try {
    await ctx.api.get("/a");
    await ctx.api.post("/client/usps-compliance", {}, { timeout: UPLOAD_TIMEOUT_MS });
    assert.equal(ctx.calls[0].timeout, DEFAULT_TIMEOUT_MS);
    assert.equal(ctx.calls[1].timeout, UPLOAD_TIMEOUT_MS);
  } finally {
    ctx.off();
  }

  let seen = null;
  const custom = createApiClient({ baseURL: "https://x.test", timeout: 7000, adapter: (config) => ((seen = config.timeout), reply(config, 200, {})) });
  await custom.get("/a");
  assert.equal(seen, 7000);

  assert.equal(DEFAULT_TIMEOUT_MS, 20000);
  assert.equal(DEFAULT_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, "build y core tienen el mismo defecto");
  assert.match(read("src/app/(client)/usps-verification.jsx"), /timeout: UPLOAD_TIMEOUT_MS/);
});

test("API_TIMEOUT_MS: por defecto 20 s; fuera de 5-120 s es un error de configuracion", () => {
  assert.equal(resolveApiTimeout({}), 20000);
  assert.equal(resolveApiTimeout({ API_TIMEOUT_MS: "30000" }), 30000);
  for (const bad of ["abc", "1000", "999999", "15.5"]) {
    assert.throws(() => resolveApiTimeout({ API_TIMEOUT_MS: bad }), /API_TIMEOUT_MS/, bad);
  }
  assert.match(read("app.config.js"), /network: \{ timeoutMs: apiTimeoutMs \}/);
  assert.match(read("src/lib/api.js"), /timeout: API_TIMEOUT_MS/);
});

// ── Operaciones financieras: sin reintentos duplicados ─────────────────────

const FINANCIAL_POSTS = [
  "/client/forwarding/sr1/checkout-session",
  "/client/forwarding/sr1/prepare-payment",
  "/client/billing/payment-portal",
  "/client/service-requests",
  "/client/forwarding/quotes/select",
];

for (const [label, failure] of [
  ["timeout", timeoutError],
  ["sin red", networkError],
  ["503 del proxy", (config) => reply(config, 503, "<html>")],
  ["503 del backend", (config) => reply(config, 503, { error: "x", code: "ZOHO_OUTCOME_UNCERTAIN" })],
  ["500", (config) => reply(config, 500, { error: "Internal server error" })],
]) {
  test(`un POST financiero que falla por ${label} se envia una sola vez`, async () => {
    for (const url of FINANCIAL_POSTS) {
      const ctx = await appClient(failure);
      try {
        await assert.rejects(ctx.api.post(url, {}));
        assert.equal(ctx.calls.length, 1, url);
      } finally {
        ctx.off();
      }
    }
  });
}

test("tras un 401 con refresh correcto el POST se repite una sola vez (el 401 es previo al controlador)", async () => {
  const ctx = await appClient((config) => {
    if (String(config.url).endsWith("/auth/refresh")) return reply(config, 200, { accessToken: "new", refreshToken: "new-r" });
    const auth = config.headers?.Authorization || config.headers?.get?.("Authorization");
    return auth === "Bearer new" ? reply(config, 201, { url: "https://checkout.stripe.test/x" }) : reply(config, 401, { error: "Invalid or expired token" });
  });
  try {
    await ctx.api.post("/client/forwarding/sr1/checkout-session", {});
    const posts = ctx.calls.filter((c) => c.url.endsWith("/checkout-session"));
    assert.equal(posts.length, 2, "el original rechazado por authMiddleware y una repeticion");
  } finally {
    ctx.off();
  }
});

test("un POST con 401 y el refresh caido no se repite", async () => {
  const ctx = await appClient((config) =>
    String(config.url).endsWith("/auth/refresh") ? reply(config, 503, "") : reply(config, 401, { error: "Invalid or expired token" })
  );
  try {
    await assert.rejects(ctx.api.post("/client/forwarding/sr1/checkout-session", {}));
    assert.equal(ctx.calls.filter((c) => c.url.endsWith("/checkout-session")).length, 1);
    await assertSessionKept(ctx);
  } finally {
    ctx.off();
  }
});

test("React Query: las mutaciones nunca se reintentan solas", async () => {
  assert.equal(QUERY_DEFAULT_OPTIONS.mutations.retry, false);
  const queryClient = new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS });
  let attempts = 0;
  const observer = new MutationObserver(queryClient, {
    mutationFn: async () => {
      attempts += 1;
      throw new AxiosError("Network Error", "ERR_NETWORK", {}, {});
    },
  });
  await assert.rejects(observer.mutate({}));
  assert.equal(attempts, 1);
});

test("ninguna mutacion de la app pide reintentos", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir + "/" + entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
        const source = read(rel);
        for (const block of source.match(/useMutation\(\{[\s\S]*?\n\s*\}\);/g) || []) {
          if (/\bretry\s*:/.test(block)) offenders.push(rel);
        }
      }
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
  assert.match(read("src/app/_layout.jsx"), /new QueryClient\(\{ defaultOptions: QUERY_DEFAULT_OPTIONS \}\)/);
});

test("consultas (GET): un reintento como mucho, ninguno con 4xx ni con el servicio caido", () => {
  assert.equal(shouldRetryQuery(0, httpError(500, { error: "x" })), true);
  assert.equal(shouldRetryQuery(1, httpError(500, { error: "x" })), false);
  assert.equal(shouldRetryQuery(0, httpError(404, { error: "x" })), false);
  assert.equal(shouldRetryQuery(0, httpError(503, "<html>")), false);
  assert.equal(shouldRetryQuery(0, new AxiosError("Network Error", "ERR_NETWORK", {}, {})), false);
});

// ── Cableado de la pantalla ────────────────────────────────────────────────

test("la pantalla de servicio no disponible va por encima de todo y no cierra la sesion", () => {
  const layout = read("src/app/_layout.jsx");
  assert.ok(layout.indexOf("<ServiceUnavailable />") > layout.indexOf("<Stack"), "despues del Stack: queda encima");
  assert.ok(layout.indexOf("<ServiceUnavailable />") < layout.indexOf("</AuthProvider>"), "dentro de AuthProvider");

  const screen = read("src/components/common/service-unavailable.jsx");
  assert.doesNotMatch(screen, /clearTokens|clearAuthUser|logout|endLocalSession/);
  assert.match(screen, /invalidateQueries\(\{ type: "active" \}\)/, "al volver, solo relee consultas");
  assert.doesNotMatch(screen, /mutate\(|resumePausedMutations/, "no repite mutaciones");
  assert.match(screen, /AppState\.addEventListener/, "comprueba al volver a primer plano");

  const api = read("src/lib/api.js");
  assert.match(api, /attachAppInterceptors\(api\)/);
});
