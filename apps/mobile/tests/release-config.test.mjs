import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { sandboxIndicator } from "../src/lib/environment-indicator.js";
import { clearPrivateFiles, PDF_CACHE_DIRECTORY } from "../src/lib/private-files.js";
import { logoutPushCleanup, retryPendingPushCleanup } from "../src/lib/push-presentation.js";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const eas = JSON.parse(read("eas.json"));
const { BRANDS } = require("../brands/index.js");
const { resolveApiConfig } = require("../brands/api-environment.js");
const { assertChannelMatchesEnvironment, environmentForChannel, profilesForBrand, updatePlan } = require("../brands/update-channels.js");

function appConfigWith(env) {
  const keys = ["APP_BRAND", "APP_ENV", "EXPO_PUBLIC_API_URL"];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  delete require.cache[require.resolve("../app.config.js")];
  try {
    return require("../app.config.js").expo;
  } finally {
    for (const k of keys) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
    delete require.cache[require.resolve("../app.config.js")];
  }
}

const profileNames = Object.keys(eas.build).filter((n) => !n.startsWith("base-"));
const resolved = (name) => profilesForBrand(eas, name.startsWith("hdg-") ? "hdg" : "the_worx").find((p) => p.name === name);

// ── Proyectos e identificadores ─────────────────────────────────────────────

test("cada marca es su propio proyecto de EAS, con su bundle id, application id y esquema", () => {
  const worx = appConfigWith({ APP_BRAND: "the_worx" });
  const hdg = appConfigWith({ APP_BRAND: "hdg", APP_ENV: "sandbox" });
  assert.equal(worx.extra.eas.projectId, "922f4b80-6a1f-4072-a4df-c0d35fe374c8");
  assert.equal(hdg.extra.eas.projectId, "2e12104c-c190-48aa-b044-da110d34e8f1");
  assert.equal(worx.owner, "ab-estrategia-360");
  assert.equal(hdg.owner, "ab-estrategia-360");
  assert.equal(worx.slug, "worx-client");
  assert.equal(hdg.slug, "hdg-client");
  assert.equal(worx.ios.bundleIdentifier, "com.theworxoffices.clientportal");
  assert.equal(worx.android.package, "com.theworxoffices.clientportal");
  assert.equal(hdg.ios.bundleIdentifier, "com.hdgexecutivesuites.clientportal");
  assert.equal(hdg.android.package, "com.hdgexecutivesuites.clientportal");
  assert.notEqual(worx.scheme, hdg.scheme);
  // Los updates de cada marca salen de SU proyecto: un OTA no cruza marcas.
  assert.equal(worx.updates.url, "https://u.expo.dev/922f4b80-6a1f-4072-a4df-c0d35fe374c8");
  assert.equal(hdg.updates.url, "https://u.expo.dev/2e12104c-c190-48aa-b044-da110d34e8f1");
});

test("perfiles: development, preview, simulator y production por marca, y hdg-testflight-sandbox", () => {
  for (const brand of ["worx", "hdg"]) {
    for (const kind of ["development", "preview", "simulator", "production"]) assert.ok(eas.build[`${brand}-${kind}`], `${brand}-${kind}`);
  }
  assert.ok(eas.build["hdg-testflight-sandbox"]);
  assert.equal(resolved("worx-development").developmentClient, true);
  assert.equal(resolved("hdg-development").developmentClient, true);
  assert.equal(resolved("worx-simulator").ios.simulator, true);
  assert.equal(resolved("hdg-simulator").ios.simulator, true);
  assert.equal(resolved("worx-preview").android.buildType, "apk");
  assert.equal(resolved("hdg-preview").android.buildType, "apk");
});

// ── Canales OTA ─────────────────────────────────────────────────────────────

test("cada perfil usa un canal de su marca que lleva SU entorno", () => {
  for (const name of profileNames) {
    const profile = resolved(name);
    const brand = BRANDS[profile.env.APP_BRAND];
    const expected = environmentForChannel(brand, profile.channel);
    assert.ok(expected, `${name}: canal ${profile.channel} no es de ${brand.id}`);
    assert.equal(expected, profile.env.APP_ENV, `${name}: canal ${profile.channel}`);
  }
});

test("los canales de Sandbox y los de produccion no se mezclan", () => {
  assert.deepEqual(BRANDS.the_worx.updateChannels, { development: "production", preview: "production", production: "production" });
  assert.deepEqual(BRANDS.hdg.updateChannels, { development: "sandbox", preview: "sandbox", "testflight-sandbox": "sandbox", production: "production" });
  assert.equal(environmentForChannel(BRANDS.the_worx, "testflight-sandbox"), null, "The Worx no tiene canal de Sandbox");
});

test("plan de eas update: marca, entorno, URL y entorno de EAS coherentes con el canal", () => {
  const worx = updatePlan({ brandId: "the_worx", channel: "production", eas, message: "fix" });
  assert.deepEqual(worx.env, { APP_BRAND: "the_worx", APP_ENV: "production", EXPO_PUBLIC_API_URL: "https://core.theworxoffices.com/api/v1" });
  assert.deepEqual(worx.args.slice(0, 6), ["eas-cli", "update", "--channel", "production", "--environment", "production"]);

  const tf = updatePlan({ brandId: "hdg", channel: "testflight-sandbox", eas, message: "fix" });
  assert.deepEqual(tf.env, { APP_BRAND: "hdg", APP_ENV: "sandbox", EXPO_PUBLIC_API_URL: "https://core.hdgexecutivesuites.com/api/v1" });
  assert.deepEqual(tf.args.slice(0, 6), ["eas-cli", "update", "--channel", "testflight-sandbox", "--environment", "preview"]);

  for (const channel of ["development", "preview"]) {
    assert.equal(updatePlan({ brandId: "hdg", channel, eas, message: "x" }).env.APP_ENV, "sandbox", channel);
    assert.equal(updatePlan({ brandId: "the_worx", channel, eas, message: "x" }).env.APP_ENV, "production", channel);
  }
});

test("plan de eas update: HDG production bloqueado, canales ajenos y sin mensaje, rechazados", () => {
  assert.throws(() => updatePlan({ brandId: "hdg", channel: "production", eas, message: "x" }), /bloqueados/);
  assert.throws(() => updatePlan({ brandId: "the_worx", channel: "testflight-sandbox", eas, message: "x" }), /no tiene el canal/);
  assert.throws(() => updatePlan({ brandId: "hdg", channel: "staging", eas, message: "x" }), /no tiene el canal/);
  assert.throws(() => updatePlan({ brandId: "the_worx", channel: "production", eas, message: "" }), /--message/);
  assert.throws(() => updatePlan({ brandId: "otra", channel: "production", eas, message: "x" }), /no existe/);
});

test("en la app: un bundle de otro entorno en un canal no arranca la API", () => {
  const ok = (brand, channel, environment) => assertChannelMatchesEnvironment({ brand: BRANDS[brand], channel, environment });
  assert.equal(ok("hdg", "testflight-sandbox", "sandbox"), true);
  assert.equal(ok("the_worx", "production", "production"), true);
  assert.equal(ok("hdg", null, "sandbox"), true, "sin canal (Expo Go, expo start): nada que comprobar");
  assert.throws(() => ok("hdg", "production", "sandbox"), /update de otro entorno/);
  assert.throws(() => ok("hdg", "testflight-sandbox", "production"), /update de otro entorno/);
  assert.throws(() => ok("the_worx", "testflight-sandbox", "production"), /no es de the_worx/);
  const api = read("src/lib/api.js");
  assert.match(api, /assertChannelMatchesEnvironment\(\{ brand: BRANDS\[brand\.id\], channel: Updates\.channel, environment: apiConfig\.environment \}\)/);
  assert.ok(api.indexOf("assertChannelMatchesEnvironment(") < api.indexOf("export const api = createApiClient("), "antes de crear el cliente");
});

test("el script de update solo enseña el plan salvo con --run", () => {
  const script = read("scripts/eas-update.js");
  assert.match(script, /if \(!run\) \{[\s\S]*?no se ha publicado nada/);
  assert.match(script, /updatePlan\(\{ brandId, channel, eas, message \}\)/);
});

// ── Versiones y runtime ─────────────────────────────────────────────────────

test("version comercial, numeros de build remotos y autoIncrement solo en builds de tienda", () => {
  assert.equal(eas.cli.appVersionSource, "remote");
  for (const brand of [{ APP_BRAND: "the_worx" }, { APP_BRAND: "hdg", APP_ENV: "sandbox" }]) {
    const expo = appConfigWith(brand);
    assert.equal(expo.version, "1.0.0");
    assert.equal(expo.ios.buildNumber, undefined);
    assert.equal(expo.android.versionCode, undefined);
    assert.equal(expo.runtimeVersion, "native-3", "misma runtime en las dos marcas (mismo codigo nativo)");
  }
  for (const name of ["worx-production", "hdg-testflight-sandbox", "hdg-production"]) {
    assert.equal(resolved(name).autoIncrement, true, name);
    assert.notEqual(resolved(name).distribution, "internal", name);
  }
  for (const name of ["worx-development", "worx-preview", "hdg-development", "hdg-preview"]) {
    assert.equal(resolved(name).autoIncrement, undefined, name);
    assert.equal(resolved(name).distribution, "internal", name);
  }
  assert.equal(JSON.parse(read("native-runtime.json")).runtimeVersion, "native-3");
});

// ── Envio a tiendas ─────────────────────────────────────────────────────────

test("submit: The Worx con su app de App Store Connect; HDG sin destino hasta tener el ascAppId", () => {
  assert.deepEqual(eas.submit["worx-production"].ios, { ascAppId: "6822867406" });
  assert.deepEqual(eas.submit["worx-production"].android, { track: "internal", releaseStatus: "draft" });
  assert.equal(eas.submit["hdg-testflight-sandbox"], undefined);
  assert.deepEqual(eas.submit["hdg-production"], {});
  // Ningun fichero de credenciales en el repo.
  assert.doesNotMatch(read("eas.json"), /serviceAccountKeyPath|\.p8|\.p12|\.jks|\.keystore/);
});

// ── HDG Production bloqueado; Sandbox se identifica como pruebas ───────────

test("HDG production sigue bloqueado: build, config y update", () => {
  assert.equal(BRANDS.hdg.productionRelease.authorized, false);
  assert.throws(() => resolveApiConfig({ brand: BRANDS.hdg, env: { APP_ENV: "production" } }), /bloqueados/);
  assert.throws(() => appConfigWith({ APP_BRAND: "hdg", APP_ENV: "production" }), /bloqueados/);
  assert.throws(() => updatePlan({ brandId: "hdg", channel: "production", eas, message: "x" }), /bloqueados/);
});

test("toda build de HDG Sandbox enseña la franja de pruebas desde el arranque (antes del login)", () => {
  for (const name of ["hdg-development", "hdg-preview", "hdg-simulator", "hdg-testflight-sandbox"]) {
    const expo = appConfigWith(resolved(name).env);
    assert.equal(expo.extra.api.environment, "sandbox", name);
    assert.equal(sandboxIndicator({ apiEnvironment: expo.extra.api.environment, serverEnvironment: null }).visible, true, name);
  }
  for (const name of ["worx-production", "worx-preview"]) {
    const expo = appConfigWith(resolved(name).env);
    assert.equal(sandboxIndicator({ apiEnvironment: expo.extra.api.environment, serverEnvironment: null }).visible, false, name);
  }
});

// ── Datos privados en disco ─────────────────────────────────────────────────

test("al cambiar de cuenta se borran los PDFs de escaneos y la cache de imagenes, aunque algo falle", async () => {
  const calls = [];
  const statuses = await clearPrivateFiles({
    deletePdfDirectory: () => calls.push("pdfs"),
    clearImageDiskCache: async () => {
      calls.push("disk");
      throw new Error("boom");
    },
    clearImageMemoryCache: () => calls.push("memory"),
  });
  assert.deepEqual(calls.sort(), ["disk", "memory", "pdfs"]);
  assert.deepEqual(statuses, ["fulfilled", "rejected", "fulfilled"]);
  assert.deepEqual(await clearPrivateFiles({}), ["fulfilled", "fulfilled", "fulfilled"]);

  assert.equal(PDF_CACHE_DIRECTORY, "item-pdfs");
  assert.match(read("src/components/common/pdf-viewer.jsx"), /new Directory\(Paths\.cache, PDF_CACHE_DIRECTORY\)/);
  const native = read("src/lib/private-files-native.js");
  assert.match(native, /Image\.clearDiskCache\(\)/);
  assert.match(native, /Image\.clearMemoryCache\(\)/);
  const auth = read("src/context/AuthContext.jsx");
  const tracker = auth.slice(auth.indexOf("createScopeTracker((nextScope) => {"), auth.indexOf("const applyUser = useCallback("));
  assert.match(tracker, /clearPrivateFilesOnDevice\(\);/, "en cada cambio de ambito: logout, revocada, otra cuenta");
});

// ── Logout sin conexion y baja del push ─────────────────────────────────────

test("logout con red: baja en el servidor y nada mas", async () => {
  const calls = [];
  const result = await logoutPushCleanup({
    unregisterOnServer: async () => calls.push("server"),
    unregisterLocally: async () => calls.push("local"),
    markPending: async () => calls.push("mark"),
    clearPending: async () => calls.push("clear"),
  });
  assert.deepEqual(result, { server: true, local: "skipped", pending: false });
  assert.deepEqual(calls, ["server"]);
});

test("logout sin red: el token se invalida en el dispositivo (ningun aviso de esa cuenta)", async () => {
  const calls = [];
  const result = await logoutPushCleanup({
    unregisterOnServer: async () => {
      throw new Error("Network Error");
    },
    unregisterLocally: async () => calls.push("local"),
    markPending: async () => calls.push("mark"),
    clearPending: async () => calls.push("clear"),
  });
  assert.deepEqual(result, { server: false, local: true, pending: false });
  assert.deepEqual(calls, ["local", "clear"]);
});

test("sin red ni baja local: queda marcado y se termina al arrancar sin sesion", async () => {
  let pending = false;
  const result = await logoutPushCleanup({
    unregisterOnServer: async () => {
      throw new Error("Network Error");
    },
    unregisterLocally: async () => {
      throw new Error("FCM offline");
    },
    markPending: async () => (pending = true),
    clearPending: async () => (pending = false),
  });
  assert.deepEqual(result, { server: false, local: false, pending: true });
  assert.equal(pending, true);

  let localCalls = 0;
  const retry = await retryPendingPushCleanup({
    isPending: async () => pending,
    unregisterLocally: async () => localCalls++,
    clearPending: async () => (pending = false),
  });
  assert.equal(retry, "done");
  assert.equal(localCalls, 1);
  assert.equal(pending, false);
  assert.equal(await retryPendingPushCleanup({ isPending: async () => false, unregisterLocally: async () => assert.fail(), clearPending: async () => {} }), "none");
});

test("ni el logout ni el arranque fallan por la limpieza del push", async () => {
  const all = { unregisterOnServer: async () => { throw new Error("x"); }, unregisterLocally: async () => { throw new Error("y"); }, markPending: async () => { throw new Error("z"); } };
  assert.deepEqual(await logoutPushCleanup(all), { server: false, local: false, pending: true });
  assert.equal(await retryPendingPushCleanup({ isPending: async () => { throw new Error("storage"); } }), "unknown");
});

test("cableado: la baja local solo toca este dispositivo; el registro limpia la marca; el arranque sin sesion reintenta", () => {
  const push = read("src/lib/push-notifications.js");
  assert.match(push, /unregisterLocally: \(\) => Notifications\.unregisterForNotificationsAsync\(\)/);
  assert.match(push, /api\.post\("\/client\/push-devices\/unregister", \{ token \}\)/);
  assert.doesNotMatch(push, /push-devices\/unregister", \{ token: [^}]*(userId|tenantId)/, "nunca se da de baja por usuario: solo el token propio");
  const register = push.slice(push.indexOf("export async function registerForPush("), push.indexOf("export async function unregisterFromPush("));
  assert.match(register, /setJsonValue\(PUSH_LOCAL_UNREGISTER_PENDING_KEY, null\)/);
  const auth = read("src/context/AuthContext.jsx");
  const reload = auth.slice(auth.indexOf("const reload = useCallback("));
  assert.ok(reload.indexOf("retryPendingPushUnregister()") < reload.indexOf("const response = await api.get(\"/auth/me\")"), "sin token, antes de pedir /auth/me");
});

// ── Firebase (push en Android) por marca ────────────────────────────────────

const { googleServicesProblems, readGoogleServices } = require("../scripts/check-google-services.js");

test("google-services.json: el de cada marca es de su app y de su proyecto", () => {
  for (const brand of Object.values(BRANDS)) {
    assert.deepEqual(googleServicesProblems(brand.id), [], brand.id);
  }
  assert.equal(readGoogleServices("the_worx").project_info.project_id, "the-worx-client");
});

test("HDG hoy: sin google-services.json -> Android no registra push (y no usa el de The Worx)", () => {
  const hasHdg = Boolean(readGoogleServices("hdg"));
  const expo = appConfigWith({ APP_BRAND: "hdg", APP_ENV: "sandbox" });
  assert.equal(expo.extra.push.androidFcmConfigured, hasHdg);
  assert.equal(Boolean(expo.android.googleServicesFile), hasHdg);
  if (!hasHdg) assert.equal(expo.android.googleServicesFile, undefined, "nunca cae al fichero de otra marca");
});

test("un google-services.json de HDG con el proyecto o el paquete de The Worx se rechaza", () => {
  const worx = readGoogleServices("the_worx");
  const fakeRead = (id) => (id === "hdg" ? worx : worx);
  const problems = googleServicesProblems("hdg", { read: fakeRead });
  assert.ok(problems.some((p) => /no tiene el application id com\.hdgexecutivesuites\.clientportal/.test(p)), problems.join("; "));
  assert.ok(problems.some((p) => /usa el proyecto de Firebase de the_worx/.test(p)), problems.join("; "));
  const ownPackageButWorxProject = {
    ...worx,
    client: [{ client_info: { mobilesdk_app_id: "1:2:android:3", android_client_info: { package_name: "com.hdgexecutivesuites.clientportal" } }, api_key: [{ current_key: "x" }] }],
  };
  const sameProject = googleServicesProblems("hdg", { read: (id) => (id === "hdg" ? ownPackageButWorxProject : worx) });
  assert.deepEqual(sameProject, ["usa el proyecto de Firebase de the_worx (the-worx-client)"]);
});

test("añadir google-services.json no cambia lo nativo que usa el JS (no exige subir la runtime)", () => {
  // El registro de lo nativo son modulos y plugins: el fichero de Firebase no esta.
  const { currentNativeRuntime } = require("../scripts/native-runtime.js");
  const record = currentNativeRuntime();
  assert.deepEqual(Object.keys(record).sort(), ["modules", "plugins", "runtimeVersion"]);
  assert.ok(record.plugins.includes("expo-notifications"), "expo-notifications ya esta en el binario");
});
