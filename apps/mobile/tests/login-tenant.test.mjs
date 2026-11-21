import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { AxiosError } from "axios";

import { configureStorage, createApiClient, getTokens, setAuthUser, setTokens } from "@paqueteria/core";
import { requestLogin } from "../src/lib/login-flow.js";
import { isSessionForTenant, loginPayload, tenantSlugOf, WRONG_ORGANIZATION, wrongOrganizationMessage } from "../src/lib/session-tenant.js";
import { loginErrorMessage } from "../src/lib/auth-messages.js";
import { forgotPasswordPayload } from "../src/lib/forgot-password.js";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const { BRANDS } = require("../brands/index.js");
const { resolveApiConfig } = require("../brands/api-environment.js");

// La forma real de serializeAuthUser (backend src/controllers/auth/shared/serializeUser.js).
const userOf = (slug) => ({
  id: "cm-user-" + slug,
  tenantId: "cm-tenant-" + slug,
  role: "CLIENT",
  email: "client@example.test",
  tenant: { id: "cm-tenant-" + slug, name: slug, slug },
});

function memoryStore() {
  const data = new Map();
  const backend = {
    getItem: async (key) => (data.has(key) ? data.get(key) : null),
    setItem: async (key, value) => void data.set(key, value),
    removeItem: async (key) => void data.delete(key),
  };
  return { ...backend, secure: backend };
}

/**
 * Un servidor de login como el real: con tenantSlug lo resuelve; sin el (ni
 * portal) responde 400 "tenantId: expected string, received undefined", que es
 * lo que devolvia HDG Sandbox (comprobado con una cuenta ficticia).
 */
function loginServer({ resolvesTo = (slug) => slug } = {}) {
  const bodies = [];
  const adapter = (config) => {
    const body = JSON.parse(config.data || "{}");
    bodies.push({ url: config.url, body, headers: config.headers });
    const reply = (status, data) => {
      const response = { data, status, statusText: String(status), headers: {}, config };
      return status < 300 ? Promise.resolve(response) : Promise.reject(new AxiosError("x", "ERR_BAD_REQUEST", config, {}, response));
    };
    if (!body.tenantSlug && !body.tenantId) return reply(400, { error: "Invalid body", details: { properties: { tenantId: {} } } });
    if (body.password !== "right-password") return reply(401, { error: "Invalid credentials" });
    const slug = resolvesTo(body.tenantSlug);
    return reply(200, { accessToken: "access-" + slug, refreshToken: "refresh-" + slug, user: userOf(slug), terms: {} });
  };
  return { adapter, bodies };
}

const apiFor = (brandId, adapter) => {
  configureStorage(memoryStore());
  return createApiClient({ baseURL: resolveApiConfig({ brand: BRANDS[brandId], env: {} }).url, adapter });
};

// ── Login de cada marca ─────────────────────────────────────────────────────

for (const brandId of ["the_worx", "hdg"]) {
  test(`login de ${brandId}: manda su tenantSlug (de la build), nunca un tenantId, y acepta su sesion`, async () => {
    const server = loginServer();
    const result = await requestLogin(apiFor(brandId, server.adapter), {
      email: "client@example.test",
      password: "right-password",
      tenantSlug: BRANDS[brandId].tenantSlug,
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.user.tenant.slug, BRANDS[brandId].tenantSlug);

    const sent = server.bodies[0];
    assert.equal(sent.url, "/auth/login");
    assert.deepEqual(sent.body, { email: "client@example.test", password: "right-password", tenantSlug: BRANDS[brandId].tenantSlug });
    assert.equal("tenantId" in sent.body, false);
    // Sin Origin ni Referer: una app nativa no se hace pasar por un portal.
    assert.equal(sent.headers?.Origin ?? sent.headers?.get?.("Origin") ?? undefined, undefined);
  });
}

test("HDG apunta a su API (HDG Sandbox) y The Worx a la suya", () => {
  assert.equal(resolveApiConfig({ brand: BRANDS.hdg, env: {} }).url, "https://sandbox-core.hdgexecutivesuites.com/api/v1");
  assert.equal(resolveApiConfig({ brand: BRANDS.the_worx, env: {} }).url, "https://core.theworxoffices.com/api/v1");
  assert.equal(BRANDS.hdg.tenantSlug, "hdg");
  assert.equal(BRANDS.the_worx.tenantSlug, "the_worx");
});

test("sin tenantSlug el backend no encuentra la organizacion (400): por eso la app siempre lo manda", async () => {
  const server = loginServer();
  const api = apiFor("hdg", server.adapter);
  await assert.rejects(api.post("/auth/login", { email: "client@example.test", password: "right-password" }), (e) => e.response.status === 400);
  assert.deepEqual(loginPayload("a@b.test", "pw", "hdg"), { email: "a@b.test", password: "pw", tenantSlug: "hdg" });
  assert.deepEqual(forgotPasswordPayload("a@b.test", "hdg"), { email: "a@b.test", tenantSlug: "hdg" });
});

test("credenciales malas: 401 sin guardar nada", async () => {
  configureStorage(memoryStore());
  const server = loginServer();
  await assert.rejects(
    requestLogin(apiFor("hdg", server.adapter), { email: "client@example.test", password: "wrong", tenantSlug: "hdg" }),
    (e) => e.response.status === 401
  );
  assert.deepEqual(await getTokens(), { accessToken: null, refreshToken: null });
});

// ── Aislamiento ─────────────────────────────────────────────────────────────

test("si el backend resuelve OTRA organizacion (correo solo alli), la app de HDG no acepta la sesion", async () => {
  // tenantIdByUniqueEmail: el correo no esta en hdg y solo existe en the_worx.
  const server = loginServer({ resolvesTo: () => "the_worx" });
  const result = await requestLogin(apiFor("hdg", server.adapter), {
    email: "client@example.test",
    password: "right-password",
    tenantSlug: "hdg",
  });
  assert.deepEqual(result, { ok: false, code: WRONG_ORGANIZATION });
  assert.equal("data" in result, false, "ni tokens ni usuario salen de aqui");
});

test("y al reves: la app de The Worx no acepta una sesion de HDG", async () => {
  const server = loginServer({ resolvesTo: () => "hdg" });
  const result = await requestLogin(apiFor("the_worx", server.adapter), {
    email: "client@example.test",
    password: "right-password",
    tenantSlug: "the_worx",
  });
  assert.equal(result.ok, false);
});

test("isSessionForTenant: solo el slug de la sesion igual al de la app; sin slug, no", () => {
  assert.equal(isSessionForTenant(userOf("hdg"), "hdg"), true);
  assert.equal(isSessionForTenant(userOf("HDG"), "hdg"), true, "sin importar mayusculas");
  assert.equal(isSessionForTenant(userOf("the_worx"), "hdg"), false);
  assert.equal(isSessionForTenant({ id: "u", tenantId: "cm-tenant-hdg" }, "hdg"), false, "un tenantId no basta");
  assert.equal(isSessionForTenant(null, "hdg"), false);
  assert.equal(isSessionForTenant(userOf("hdg"), ""), false);
  assert.equal(tenantSlugOf(userOf("hdg")), "hdg");
});

test("el mensaje de cuenta de otra organizacion llega al login", () => {
  const message = wrongOrganizationMessage("HDG Executive Suites");
  assert.match(message, /isn't part of HDG Executive Suites/);
  assert.equal(loginErrorMessage({ ok: false, code: WRONG_ORGANIZATION, message, status: null }), message);
});

test("AuthContext comprueba la organizacion en login, /auth/me, arranque y la activacion", () => {
  const auth = read("src/context/AuthContext.jsx");
  assert.match(auth, /requestLogin\(api, \{ email, password, tenantSlug: brand\.tenantSlug \}\)/);
  // login: antes de guardar tokens
  const login = auth.slice(auth.indexOf("const login = useCallback("));
  assert.ok(login.indexOf("if (!result.ok)") < login.indexOf("await setTokens("));
  // /auth/me: una sesion de otra organizacion se cierra
  assert.match(auth, /if \(nextUser && !isSessionForTenant\(nextUser, brand\.tenantSlug\)\) \{\s*await endLocalSession\(\);/);
  // arranque: el usuario guardado solo se pinta si es de esta organizacion
  assert.match(auth, /cachedUser && isSessionForTenant\(cachedUser, brand\.tenantSlug\)\) applyUser\(cachedUser\)/);
  // activacion: la sesion que devuelve set-password solo se guarda si es de esta organizacion
  const setPassword = read("src/app/set-password.jsx");
  assert.ok(setPassword.indexOf("if (isSessionForTenant(data.user, brand.tenantSlug))") < setPassword.indexOf("await setTokens("));
  // la app no usa tenantId en ninguna peticion de autenticacion
  for (const file of ["src/context/AuthContext.jsx", "src/lib/login-flow.js", "src/lib/forgot-password.js", "src/app/set-password.jsx"]) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(code, /tenantId\s*:/, file);
  }
});

// ── Recuperacion de sesion ──────────────────────────────────────────────────

test("tras el login, un refresh con 429 o 503 conserva la sesion de HDG", async () => {
  for (const status of [429, 503]) {
    configureStorage(memoryStore());
    await setTokens({ accessToken: "access-hdg", refreshToken: "refresh-hdg" });
    await setAuthUser(userOf("hdg"));
    let unauthorized = 0;
    const api = createApiClient({
      baseURL: "https://sandbox-core.hdgexecutivesuites.com/api/v1",
      onUnauthorized: () => (unauthorized += 1),
      adapter: (config) => {
        const response = (s, data) => Promise.reject(new AxiosError("x", "ERR", config, {}, { status: s, data, headers: {}, config }));
        return String(config.url).endsWith("/auth/refresh") ? response(status, "") : response(401, { error: "Invalid or expired token" });
      },
    });
    await assert.rejects(api.get("/client/capabilities"));
    assert.deepEqual(await getTokens(), { accessToken: "access-hdg", refreshToken: "refresh-hdg" }, String(status));
    assert.equal(unauthorized, 0);
  }
});

test("SESSION_REVOKED en el refresh cierra la sesion de HDG", async () => {
  configureStorage(memoryStore());
  await setTokens({ accessToken: "access-hdg", refreshToken: "refresh-hdg" });
  const reasons = [];
  const api = createApiClient({
    baseURL: "https://sandbox-core.hdgexecutivesuites.com/api/v1",
    onUnauthorized: (reason) => reasons.push(reason),
    adapter: (config) => {
      const data = String(config.url).endsWith("/auth/refresh") ? { error: "x", code: "SESSION_REVOKED" } : { error: "Invalid or expired token" };
      return Promise.reject(new AxiosError("x", "ERR", config, {}, { status: 401, data, headers: {}, config }));
    },
  });
  await assert.rejects(api.get("/client/capabilities"));
  assert.deepEqual(await getTokens(), { accessToken: null, refreshToken: null });
  assert.deepEqual(reasons, ["SESSION_REVOKED"]);
});
