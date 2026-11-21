import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { privacyPolicyFor } from "../src/lib/legal-links.js";

/**
 * Settings → Legal → Privacy Policy: un enlace a la politica publica de la
 * organizacion del usuario. The Worx (sus tres centros) enlaza su politica
 * corporativa; HDG la suya, y ninguna hereda la de la otra. Cada build lleva
 * solo la de su marca (extra.brand.privacyPolicy), no la tabla de todas.
 */

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const { BRANDS } = require("../brands/index.js");

const WORX_URL = "https://theworxoffices.com/privacy-policy";
const HDG_URL = "https://www.hdgexecutivesuites.com/privacy-policy/";

/** La marca tal como la ve la app (extra.brand): solo lo suyo. */
const appBrand = (id) => ({ id, tenantSlug: BRANDS[id].tenantSlug, privacyPolicy: BRANDS[id].privacyPolicy });

test("cada organizacion tiene la suya en su app; los desconocidos no heredan nada", () => {
  assert.deepEqual(privacyPolicyFor("the_worx", appBrand("the_worx")), { name: "The Worx Offices Privacy Policy", url: WORX_URL });
  assert.equal(privacyPolicyFor("The-Worx", appBrand("the_worx"))?.url, WORX_URL);
  assert.deepEqual(privacyPolicyFor("hdg", appBrand("hdg")), { name: "HDG Executive Suites Privacy Policy", url: HDG_URL });
  assert.equal(privacyPolicyFor("HDG", appBrand("hdg"))?.url, HDG_URL);
  // Aislamiento: la app de una organizacion nunca enlaza la politica de otra.
  assert.equal(privacyPolicyFor("the_worx", appBrand("hdg")), null);
  assert.equal(privacyPolicyFor("hdg", appBrand("the_worx")), null);
  for (const slug of ["", null, undefined, "otro", "__proto__", "constructor"]) {
    assert.equal(privacyPolicyFor(slug, appBrand("hdg")), null, String(slug));
  }
  // Sin politica en la marca (o marca de respaldo), no hay enlace.
  assert.equal(privacyPolicyFor("hdg", { tenantSlug: "hdg" }), null);
  assert.equal(privacyPolicyFor("hdg", undefined), null);
});

test("las politicas son https sin credenciales (lo que la app abre en el navegador)", async () => {
  const { isSecureHttpsUrl } = await import("../src/lib/secure-url.js");
  for (const id of ["the_worx", "hdg"]) assert.equal(isSecureHttpsUrl(BRANDS[id].privacyPolicy.url), true, id);
  assert.doesNotMatch(BRANDS.hdg.privacyPolicy.url, /theworx/);
  assert.doesNotMatch(BRANDS.the_worx.privacyPolicy.url, /hdgexecutivesuites/);
});

test("cada build lleva solo la politica de su marca (extra.brand)", () => {
  const source = read("app.config.js");
  assert.match(source, /privacyPolicy: brand\.privacyPolicy \|\| null,/);
  // La tabla de todas las organizaciones ya no esta en el codigo de la app.
  const lib = read("src/lib/legal-links.js");
  assert.doesNotMatch(lib, /https:\/\//);
  assert.doesNotMatch(lib, /(from\s+["']|require\(\s*["'])(\.\.\/)+brands/);
});

test("Settings tiene Legal con Privacy Policy, por la organizacion del usuario y la marca de la app", () => {
  const settings = read("src/app/(client)/settings/index.jsx");
  assert.match(settings, />Legal</);
  assert.match(settings, /const privacyPolicy = privacyPolicyFor\(user\?\.tenant\?\.slug, brand\);/);
  assert.match(settings, /\{privacyPolicy \? \(/, "sin politica no hay seccion");
  assert.match(settings, /label="Privacy Policy"/);
});

test("se abre fuera de la app con el mismo patron que Conference Room, y nada se pide al servidor", () => {
  const settings = read("src/app/(client)/settings/index.jsx");
  assert.match(settings, /onPress=\{\(\) => WebBrowser\.openBrowserAsync\(privacyPolicy\.url\)\}/);
  assert.match(settings, /\{external \? <ExternalLink/);
  const lib = read("src/lib/legal-links.js");
  assert.doesNotMatch(lib, /api\.|fetch\(|wp-json/);
});

test("Terms & Conditions sigue donde estaba", () => {
  const settings = read("src/app/(client)/settings/index.jsx");
  assert.match(settings, /\{ label: "Terms & Conditions", href: "\/settings\/terms", icon: FileText \}/);
});
