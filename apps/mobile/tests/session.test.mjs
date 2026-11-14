import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AxiosError } from "axios";

// Por el nombre del paquete: el cliente HTTP y el almacen tienen que ser el
// mismo modulo que usa la app (ver la nota de tests/onboarding-state.test.mjs).
import {
  AUTH_USER_UPDATED_EVENT,
  classifySessionError,
  configureStorage,
  createApiClient,
  getAuthUser,
  getTokens,
  isRefreshRejection,
  on,
  setAuthUser,
  setTokens,
  SESSION_FORBIDDEN,
  SESSION_INVALID,
  SESSION_TEMPORARY,
} from "@paqueteria/core";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// ── Utilidades: almacen en memoria y un servidor simulado ──────────────────

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
const timeoutError = (config) => Promise.reject(new AxiosError("timeout of 10000ms exceeded", "ECONNABORTED", config, {}));

/**
 * Un cliente con sesion guardada (tokens "old") cuyo /client/data responde 401
 * con el token viejo, y cuyo /auth/refresh responde lo que diga `onRefresh`.
 */
async function setup({ onRefresh, onData } = {}) {
  configureStorage(memoryStore());
  await setTokens({ accessToken: "old-access", refreshToken: "old-refresh" });
  await setAuthUser({ id: "u1", tenantId: "worx", role: "CLIENT" });

  const calls = { refresh: 0, data: 0, unauthorized: [], broadcasts: [] };
  const off = on(AUTH_USER_UPDATED_EVENT, (u) => calls.broadcasts.push(u));

  const adapter = (config) => {
    const url = String(config.url);
    if (url.endsWith("/auth/refresh")) {
      calls.refresh += 1;
      return onRefresh(config, calls.refresh);
    }
    calls.data += 1;
    if (onData) return onData(config, calls.data);
    const auth = config.headers?.Authorization || config.headers?.get?.("Authorization");
    return auth === "Bearer new-access" ? reply(config, 200, { ok: true }) : reply(config, 401, { error: "Invalid or expired token" });
  };

  const api = createApiClient({
    baseURL: "https://api.example.test/api/v1",
    onUnauthorized: (reason) => calls.unauthorized.push(reason),
    adapter,
  });

  return { api, calls, off };
}

async function sessionKept(calls) {
  const tokens = await getTokens();
  assert.equal(tokens.accessToken, "old-access", "el access token sigue guardado");
  assert.equal(tokens.refreshToken, "old-refresh", "el refresh token sigue guardado");
  assert.deepEqual(await getAuthUser(), { id: "u1", tenantId: "worx", role: "CLIENT" }, "el usuario guardado sigue");
  assert.deepEqual(calls.unauthorized, [], "no se manda al login");
  assert.deepEqual(calls.broadcasts, [], "no se anuncia el cierre de sesion");
}

async function sessionEnded(calls, reason) {
  const tokens = await getTokens();
  assert.equal(tokens.accessToken, null);
  assert.equal(tokens.refreshToken, null);
  assert.equal(await getAuthUser(), null);
  assert.deepEqual(calls.unauthorized, [reason]);
  assert.deepEqual(calls.broadcasts, [null]);
}

// ── Refresh que falla por algo pasajero: la sesion se conserva ─────────────

const TEMPORARY_REFRESH_FAILURES = [
  ["sin red", (config) => networkError(config)],
  ["timeout", (config) => timeoutError(config)],
  ["429 Too Many Requests", (config) => reply(config, 429, { error: "Too many requests" })],
  ["500", (config) => reply(config, 500, { error: "Internal Server Error" })],
  ["502 del proxy (HTML)", (config) => reply(config, 502, "<html>Bad Gateway</html>")],
  ["503 mantenimiento", (config) => reply(config, 503, "<html>Service Unavailable</html>")],
  ["504", (config) => reply(config, 504, "")],
  ["400 sin cuerpo del backend (proxy)", (config) => reply(config, 400, "<html>Bad Request</html>")],
];

for (const [label, onRefresh] of TEMPORARY_REFRESH_FAILURES) {
  test(`refresh con ${label}: no se borran los tokens ni se aborta la sesion`, async () => {
    const { api, calls, off } = await setup({ onRefresh });
    try {
      await assert.rejects(api.get("/client/data"));
      assert.equal(calls.refresh, 1);
      await sessionKept(calls);
    } finally {
      off();
    }
  });
}

test("tras un refresh fallido por la red, la siguiente peticion vuelve a intentarlo y recupera la sesion", async () => {
  const { api, calls, off } = await setup({
    onRefresh: (config, n) =>
      n === 1 ? networkError(config) : reply(config, 200, { accessToken: "new-access", refreshToken: "new-refresh" }),
  });
  try {
    await assert.rejects(api.get("/client/data"));
    await sessionKept(calls);

    const response = await api.get("/client/data");
    assert.deepEqual(response.data, { ok: true });
    assert.equal(calls.refresh, 2);
    assert.deepEqual(await getTokens(), { accessToken: "new-access", refreshToken: "new-refresh" });
    assert.deepEqual(calls.unauthorized, []);
  } finally {
    off();
  }
});

test("varias peticiones a la vez con el refresh caido: todas fallan, un solo refresh, la sesion sigue", async () => {
  const { api, calls, off } = await setup({ onRefresh: (config) => reply(config, 503, "") });
  try {
    const results = await Promise.allSettled([api.get("/client/data"), api.get("/client/data"), api.get("/client/data")]);
    assert.ok(results.every((r) => r.status === "rejected"));
    assert.equal(calls.refresh, 1);
    await sessionKept(calls);
  } finally {
    off();
  }
});

// ── Rechazo inequivoco del servidor: la sesion se cierra ───────────────────

test("refresh 401 SESSION_REVOKED: se borran tokens y usuario y se va al login con el motivo", async () => {
  const { api, calls, off } = await setup({
    onRefresh: (config) => reply(config, 401, { error: "Session revoked", code: "SESSION_REVOKED" }),
  });
  try {
    await assert.rejects(api.get("/client/data"));
    await sessionEnded(calls, "SESSION_REVOKED");
  } finally {
    off();
  }
});

test("refresh 401 Invalid refresh token: se cierra la sesion", async () => {
  const { api, calls, off } = await setup({ onRefresh: (config) => reply(config, 401, { error: "Invalid refresh token" }) });
  try {
    await assert.rejects(api.get("/client/data"));
    await sessionEnded(calls, null);
  } finally {
    off();
  }
});

test("refresh 400 Invalid body del backend: el token guardado no sirve, se cierra la sesion", async () => {
  const { api, calls, off } = await setup({ onRefresh: (config) => reply(config, 400, { error: "Invalid body" }) });
  try {
    await assert.rejects(api.get("/client/data"));
    await sessionEnded(calls, null);
  } finally {
    off();
  }
});

test("refresh correcto: guarda el refresh rotado y repite la peticion", async () => {
  const { api, calls, off } = await setup({
    onRefresh: (config) => reply(config, 200, { accessToken: "new-access", refreshToken: "new-refresh" }),
  });
  try {
    const response = await api.get("/client/data");
    assert.deepEqual(response.data, { ok: true });
    assert.deepEqual(await getTokens(), { accessToken: "new-access", refreshToken: "new-refresh" });
    assert.deepEqual(calls.unauthorized, []);
  } finally {
    off();
  }
});

// ── Errores de un recurso que no son de sesion ─────────────────────────────

for (const [label, status, data] of [
  ["403 de permisos", 403, { error: "Forbidden" }],
  ["404", 404, { error: "Not found" }],
  ["409", 409, { error: "Conflict", code: "CENTER_POLICY_NOT_CONFIGURED" }],
  ["429", 429, { error: "Too many requests" }],
  ["503", 503, "<html>Service Unavailable</html>"],
]) {
  test(`un ${label} en un recurso no intenta refresh ni toca la sesion`, async () => {
    const { api, calls, off } = await setup({
      onRefresh: () => assert.fail("no debe pedir refresh"),
      onData: (config) => reply(config, status, data),
    });
    try {
      await assert.rejects(api.get("/client/data"), (error) => error.response.status === status);
      assert.equal(calls.refresh, 0);
      await sessionKept(calls);
    } finally {
      off();
    }
  });
}

test("sin red en un recurso no toca la sesion", async () => {
  const { api, calls, off } = await setup({ onRefresh: () => assert.fail("no debe pedir refresh"), onData: networkError });
  try {
    await assert.rejects(api.get("/client/data"));
    await sessionKept(calls);
  } finally {
    off();
  }
});

// ── Clasificacion de errores de /auth/me (AuthContext.reload) ──────────────

const err = (status, data) => (status === null ? new AxiosError("Network Error", "ERR_NETWORK") : { response: { status, data } });

test("classifySessionError: solo 401 y 404 'User not found' invalidan la sesion", () => {
  assert.equal(classifySessionError(err(401, { error: "Invalid or expired token" })), SESSION_INVALID);
  assert.equal(classifySessionError(err(401, { code: "SESSION_REVOKED" })), SESSION_INVALID);
  assert.equal(classifySessionError(err(404, { error: "User not found" })), SESSION_INVALID);
});

test("classifySessionError: red, timeout, 429, 5xx y 404 ajenos son pasajeros", () => {
  assert.equal(classifySessionError(err(null)), SESSION_TEMPORARY);
  assert.equal(classifySessionError(new AxiosError("timeout", "ECONNABORTED")), SESSION_TEMPORARY);
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(classifySessionError(err(status, "")), SESSION_TEMPORARY, String(status));
  }
  assert.equal(classifySessionError(err(404, "<html>Not Found</html>")), SESSION_TEMPORARY);
  assert.equal(classifySessionError(undefined), SESSION_TEMPORARY);
});

test("classifySessionError: un 403 es de permisos, no cierra la sesion", () => {
  assert.equal(classifySessionError(err(403, { error: "Forbidden" })), SESSION_FORBIDDEN);
});

test("isRefreshRejection: 401 siempre; 400 solo con el cuerpo del backend", () => {
  assert.equal(isRefreshRejection(err(401, {})), true);
  assert.equal(isRefreshRejection(err(400, { error: "Invalid body" })), true);
  assert.equal(isRefreshRejection(err(400, "<html>")), false);
  assert.equal(isRefreshRejection(err(null)), false);
  for (const status of [403, 404, 429, 500, 502, 503]) assert.equal(isRefreshRejection(err(status, {})), false, String(status));
});

// ── AuthContext: el cableado ────────────────────────────────────────────────

test("AuthContext.reload solo cierra la sesion con un error de credenciales", () => {
  const source = read("src/context/AuthContext.jsx");
  const reload = source.match(/const reload = useCallback\([\s\S]*?\n  \}, \[applyUser, endLocalSession\]\);/)[0];
  const catchBlock = reload.slice(reload.indexOf("} catch (error) {"));
  assert.match(catchBlock, /if \(classifySessionError\(error\) === SESSION_INVALID\) \{\s*await endLocalSession\(\);/);
  // Fuera de esa rama no se borra nada: se sigue con el usuario guardado.
  const afterInvalid = catchBlock.slice(catchBlock.indexOf("const cachedUser"), catchBlock.indexOf("} finally {"));
  assert.doesNotMatch(afterInvalid, /clearTokens|clearAuthUser|endLocalSession/);
  assert.match(afterInvalid, /applyUser\(cachedUser\)/);
  assert.match(afterInvalid, /setSessionUnavailable\(true\)/);
});

test("sin usuario guardado y sin poder comprobar la sesion, se ofrece reintentar en vez del login", () => {
  for (const file of ["src/app/index.jsx", "src/app/(client)/_layout.jsx"]) {
    const source = read(file);
    const gate = source.indexOf("if (!user && sessionUnavailable)");
    assert.ok(gate > 0, file);
    assert.ok(gate < source.indexOf('<Redirect href="/login" />'), file + ": antes de mandar al login");
  }
});
