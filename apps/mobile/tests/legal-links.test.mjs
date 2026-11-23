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
const HDG_URL = "https://www.hdgexecutivesuites.com/my-hdg-mail-privacy-policy/";
const HDG_DELETION_URL = "https://members.hdgexecutivesuites.com/account-deletion";

/** La marca tal como la ve la app (extra.brand): solo lo suyo. */
const appBrand = (id) => ({ id, tenantSlug: BRANDS[id].tenantSlug, privacyPolicy: BRANDS[id].privacyPolicy, accountDeletion: BRANDS[id].accountDeletion });

test("cada organizacion tiene la suya en su app; los desconocidos no heredan nada", () => {
  assert.deepEqual(privacyPolicyFor("the_worx", appBrand("the_worx")), { name: "The Worx Offices Privacy Policy", url: WORX_URL });
  assert.equal(privacyPolicyFor("The-Worx", appBrand("the_worx"))?.url, WORX_URL);
  assert.deepEqual(privacyPolicyFor("hdg", appBrand("hdg")), { name: "My HDG Mail Privacy Policy", url: HDG_URL });
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
  assert.match(settings, /privacyPolicyFor\(user\?\.tenant\?\.slug, brand, capabilities\.legal\)/);
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

// ── Backend 51ee69d: el enlace lo decide el backend (capabilities.legal y GET /public/legal) ──

test("el backend manda si da una URL valida; si dice null o no responde, la publicada por la marca", async () => {
  const { parsePublicLegal, publicLegalPath } = await import("../src/lib/legal-links.js");
  const hdg = appBrand("hdg");
  const OTHER = "https://www.hdgexecutivesuites.com/legal/privacy";
  // Respuesta con URL: esa, con el nombre de la marca.
  assert.deepEqual(privacyPolicyFor("hdg", hdg, { privacyPolicyUrl: OTHER }), { name: "My HDG Mail Privacy Policy", url: OTHER });
  // Respuesta null (variable sin configurar, como Production hoy): la publicada por la
  // marca. Las tiendas exigen el enlace y es la de la misma organizacion.
  assert.equal(privacyPolicyFor("hdg", hdg, { privacyPolicyUrl: null })?.url, HDG_URL);
  assert.equal(privacyPolicyFor("hdg", hdg, {})?.url, HDG_URL);
  // Una URL que no es https limpia no se abre: se usa la de la marca.
  assert.equal(privacyPolicyFor("hdg", hdg, { privacyPolicyUrl: "http://www.hdgexecutivesuites.com/privacy-policy/" })?.url, HDG_URL);
  assert.equal(privacyPolicyFor("hdg", hdg, { privacyPolicyUrl: "javascript:alert(1)" })?.url, HDG_URL);
  // Sin politica en la marca y null en el backend: ninguna.
  assert.equal(privacyPolicyFor("hdg", { tenantSlug: "hdg" }, { privacyPolicyUrl: null }), null);
  // Sin respuesta (backend anterior o error de red): la de la marca de la build.
  assert.equal(privacyPolicyFor("hdg", hdg, null)?.url, HDG_URL);
  assert.equal(privacyPolicyFor("hdg", hdg)?.url, HDG_URL);
  // Nunca la de otra organizacion, diga lo que diga la respuesta.
  assert.equal(privacyPolicyFor("the_worx", hdg, { privacyPolicyUrl: WORX_URL }), null);

  assert.equal(publicLegalPath("hdg"), "/public/legal?tenant=hdg");
  assert.equal(publicLegalPath("The-Worx"), "/public/legal?tenant=the_worx");
  // /public/legal solo vale si es de la organizacion pedida.
  assert.deepEqual(parsePublicLegal({ tenant: "hdg", privacyPolicyUrl: null }, "hdg"), { privacyPolicyUrl: null, accountDeletionUrl: null });
  assert.deepEqual(parsePublicLegal({ tenant: "hdg", privacyPolicyUrl: HDG_URL, accountDeletionUrl: HDG_DELETION_URL, termsUrl: null, accountDeletion: { mode: "ASSISTED" } }, "hdg"), { privacyPolicyUrl: HDG_URL, accountDeletionUrl: HDG_DELETION_URL });
  assert.equal(parsePublicLegal({ tenant: "the_worx", privacyPolicyUrl: WORX_URL }, "hdg"), null);
  assert.equal(parsePublicLegal(null, "hdg"), null);
  assert.equal(parsePublicLegal("<html>", "hdg"), null);
});

test("capabilities.legal: ausente = no se sabe (null); presente con null = no hay politica", async () => {
  const { deriveCapabilities } = await import("../src/lib/capabilities.js");
  const base = { contractVersion: 1, tenant: { slug: "hdg" }, billing: {}, forwarding: {} };
  assert.equal(deriveCapabilities({ capabilities: base, expectedTenantSlug: "hdg" }).legal, null);
  assert.deepEqual(deriveCapabilities({ capabilities: { ...base, legal: { privacyPolicyUrl: null } }, expectedTenantSlug: "hdg" }).legal, { privacyPolicyUrl: null, accountDeletionUrl: null });
  assert.deepEqual(
    deriveCapabilities({ capabilities: { ...base, legal: { privacyPolicyUrl: HDG_URL, accountDeletionUrl: HDG_DELETION_URL } }, expectedTenantSlug: "hdg" }).legal,
    { privacyPolicyUrl: HDG_URL, accountDeletionUrl: HDG_DELETION_URL }
  );
  assert.equal(deriveCapabilities({ capabilities: null }).legal, null);
});

test("Settings usa capabilities.legal y Login enseña la politica antes de iniciar sesion", () => {
  const settings = read("src/app/(client)/settings/index.jsx");
  assert.match(settings, /privacyPolicyFor\(user\?\.tenant\?\.slug, brand, capabilities\.legal\)/);
  const login = read("src/app/login.jsx");
  assert.match(login, /queryFn: async \(\) => \(await api\.get\(publicLegalPath\(brand\.tenantSlug\)\)\)\.data/);
  assert.match(login, /parsePublicLegal\(query\.data, brand\.tenantSlug\)/);
  assert.match(login, /const privacyPolicy = usePublicPrivacyPolicy\(\);/);
  assert.match(login, /onPress=\{\(\) => WebBrowser\.openBrowserAsync\(privacyPolicy\.url\)\}/);
});
