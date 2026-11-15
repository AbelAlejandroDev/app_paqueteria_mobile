import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { isSetPasswordUrl, parseActivationLink } from "../src/lib/activation-link.js";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const { BRANDS } = require("../brands/index.js");
const { buildFiles } = require("../scripts/deep-link-files.js");

const TOKEN = "a1b2c3d4e5f6g7h8i9j0KLMN";

function appConfigWith(env, brandOverride) {
  const keys = ["APP_BRAND", "APP_ENV", "EXPO_PUBLIC_API_URL"];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  const brands = require("../brands/index.js");
  const saved = brandOverride ? { ...brands.BRANDS[env.APP_BRAND].appLinks } : null;
  if (brandOverride) brands.BRANDS[env.APP_BRAND].appLinks = { ...saved, ...brandOverride };
  delete require.cache[require.resolve("../app.config.js")];
  try {
    return require("../app.config.js").expo;
  } finally {
    if (brandOverride) brands.BRANDS[env.APP_BRAND].appLinks = saved;
    for (const k of keys) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
    delete require.cache[require.resolve("../app.config.js")];
  }
}

// ── Enlaces de activacion: #token= y ?token= ────────────────────────────────

test("formato actual del backend: el token en el fragmento (#token=&email=)", () => {
  const url = "https://members.hdgexecutivesuites.com/set-password#token=" + TOKEN + "&email=ana%40example.test";
  assert.deepEqual(parseActivationLink({ url, params: {} }), { token: TOKEN, email: "ana@example.test", mode: "activate" });
  assert.equal(isSetPasswordUrl(url), true);
});

test("formato antiguo: el token en la query (?token=)", () => {
  const url = "https://memberssandlake.theworxoffices.com/set-password?token=" + TOKEN + "&email=bob%40example.test";
  assert.deepEqual(parseActivationLink({ url, params: { token: TOKEN, email: "bob@example.test" } }), { token: TOKEN, email: "bob@example.test", mode: "activate" });
  // Aunque expo-router no lo pasara en params, se lee de la URL.
  assert.equal(parseActivationLink({ url, params: {} }).token, TOKEN);
});

test("esquema propio de la app, alta y nueva contraseña", () => {
  assert.deepEqual(parseActivationLink({ url: "hdgclient://set-password?token=" + TOKEN + "&mode=reset", params: { token: TOKEN, mode: "reset" } }), {
    token: TOKEN,
    email: "",
    mode: "reset",
  });
  assert.equal(parseActivationLink({ url: "worxclient://set-password#token=" + TOKEN, params: {} }).token, TOKEN);
  assert.equal(isSetPasswordUrl("worxclient://set-password?token=x"), true);
  assert.equal(isSetPasswordUrl("https://x.test/billing#token=x"), false);
});

test("el fragmento manda sobre la query si vienen los dos", () => {
  const other = "zzzzzzzzzzzzzzzzzz";
  assert.equal(parseActivationLink({ url: "https://p.test/set-password?token=" + other + "#token=" + TOKEN, params: { token: other } }).token, TOKEN);
});

test("tokens y correos con forma rara se descartan", () => {
  for (const bad of ["", "short", "has space here 1234", "<script>alert(1)</script>", "x".repeat(600)]) {
    assert.equal(parseActivationLink({ url: "https://p.test/set-password#token=" + encodeURIComponent(bad), params: {} }).token, "", bad);
  }
  assert.equal(parseActivationLink({ url: "https://p.test/set-password#token=" + TOKEN + "&email=not-an-email", params: {} }).email, "");
  assert.deepEqual(parseActivationLink(), { token: "", email: "", mode: "activate" });
  assert.deepEqual(parseActivationLink({ url: null, params: null }), { token: "", email: "", mode: "activate" });
});

test("la pantalla lee la URL completa (expo-router no da el fragmento) y no registra el token", () => {
  const screen = read("src/app/set-password.jsx");
  assert.match(screen, /const linkUrl = ExpoLinking\.useLinkingURL\(\);/);
  assert.match(screen, /parseActivationLink\(\{ url: linkUrl, params \}\)/);
  assert.doesNotMatch(screen, /console\.(log|warn|info)\([^)]*token/i);
  // El token solo viaja en el cuerpo de set-password.
  assert.match(screen, /api\.post\("\/auth\/set-password", \{\s*token,/);
});

// ── Universal Links / App Links ─────────────────────────────────────────────

test("los hosts son los portales de miembros reales y estan apagados hasta publicar los ficheros", () => {
  assert.deepEqual(BRANDS.the_worx.appLinks.hosts, [
    "memberssandlake.theworxoffices.com",
    "membershallandale.theworxoffices.com",
    "membershunterscreek.theworxoffices.com",
  ]);
  assert.deepEqual(BRANDS.hdg.appLinks.hosts, ["members.hdgexecutivesuites.com"]);
  for (const brand of Object.values(BRANDS)) {
    assert.equal(brand.appLinks.enabled, false, brand.id);
    assert.deepEqual(brand.appLinks.paths, ["/set-password"], brand.id);
    // Cada marca solo reclama sus propios portales.
    for (const other of Object.values(BRANDS)) {
      if (other.id !== brand.id) for (const host of brand.appLinks.hosts) assert.ok(!other.appLinks.hosts.includes(host), host);
    }
  }
});

test("apagado: ni Associated Domains ni filtros de intent (lo nativo no cambia)", () => {
  for (const env of [{ APP_BRAND: "the_worx" }, { APP_BRAND: "hdg", APP_ENV: "sandbox" }]) {
    const expo = appConfigWith(env);
    assert.equal(expo.ios.associatedDomains, undefined, env.APP_BRAND);
    assert.equal(expo.android.intentFilters, undefined, env.APP_BRAND);
  }
});

test("encendido: applinks: por host en iOS y App Links verificados solo para /set-password en Android", () => {
  const expo = appConfigWith({ APP_BRAND: "hdg", APP_ENV: "sandbox" }, { enabled: true });
  assert.deepEqual(expo.ios.associatedDomains, ["applinks:members.hdgexecutivesuites.com"]);
  assert.deepEqual(expo.android.intentFilters, [
    {
      action: "VIEW",
      autoVerify: true,
      data: [{ scheme: "https", host: "members.hdgexecutivesuites.com", pathPrefix: "/set-password" }],
      category: ["BROWSABLE", "DEFAULT"],
    },
  ]);
});

test("los ficheros .well-known se generan solo con el Team ID y la huella reales", () => {
  const sha = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");
  assert.throws(() => buildFiles(BRANDS.hdg, { teamId: "", sha256: sha }), /APPLE_TEAM_ID/);
  assert.throws(() => buildFiles(BRANDS.hdg, { teamId: "ABCDE12345", sha256: "" }), /ANDROID_SHA256/);
  assert.throws(() => buildFiles(BRANDS.hdg, { teamId: "ABCDE12345", sha256: "AA:BB" }), /ANDROID_SHA256/);

  const { appleAppSiteAssociation, assetLinks } = buildFiles(BRANDS.hdg, { teamId: "ABCDE12345", sha256: sha });
  const detail = appleAppSiteAssociation.applinks.details[0];
  assert.deepEqual(detail.appIDs, ["ABCDE12345.com.hdgexecutivesuites.clientportal"]);
  assert.deepEqual(detail.components, [{ "/": "/set-password", comment: "Account activation and password reset" }]);
  assert.equal(assetLinks[0].target.package_name, "com.hdgexecutivesuites.clientportal");
  assert.deepEqual(assetLinks[0].target.sha256_cert_fingerprints, [sha]);
});

test("la ruta del enlace existe en la app (expo-router /set-password)", () => {
  assert.ok(fs.existsSync(path.join(root, "src/app/set-password.jsx")));
});
