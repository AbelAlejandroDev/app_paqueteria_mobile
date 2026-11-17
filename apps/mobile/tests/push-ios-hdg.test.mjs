import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  createPushRegistrationGate,
  FAILED,
  INVALID_TOKEN,
  isLegacyProjectIdRejection,
  maskPushToken,
  PROJECT_MISMATCH,
  PUSH_DEVICES_PATH,
  REGISTERED,
  REGISTERED_LEGACY,
  registerPushDevice,
  resolvePushProjectId,
} from "../src/lib/push-registration.js";
import { pushSessionLossAction } from "../src/lib/push-session.js";
import { logoutPushCleanup, sessionLossPushCleanup } from "../src/lib/push-presentation.js";
import { isSecureHttpsUrl, secureHttpsUrlOrNull } from "../src/lib/secure-url.js";
import { paymentAlertView } from "../src/lib/payment-alert-view.js";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const { BRANDS } = require("../brands/index.js");

const HDG = "2e12104c-c190-48aa-b044-da110d34e8f1";
const WORX = "922f4b80-6a1f-4072-a4df-c0d35fe374c8";
const TOKEN = "ExponentPushToken[abcdefghijklmnop]";

function appConfigWith(env) {
  const keys = ["APP_BRAND", "APP_ENV", "EXPO_PUBLIC_API_URL"];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    delete require.cache[require.resolve("../app.config.js")];
    const config = require("../app.config.js");
    return (typeof config === "function" ? config({ config: {} }) : config).expo;
  } finally {
    for (const k of keys) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  }
}

const HDG_ENV = { APP_BRAND: "hdg", APP_ENV: "sandbox", EXPO_PUBLIC_API_URL: "https://core.hdgexecutivesuites.com/api/v1" };
const WORX_ENV = { APP_BRAND: "the_worx", APP_ENV: "production", EXPO_PUBLIC_API_URL: "https://core.theworxoffices.com/api/v1" };

/** Cliente HTTP simulado: guarda las peticiones y responde lo que se le diga, en orden. */
function fakeApi(...responses) {
  const calls = [];
  return {
    calls,
    post: async (url, body) => {
      calls.push({ url, body });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return { status: 201, data: next ?? { id: "pd-1" } };
    },
  };
}

function httpError(status, data) {
  const error = new Error("HTTP " + status);
  error.response = { status, data };
  return error;
}

// El 400 real de zod .strict() en el backend anterior (backend-348c327).
const LEGACY_400 = httpError(400, {
  error: "Invalid body",
  details: { formErrors: ["Unrecognized key(s) in object: 'projectId'"], fieldErrors: {} },
});

// ── projectId de la build ────────────────────────────────────────────────────

test("projectId: el de la marca, venga de extra.eas o de easConfig", () => {
  assert.deepEqual(resolvePushProjectId({ expoConfigProjectId: HDG, easConfigProjectId: HDG, brandProjectId: HDG }), { projectId: HDG, reason: null });
  assert.equal(resolvePushProjectId({ expoConfigProjectId: HDG, brandProjectId: HDG }).projectId, HDG, "solo extra.eas (desarrollo)");
  assert.equal(resolvePushProjectId({ easConfigProjectId: HDG.toUpperCase(), brandProjectId: HDG }).projectId, HDG, "solo easConfig, mayusculas");
});

test("projectId: si alguna fuente es de otra marca (The Worx) no se registra nada", () => {
  for (const sources of [
    { expoConfigProjectId: WORX, easConfigProjectId: HDG },
    { expoConfigProjectId: HDG, easConfigProjectId: WORX },
    { expoConfigProjectId: WORX },
  ]) {
    const result = resolvePushProjectId({ ...sources, brandProjectId: HDG });
    assert.equal(result.projectId, null, JSON.stringify(sources));
    assert.match(result.reason, /another app/);
  }
  assert.equal(resolvePushProjectId({ brandProjectId: HDG }).projectId, null, "sin fuente no se inventa");
  assert.equal(resolvePushProjectId({ expoConfigProjectId: "x", brandProjectId: "x" }).projectId, null, "un id que no es uuid no vale");
  assert.equal(resolvePushProjectId({}).projectId, null);
});

test("cada marca tiene su proyecto EAS y app.config lo pone en extra.eas (fuente de las builds reales)", () => {
  assert.equal(BRANDS.hdg.easProjectId, HDG);
  assert.equal(BRANDS.the_worx.easProjectId, WORX);
  assert.notEqual(BRANDS.hdg.easProjectId, BRANDS.the_worx.easProjectId);
  assert.equal(appConfigWith(HDG_ENV).extra.eas.projectId, HDG);
  assert.equal(appConfigWith(WORX_ENV).extra.eas.projectId, WORX);
  // La app compara con el catalogo del propio bundle, no con lo que diga la config.
  const push = read("src/lib/push-notifications.js");
  assert.match(push, /brandProjectId: BRANDS\[brand\.id\]\?\.easProjectId/);
  assert.match(push, /easConfigProjectId: Constants\.easConfig\?\.projectId/);
  assert.match(push, /expoConfigProjectId: Constants\.expoConfig\?\.extra\?\.eas\?\.projectId/);
});

// ── Contrato de POST /client/push-devices ────────────────────────────────────

test("backend nuevo: un solo POST con token, plataforma y projectId", async () => {
  const api = fakeApi({ id: "pd-1" });
  const result = await registerPushDevice(api, { token: TOKEN, platform: "android", projectId: HDG });
  assert.equal(result.status, REGISTERED);
  assert.deepEqual(api.calls, [{ url: PUSH_DEVICES_PATH, body: { token: TOKEN, platform: "android", projectId: HDG } }]);
});

test("backend anterior (cuerpo estricto sin projectId): se repite UNA vez sin projectId", async () => {
  const api = fakeApi(LEGACY_400, { id: "pd-1" });
  const result = await registerPushDevice(api, { token: TOKEN, platform: "ios", projectId: HDG });
  assert.equal(result.status, REGISTERED_LEGACY);
  assert.equal(api.calls.length, 2);
  assert.deepEqual(api.calls[1].body, { token: TOKEN, platform: "ios" });
  assert.equal(isLegacyProjectIdRejection(LEGACY_400), true);
});

test("otro 400 no es el backend anterior: no se reintenta ni se quita projectId", async () => {
  const other = httpError(400, { error: "Invalid body", details: { fieldErrors: { token: ["Too short"] } } });
  assert.equal(isLegacyProjectIdRejection(other), false);
  const api = fakeApi(other);
  assert.equal((await registerPushDevice(api, { token: TOKEN, platform: "ios", projectId: HDG })).status, FAILED);
  assert.equal(api.calls.length, 1);
  // Y el backend anterior que rechaza otra clave tampoco cuenta.
  assert.equal(isLegacyProjectIdRejection(httpError(400, { details: { formErrors: ["Unrecognized key(s) in object: 'tenantId'"] } })), false);
});

test("422 PUSH_PROJECT_MISMATCH: se para, sin reintentar y sin quitar projectId", async () => {
  const api = fakeApi(httpError(422, { error: "This app is not allowed…", code: "PUSH_PROJECT_MISMATCH" }));
  const result = await registerPushDevice(api, { token: TOKEN, platform: "android", projectId: WORX });
  assert.equal(result.status, PROJECT_MISMATCH);
  assert.equal(api.calls.length, 1);
});

test("422 INVALID_PUSH_TOKEN y sin red: un intento, nunca lanza, sin token en el motivo", async () => {
  const invalid = await registerPushDevice(fakeApi(httpError(422, { code: "INVALID_PUSH_TOKEN" })), { token: TOKEN, platform: "android", projectId: HDG });
  assert.equal(invalid.status, INVALID_TOKEN);
  const offlineApi = fakeApi(new Error("Network Error"));
  const offline = await registerPushDevice(offlineApi, { token: TOKEN, platform: "android", projectId: HDG });
  assert.equal(offline.status, FAILED);
  assert.match(offline.reason, /no connection/);
  assert.equal(offlineApi.calls.length, 1);
  for (const r of [invalid, offline]) assert.doesNotMatch(r.reason, /abcdefghijklmnop/);
});

// ── Cuando se registra (puerta) ──────────────────────────────────────────────

test("mismo usuario, token y proyecto: no se repite; token nuevo o force: si", async () => {
  let calls = 0;
  const register = async () => { calls += 1; return { status: REGISTERED, reason: null }; };
  const gate = createPushRegistrationGate();
  await gate.run({ userId: "u1", token: TOKEN, projectId: HDG }, register);
  assert.equal((await gate.run({ userId: "u1", token: TOKEN, projectId: HDG }, register)).skipped, true);
  assert.equal(calls, 1, "sin duplicados en la misma ejecucion");
  await gate.run({ userId: "u1", token: "ExponentPushToken[nuevo-token-1234]", projectId: HDG }, register);
  assert.equal(calls, 2, "cambio de token");
  await gate.run({ userId: "u1", token: "ExponentPushToken[nuevo-token-1234]", projectId: HDG, force: true }, register);
  assert.equal(calls, 3, "renovacion forzada");
});

test("cambio de usuario en el mismo telefono: se registra con la cuenta nueva", async () => {
  const seen = [];
  const gate = createPushRegistrationGate();
  const register = (userId) => async () => { seen.push(userId); return { status: REGISTERED, reason: null }; };
  await gate.run({ userId: "ana", token: TOKEN, projectId: HDG }, register("ana"));
  gate.reset(); // logout
  await gate.run({ userId: "bea", token: TOKEN, projectId: HDG }, register("bea"));
  assert.deepEqual(seen, ["ana", "bea"]);
});

test("renovacion: pasado el plazo se vuelve a registrar aunque nada cambie", async () => {
  let t = 0;
  let calls = 0;
  const gate = createPushRegistrationGate({ renewAfterMs: 1000, now: () => t });
  const register = async () => { calls += 1; return { status: REGISTERED, reason: null }; };
  await gate.run({ userId: "u1", token: TOKEN, projectId: HDG }, register);
  t = 999;
  await gate.run({ userId: "u1", token: TOKEN, projectId: HDG }, register);
  t = 1000;
  await gate.run({ userId: "u1", token: TOKEN, projectId: HDG }, register);
  assert.equal(calls, 2);
});

test("tras PUSH_PROJECT_MISMATCH no se insiste (ni con token nuevo) hasta cerrar sesion", async () => {
  let calls = 0;
  const gate = createPushRegistrationGate();
  const mismatch = async () => { calls += 1; return { status: PROJECT_MISMATCH, reason: "x" }; };
  await gate.run({ userId: "u1", token: TOKEN, projectId: HDG }, mismatch);
  await gate.run({ userId: "u1", token: TOKEN, projectId: HDG, force: true }, mismatch);
  await gate.run({ userId: "u1", token: "ExponentPushToken[otro-token-5678]", projectId: HDG }, mismatch);
  assert.equal(calls, 1);
  gate.reset();
  await gate.run({ userId: "u1", token: TOKEN, projectId: HDG }, mismatch);
  assert.equal(calls, 2);
});

test("dos llamadas a la vez comparten la peticion; un fallo de red no se da por registrado", async () => {
  let calls = 0;
  let release;
  const gate = createPushRegistrationGate();
  const slow = () => { calls += 1; return new Promise((resolve) => { release = () => resolve({ status: REGISTERED, reason: null }); }); };
  const a = gate.run({ userId: "u1", token: TOKEN, projectId: HDG }, slow);
  const b = gate.run({ userId: "u1", token: TOKEN, projectId: HDG }, slow);
  release();
  assert.deepEqual(await a, await b);
  assert.equal(calls, 1);

  const gate2 = createPushRegistrationGate();
  let attempts = 0;
  const flaky = async () => { attempts += 1; return attempts === 1 ? { status: FAILED, reason: "offline" } : { status: REGISTERED, reason: null }; };
  await gate2.run({ userId: "u1", token: TOKEN, projectId: HDG }, flaky);
  await gate2.run({ userId: "u1", token: TOKEN, projectId: HDG }, flaky);
  assert.equal(attempts, 2, "el siguiente intento si sale");
  assert.equal((await gate2.run({ userId: null, token: TOKEN }, flaky)).skipped, true, "sin sesion no se registra");
});

// ── Sesion: logout, revocada, otra organizacion, sin red ─────────────────────

test("sesion perdida sin logout (revocada u otra organizacion): se invalida el token aqui", () => {
  assert.equal(pushSessionLossAction({ previousUserId: "u1", nextUser: null, loggingOut: false }), "invalidate");
  assert.equal(pushSessionLossAction({ previousUserId: "u1", nextUser: null, loggingOut: true }), "none", "logout ya dio de baja en el servidor");
  assert.equal(pushSessionLossAction({ previousUserId: null, nextUser: null, loggingOut: false }), "none", "arranque sin sesion");
  assert.equal(pushSessionLossAction({ previousUserId: null, nextUser: { id: "u1" }, loggingOut: false }), "none", "login");
  assert.equal(pushSessionLossAction({ previousUserId: "u1", nextUser: { id: "u1" }, loggingOut: false }), "none", "refresh");
});

test("invalidacion por sesion perdida: nunca llama al servidor; sin red queda pendiente y no lanza", async () => {
  const calls = [];
  const ok = await sessionLossPushCleanup({
    unregisterLocally: async () => calls.push("local"),
    markPending: async () => calls.push("mark"),
    clearPending: async () => calls.push("clear"),
  });
  assert.deepEqual(ok, { local: true, pending: false });
  assert.deepEqual(calls, ["local", "clear"]);
  const offline = await sessionLossPushCleanup({
    unregisterLocally: async () => { throw new Error("FCM sin red"); },
    markPending: async () => {},
    clearPending: async () => {},
  });
  assert.deepEqual(offline, { local: false, pending: true });
  // El logout normal sigue igual: servidor primero.
  assert.deepEqual(await logoutPushCleanup({ unregisterOnServer: async () => {}, unregisterLocally: async () => assert.fail() }), { server: true, local: "skipped", pending: false });
});

test("cableado en AuthContext: userId al registrar, token nuevo, revocada y logout sin doble baja", () => {
  const auth = read("src/context/AuthContext.jsx");
  assert.match(auth, /registerForPush\(\{ userId, force \}\)/);
  assert.match(auth, /return addPushTokenChangeListener\(\(\) => register\(true\)\);/);
  assert.match(auth, /pushSessionLossAction\(\{ previousUserId: userIdRef\.current, nextUser, loggingOut: loggingOutRef\.current \}\) === "invalidate"/);
  assert.match(auth, /invalidatePushOnSessionLoss\(\)\.catch/);
  const logout = auth.slice(auth.indexOf("const logout = useCallback("), auth.indexOf("const userId = user?.id"));
  assert.ok(logout.indexOf("loggingOutRef.current = true") < logout.indexOf("await unregisterFromPush()"));
  assert.match(logout, /finally \{\s*loggingOutRef\.current = false;/);
  // Solo una prueba del servidor (401/404) quita la sesion: sin red no se invalida nada.
  assert.match(auth, /classifySessionError\(error\) === SESSION_INVALID/);
});

test("logs y pantalla: nunca el token entero", () => {
  assert.equal(maskPushToken(TOKEN), "ExponentPushToken[ab…op]");
  assert.doesNotMatch(maskPushToken(TOKEN), /cdefghijklmn/);
  assert.equal(maskPushToken("ExpoPushToken[abc]"), "ExpoPushToken[…]");
  assert.equal(maskPushToken("otra-cosa"), "[token]");
  for (const file of ["src/lib/push-notifications.js", "src/context/AuthContext.jsx", "src/lib/push-registration.js"]) {
    // Cada llamada a console.*, sin sus textos fijos: ahi no puede quedar ninguna variable con el token.
    const calls = read(file).match(/console\.(log|warn|error|info)\([^;]*\);/g) || [];
    for (const call of calls) {
      const code = call.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
      assert.doesNotMatch(code, /\btoken\b|\bdata\b/i, file + ": " + call);
    }
  }
  // registerForPush ya no devuelve el token a quien lo llama.
  const push = read("src/lib/push-notifications.js");
  const register = push.slice(push.indexOf("export async function registerForPush("), push.indexOf("export function addPushTokenChangeListener("));
  assert.doesNotMatch(register, /return \{[^}]*\btoken\b/);
});

test("permiso denegado: ni token ni registro; se vuelve a mirar en el siguiente arranque", () => {
  const push = read("src/lib/push-notifications.js");
  const register = push.slice(push.indexOf("export async function registerForPush("), push.indexOf("export function addPushTokenChangeListener("));
  const denied = register.indexOf('if (!granted) return { registered: false');
  assert.ok(denied > 0 && denied < register.indexOf("getExpoPushTokenAsync"), "se corta antes de pedir el token");
  assert.match(register, /if \(!granted && existing\.canAskAgain\)/, "no se pregunta otra vez tras un no");
});

// ── Conference Room por marca ────────────────────────────────────────────────

test("Conference Room: cada marca la suya, https, y ninguna la de la otra", () => {
  assert.equal(BRANDS.hdg.conferenceRoomUrl, "https://www.hdgexecutivesuites.com/conference-room/");
  assert.equal(BRANDS.the_worx.conferenceRoomUrl, "https://orlando.theworxoffices.com/conference-room/");
  assert.equal(appConfigWith(HDG_ENV).extra.brand.conferenceRoomUrl, BRANDS.hdg.conferenceRoomUrl);
  assert.equal(appConfigWith(WORX_ENV).extra.brand.conferenceRoomUrl, BRANDS.the_worx.conferenceRoomUrl);
  assert.doesNotMatch(appConfigWith(HDG_ENV).extra.brand.conferenceRoomUrl, /theworx/);
  for (const brand of Object.values(BRANDS)) assert.equal(isSecureHttpsUrl(brand.conferenceRoomUrl), true, brand.id);
});

test("el panel usa la URL de la marca, sin ninguna fija, y oculta la tarjeta si no es https", () => {
  const dashboard = read("src/app/(client)/dashboard.jsx");
  assert.match(dashboard, /const CONFERENCE_ROOM_URL = secureHttpsUrlOrNull\(brand\.conferenceRoomUrl\);/);
  assert.doesNotMatch(dashboard, /theworxoffices\.com|hdgexecutivesuites\.com/);
  assert.match(dashboard, /\{CONFERENCE_ROOM_URL \? \(\s*<AccessCard\s+title="Conference Room"/);
  for (const bad of [null, undefined, "", "http://www.hdgexecutivesuites.com/conference-room/", "javascript:alert(1)", "hdgclient://x", "https://u:p@x.com/"]) {
    assert.equal(secureHttpsUrlOrNull(bad), null, String(bad));
  }
});

// ── Aviso de cobro fallido ───────────────────────────────────────────────────

test("aviso de pago: Pay now solo con https; Stripe solo se nombra con Stripe", () => {
  const stripe = paymentAlertView({ invoiceUrl: "https://invoice.stripe.com/i/acct_1/test_1" }, "STRIPE");
  assert.equal(stripe.invoiceUrl, "https://invoice.stripe.com/i/acct_1/test_1");
  assert.match(stripe.footnote, /secure Stripe page/);

  for (const provider of ["ZOHO", null, undefined]) {
    const view = paymentAlertView({ invoiceUrl: "https://billing.zoho.com/pay/1" }, provider);
    assert.equal(view.invoiceUrl, "https://billing.zoho.com/pay/1");
    assert.doesNotMatch(view.footnote, /Stripe/, String(provider));
  }
  for (const bad of ["http://invoice.stripe.com/x", "javascript:alert(1)", "", null, "https://a:b@x.com"]) {
    const view = paymentAlertView({ invoiceUrl: bad }, "STRIPE");
    assert.equal(view.invoiceUrl, null, String(bad));
    assert.match(view.footnote, /Contact your center/);
  }
  const component = read("src/components/common/payment-alerts.jsx");
  assert.match(component, /WebBrowser\.openBrowserAsync\(view\.invoiceUrl\)/);
  assert.doesNotMatch(component, /openBrowserAsync\(alert\.invoiceUrl\)/);
  assert.doesNotMatch(component, /secure Stripe page/, "el texto sale de lib/payment-alert-view");
});

// ── Permisos y configuracion nativa (iOS y Android) ──────────────────────────

test("iOS de HDG: bundle id, push con expo-notifications y textos de permisos; sin microfono", () => {
  const expo = appConfigWith(HDG_ENV);
  assert.equal(expo.ios.bundleIdentifier, "com.hdgexecutivesuites.clientportal");
  assert.equal(expo.ios.config.usesNonExemptEncryption, false);
  const plugin = (name) => expo.plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  assert.ok(plugin("expo-notifications"), "anade aps-environment y la capacidad Push Notifications");
  // Sin `mode`: el aps-environment de una build de tienda sale del perfil de App Store.
  assert.equal(plugin("expo-notifications")[1].mode, undefined);
  assert.match(plugin("expo-local-authentication")[1].faceIDPermission, /Face ID/);
  assert.equal(plugin("expo-image-picker")[1].microphonePermission, false);
  assert.ok(plugin("expo-image-picker")[1].cameraPermission && plugin("expo-image-picker")[1].photosPermission);
});

test("Android de HDG: Firebase de HDG y canal de avisos declarado antes de pedir permiso", () => {
  const expo = appConfigWith(HDG_ENV);
  assert.equal(expo.android.package, "com.hdgexecutivesuites.clientportal");
  assert.equal(expo.android.googleServicesFile, "./assets/brands/hdg/google-services.json");
  const push = read("src/lib/push-notifications.js");
  assert.ok(push.indexOf('setNotificationChannelAsync("default"') < push.indexOf("requestPermissionsAsync"), "Android 13+ pide el permiso al crear el canal");
});
