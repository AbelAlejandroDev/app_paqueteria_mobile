import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const { BRANDS, getBrand } = require("../brands/index.js");
const { assertApiUrlForBrand, assertApiUrlForEnvironment, brandForApiUrl, resolveApiConfig } = require("../brands/api-environment.js");

const WORX = "https://core.theworxoffices.com/api/v1";
const HDG_SANDBOX = "https://sandbox-core.hdgexecutivesuites.com/api/v1";
const HDG_PRODUCTION = "https://core.hdgexecutivesuites.com/api/v1";

const eas = JSON.parse(read("eas.json"));

/** El env de un perfil tal como lo arma EAS (extends + env, el hijo manda). */
function profileEnv(name) {
  const profile = eas.build[name];
  if (!profile) throw new Error("No existe el perfil " + name);
  const parent = profile.extends ? profileEnv(profile.extends) : {};
  return { ...parent, ...(profile.env || {}) };
}

const buildProfiles = Object.keys(eas.build).filter((name) => !name.startsWith("base-"));

/** Lo que resolveria app.config.js para ese perfil. */
function resolveProfile(name) {
  const env = profileEnv(name);
  return resolveApiConfig({ brand: getBrand(env.APP_BRAND), env });
}

/** app.config.js evaluado de verdad con un entorno dado. */
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

// ── Perfiles de EAS ────────────────────────────────────────────────────────

test("cada perfil declara su marca y su entorno, sin depender de los valores por defecto", () => {
  for (const name of buildProfiles) {
    const env = profileEnv(name);
    assert.ok(env.APP_BRAND, name + ": falta APP_BRAND");
    assert.ok(["sandbox", "production"].includes(env.APP_ENV), name + ": APP_ENV");
    assert.equal(name.startsWith("hdg-") ? "hdg" : "the_worx", env.APP_BRAND, name + ": el prefijo es la marca");
  }
});

test("los perfiles base no llevan API: la pone cada marca", () => {
  for (const name of Object.keys(eas.build).filter((n) => n.startsWith("base-"))) {
    assert.equal(eas.build[name].env?.EXPO_PUBLIC_API_URL, undefined, name);
    assert.equal(eas.build[name].env?.APP_BRAND, undefined, name);
  }
});

test("The Worx: todos sus perfiles van a core.theworxoffices.com (production)", () => {
  for (const name of buildProfiles.filter((n) => n.startsWith("worx-"))) {
    assert.deepEqual(resolveProfile(name), {
      brandId: "the_worx",
      environment: "production",
      url: WORX,
      host: "core.theworxoffices.com",
    }, name);
  }
});

test("HDG: desarrollo, preview y simulador van a HDG Sandbox", () => {
  for (const name of ["hdg-development", "hdg-preview", "hdg-simulator"]) {
    assert.deepEqual(resolveProfile(name), {
      brandId: "hdg",
      environment: "sandbox",
      url: HDG_SANDBOX,
      host: "sandbox-core.hdgexecutivesuites.com",
    }, name);
  }
});

test("HDG production: core.hdgexecutivesuites.com, autorizado y con su propia URL (nunca heredada)", () => {
  assert.deepEqual(resolveProfile("hdg-production"), {
    brandId: "hdg",
    environment: "production",
    url: HDG_PRODUCTION,
    host: "core.hdgexecutivesuites.com",
  });
  // La URL va escrita en el propio perfil: no la hereda de base-production ni de The Worx.
  assert.equal(eas.build["hdg-production"].env.EXPO_PUBLIC_API_URL, HDG_PRODUCTION);
  assert.notEqual(profileEnv("hdg-production").EXPO_PUBLIC_API_URL, WORX);
  assert.equal(BRANDS.hdg.productionRelease.authorized, true);
  assert.equal(BRANDS.hdg.api.production, HDG_PRODUCTION);
  assert.notEqual(BRANDS.hdg.api.production, BRANDS.hdg.api.sandbox);
  const expo = appConfigWith(profileEnv("hdg-production"));
  assert.equal(expo.ios.bundleIdentifier, "com.hdgexecutivesuites.clientportal");
  assert.equal(expo.extra.api.environment, "production");
  assert.equal(expo.extra.eas.projectId, "2e12104c-c190-48aa-b044-da110d34e8f1");
  assert.equal(expo.version, "1.0.0");
  // El freno de EAS mira la URL publica de la misma API de production.
  assert.equal(new URL(BRANDS.hdg.productionRelease.productionCheck.portalUrl).host, "core.hdgexecutivesuites.com");
  assert.equal(BRANDS.hdg.productionRelease.productionCheck.origin, "https://members.hdgexecutivesuites.com");
});

test("ninguna build de HDG usa la API de The Worx, ni al reves", () => {
  for (const name of buildProfiles) {
    const { brandId, url } = resolveProfile(name);
    assert.equal(brandForApiUrl(url), brandId, name);
    assert.equal(brandForApiUrl(profileEnv(name).EXPO_PUBLIC_API_URL), brandId, name);
  }
  assert.throws(
    () => resolveApiConfig({ brand: BRANDS.hdg, env: { APP_ENV: "sandbox", EXPO_PUBLIC_API_URL: WORX } }),
    /es la de the_worx/
  );
  assert.throws(
    () => resolveApiConfig({ brand: BRANDS.the_worx, env: { APP_ENV: "production", EXPO_PUBLIC_API_URL: HDG_SANDBOX } }),
    /es la de hdg/
  );
});

test("ninguna build de production apunta a sandbox", () => {
  for (const name of buildProfiles.filter((n) => n.endsWith("-production") || n.includes("-production-"))) {
    const env = profileEnv(name);
    assert.equal(env.APP_ENV, "production", name);
    assert.notEqual(env.EXPO_PUBLIC_API_URL, HDG_SANDBOX, name);
    for (const brand of Object.values(BRANDS)) {
      if (brand.api.sandbox) assert.notEqual(env.EXPO_PUBLIC_API_URL, brand.api.sandbox, name);
    }
  }
  // Y aunque alguien autorizara HDG production, no podria reusar la de sandbox.
  const hdgAuthorized = { ...BRANDS.hdg, api: { ...BRANDS.hdg.api, production: HDG_SANDBOX }, productionRelease: { authorized: true } };
  assert.throws(
    () => resolveApiConfig({ brand: hdgAuthorized, env: { APP_ENV: "production" }, brands: { ...BRANDS, hdg: hdgAuthorized } }),
    /no puede ser la de sandbox/
  );
});

test("production exige las dos cosas: API y autorizacion (quitar una vuelve a bloquear)", () => {
  const notAuthorized = { ...BRANDS.hdg, productionRelease: { authorized: false, reason: "x" } };
  assert.throws(() => resolveApiConfig({ brand: notAuthorized, env: { APP_ENV: "production" } }), /bloqueados/);
  const authorizedNoApi = { ...BRANDS.hdg, api: { ...BRANDS.hdg.api, production: null } };
  assert.throws(() => resolveApiConfig({ brand: authorizedNoApi, env: { APP_ENV: "production" } }), /no tiene API de production/);
  // HDG production no puede ser la de The Worx (dominio compartido): una URL, una marca.
  const sharedWithWorx = { ...BRANDS.hdg, api: { ...BRANDS.hdg.api, production: WORX } };
  assert.throws(() => resolveApiConfig({ brand: sharedWithWorx, env: { APP_ENV: "production" } }), /a la vez para hdg y the_worx/);
});

test("The Worx no tiene sandbox: pedirlo falla en vez de caer a otra API", () => {
  assert.throws(() => resolveApiConfig({ brand: BRANDS.the_worx, env: { APP_ENV: "sandbox" } }), /no tiene API de sandbox/);
});

test("entornos desconocidos y URLs que no son exactamente la esperada fallan", () => {
  assert.throws(() => resolveApiConfig({ brand: BRANDS.hdg, env: { APP_ENV: "staging" } }), /no existe/);
  assert.throws(
    () => resolveApiConfig({ brand: BRANDS.hdg, env: { APP_ENV: "sandbox", EXPO_PUBLIC_API_URL: "http://core.hdgexecutivesuites.com/api/v1" } }),
    /no es la API de hdg/
  );
  assert.throws(
    () => resolveApiConfig({ brand: BRANDS.the_worx, env: { EXPO_PUBLIC_API_URL: "https://localhost:4000/api/v1" } }),
    /no es la API de the_worx/
  );
  // La barra final no cuenta como otra URL.
  assert.equal(resolveApiConfig({ brand: BRANDS.the_worx, env: { EXPO_PUBLIC_API_URL: WORX + "/" } }).url, WORX);
});

test("cada URL de API es de una sola marca y todas son HTTPS", () => {
  const seen = new Map();
  for (const brand of Object.values(BRANDS)) {
    for (const url of Object.values(brand.api).filter(Boolean)) {
      assert.ok(url.startsWith("https://"), url);
      assert.ok(!seen.has(url), url + " repetida en " + seen.get(url) + " y " + brand.id);
      seen.set(url, brand.id);
    }
  }
});

// ── app.config.js y runtime ────────────────────────────────────────────────

test("app.config.js publica la API ya validada en extra.api", () => {
  assert.deepEqual(appConfigWith(profileEnv("worx-production")).extra.api, {
    brandId: "the_worx", environment: "production", url: WORX, host: "core.theworxoffices.com",
  });
  assert.deepEqual(appConfigWith(profileEnv("hdg-preview")).extra.api, {
    brandId: "hdg", environment: "sandbox", url: HDG_SANDBOX, host: "sandbox-core.hdgexecutivesuites.com",
  });
  assert.deepEqual(appConfigWith(profileEnv("hdg-production")).extra.api, {
    brandId: "hdg", environment: "production", url: HDG_PRODUCTION, host: "core.hdgexecutivesuites.com",
  });
  // Sin APP_ENV (los tests de marca, expo start sin script): el de la marca.
  assert.equal(appConfigWith({ APP_BRAND: "hdg" }).extra.api.url, HDG_SANDBOX);
  assert.equal(appConfigWith({ APP_BRAND: "the_worx" }).extra.api.url, WORX);
});

test("app.config.js no arranca con el .env de The Worx en una build de HDG", () => {
  assert.throws(() => appConfigWith({ APP_BRAND: "hdg", EXPO_PUBLIC_API_URL: WORX }), /es la de the_worx/);
  assert.throws(() => appConfigWith({ APP_BRAND: "the_worx", EXPO_PUBLIC_API_URL: HDG_SANDBOX }), /es la de hdg/);
});

test("los scripts locales fijan marca, entorno y URL coherentes", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  for (const [name, command] of Object.entries(scripts)) {
    const brandMatch = command.match(/APP_BRAND=(\S+)/);
    if (!brandMatch) continue;
    const env = Object.fromEntries([...command.matchAll(/(APP_BRAND|APP_ENV|EXPO_PUBLIC_API_URL)=(\S+)/g)].map((m) => [m[1], m[2]]));
    assert.ok(env.APP_ENV && env.EXPO_PUBLIC_API_URL, name + ": tiene que fijar APP_ENV y la URL");
    assert.doesNotThrow(() => resolveApiConfig({ brand: getBrand(env.APP_BRAND), env }), name);
  }
  assert.match(scripts["start:hdg"], /APP_ENV=sandbox/);
  assert.match(scripts["start:hdg"], /sandbox-core\.hdgexecutivesuites\.com/);
  // Ningun script local arranca HDG contra Production.
  for (const [name, command] of Object.entries(scripts)) {
    if (/APP_BRAND=hdg/.test(command)) assert.doesNotMatch(command, /APP_ENV=production|\/\/core\.hdgexecutivesuites/, name);
  }
});

test("en runtime la app comprueba la URL contra su marca", () => {
  assert.equal(assertApiUrlForBrand(HDG_SANDBOX, "hdg"), HDG_SANDBOX);
  assert.equal(assertApiUrlForBrand(HDG_PRODUCTION, "hdg"), HDG_PRODUCTION);
  assert.throws(() => assertApiUrlForBrand(HDG_PRODUCTION, "the_worx"), /es de hdg/);
  assert.equal(assertApiUrlForBrand(WORX, "the_worx"), WORX);
  assert.throws(() => assertApiUrlForBrand(WORX, "hdg"), /es de the_worx/);
  assert.throws(() => assertApiUrlForBrand(HDG_SANDBOX, "the_worx"), /es de hdg/);
  assert.throws(() => assertApiUrlForBrand(undefined, "hdg"), /sin URL/);

  // Dentro de la marca, la URL tiene que ser la de su entorno: Sandbox nunca va a core.
  assert.equal(assertApiUrlForEnvironment({ brand: BRANDS.hdg, url: HDG_SANDBOX, environment: "sandbox" }), HDG_SANDBOX);
  assert.equal(assertApiUrlForEnvironment({ brand: BRANDS.hdg, url: HDG_PRODUCTION + "/", environment: "production" }), HDG_PRODUCTION);
  assert.throws(() => assertApiUrlForEnvironment({ brand: BRANDS.hdg, url: HDG_PRODUCTION, environment: "sandbox" }), /la API es https:\/\/sandbox-core/);
  assert.throws(() => assertApiUrlForEnvironment({ brand: BRANDS.hdg, url: HDG_SANDBOX, environment: "production" }), /la API es https:\/\/core/);
  assert.throws(() => assertApiUrlForEnvironment({ brand: BRANDS.the_worx, url: WORX, environment: "sandbox" }), /no tiene API de sandbox/);
  assert.equal(assertApiUrlForEnvironment({ brand: BRANDS.the_worx, url: WORX, environment: "production" }), WORX);

  const api = read("src/lib/api.js");
  assert.match(api, /Constants\.expoConfig\?\.extra\?\.api/);
  assert.match(api, /assertApiUrlForEnvironment\(\{ brand: BRANDS\[brand\.id\], url: API_BASE_URL, environment: apiConfig\.environment \}\)/);
  assert.match(api, /assertApiUrlForBrand\(apiConfig\.url, brand\.id\)/);
  assert.doesNotMatch(api, /process\.env\.EXPO_PUBLIC_API_URL/, "la URL suelta no decide");
});

test("el submit de HDG production va a My HDG Mail (equipo The Workbox), nunca a la app de The Worx", () => {
  assert.deepEqual(eas.submit["hdg-production"], { ios: { ascAppId: "6835613644", appleTeamId: "3KX6P6C79Q" } });
  assert.notEqual(eas.submit["hdg-production"].ios.ascAppId, eas.submit["worx-production"].ios.ascAppId);
  assert.equal(eas.submit["hdg-production"].android, undefined, "solo iOS por ahora");
  assert.equal(eas.build["hdg-production"].autoSubmit, undefined, "sin auto-submit");
});

// ── TestFlight de HDG contra Sandbox ────────────────────────────────────────

test("hdg-testflight-sandbox: build de tienda contra HDG Sandbox, con canal OTA propio", () => {
  const profile = eas.build["hdg-testflight-sandbox"];
  assert.equal(profile.distribution, "store", "TestFlight necesita distribucion de tienda");
  assert.equal(profile.autoIncrement, true);
  assert.equal(profile.channel, "testflight-sandbox", "nunca el canal production: ningun OTA de produccion le llega");
  assert.notEqual(profile.environment, "production", "no carga variables de produccion de EAS");
  assert.deepEqual(resolveProfile("hdg-testflight-sandbox"), {
    brandId: "hdg",
    environment: "sandbox",
    url: HDG_SANDBOX,
    host: "sandbox-core.hdgexecutivesuites.com",
  });
  const expo = appConfigWith(profileEnv("hdg-testflight-sandbox"));
  assert.equal(expo.ios.bundleIdentifier, "com.hdgexecutivesuites.clientportal");
  assert.equal(expo.extra.eas.projectId, BRANDS.hdg.easProjectId);
  assert.equal(expo.extra.api.environment, "sandbox");
});

test("ningun otro perfil usa el canal de TestFlight Sandbox; hdg-production usa production", () => {
  for (const name of buildProfiles.filter((n) => n !== "hdg-testflight-sandbox")) {
    assert.notEqual(profileEnv(name).channel ?? eas.build[name].channel, "testflight-sandbox", name);
  }
  assert.equal(profileEnv("hdg-production").channel ?? eas.build["base-production"].channel, "production");
  // Submit: My HDG Mail en App Store Connect (equipo The Workbox, LLC), nunca la app de The Worx.
  assert.deepEqual(eas.submit["hdg-testflight-sandbox"], { ios: { ascAppId: "6835613644", appleTeamId: "3KX6P6C79Q" } });
  assert.notEqual(eas.submit["hdg-testflight-sandbox"].ios.ascAppId, eas.submit["worx-production"].ios.ascAppId);
  assert.equal(eas.submit["hdg-testflight-sandbox"].android, undefined, "solo iOS: TestFlight");
});

test("TestFlight de HDG: sin auto-submit en el perfil de build", () => {
  assert.equal(eas.build["hdg-testflight-sandbox"].autoSubmit, undefined);
  assert.equal(eas.build["hdg-testflight-sandbox"].ios?.autoSubmit, undefined);
});
