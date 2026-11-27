/**
 * Candidato de HDG Production (release/hdg-mobile-production).
 *
 * - Settings no ofrece "Automatic Forwarding Charges" cuando el centro tiene el
 *   reenvio apagado (HDG Production en su lanzamiento: services.forwarding
 *   false), pero nunca la quita por un fallo de red: retirar la autorizacion
 *   tiene que seguir siendo posible.
 * - Ningun texto visible de una build de HDG nombra a The Worx.
 * - El perfil hdg-production solo apunta a HDG Production.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRequire } from "node:module";

import { autoChargeSettingsVisible } from "../src/lib/auto-charge-consent.js";
import { deriveCapabilities, demoNotice, pickDemo } from "../src/lib/capabilities.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const require = createRequire(import.meta.url);
const { legalVerdict } = require("../scripts/check-hdg-legal.js");
const { builderEnvVerdict } = require("../scripts/check-hdg-production.js");
const { BRANDS } = require("../brands/index.js");

const HDG = { id: "hdg", tenantSlug: "hdg", forwardingAutoCharge: true };
const WORX = { id: "the_worx", tenantSlug: "the_worx", forwardingAutoCharge: false };

test("Settings: HDG con reenvio activo enseña el cobro automatico", () => {
  assert.equal(autoChargeSettingsVisible({ tenantSlug: "hdg", brand: HDG, forwardingAllowed: true }), true);
});

test("Settings: services.forwarding false (HDG Production hoy) lo quita", () => {
  assert.equal(autoChargeSettingsVisible({ tenantSlug: "hdg", brand: HDG, forwardingAllowed: false }), false);
});

test("Settings: capacidades desconocidas o con error no lo quitan (retirar siempre posible)", () => {
  assert.equal(autoChargeSettingsVisible({ tenantSlug: "hdg", brand: HDG, forwardingAllowed: null }), true);
  assert.equal(autoChargeSettingsVisible({ tenantSlug: "hdg", brand: HDG }), true);
});

test("Settings: mientras cargan las capacidades no aparece", () => {
  assert.equal(autoChargeSettingsVisible({ tenantSlug: "hdg", brand: HDG, forwardingAllowed: true, loading: true }), false);
});

test("Settings: The Worx y otra organizacion nunca lo ven", () => {
  assert.equal(autoChargeSettingsVisible({ tenantSlug: "the_worx", brand: WORX, forwardingAllowed: true }), false);
  assert.equal(autoChargeSettingsVisible({ tenantSlug: "the_worx", brand: HDG, forwardingAllowed: true }), false);
});

test("Settings usa la regla con las capacidades y no solo la marca", () => {
  const source = read("src/app/(client)/settings/index.jsx");
  assert.match(source, /autoChargeSettingsVisible\(/);
  assert.match(source, /serviceAllowed\(capabilities, "forwarding"\)/);
  assert.doesNotMatch(source, /autoChargeConsentEnabled\(/);
});

test("el aviso biometrico por defecto no nombra ninguna marca", () => {
  const source = read("src/lib/security-preferences.js");
  assert.doesNotMatch(source, /Unlock The Worx/);
  assert.match(source, /authenticate\(promptMessage = "Unlock your mailbox"\)/);
});

test("ningun texto de la app (fuera de comentarios) nombra a The Worx", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
        const code = read(rel)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        if (/["'`][^"'`\n]*\bWorx\b[^"'`\n]*["'`]/.test(code)) offenders.push(rel);
      }
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
});

test("perfil hdg-production: HDG, production, API core y canal production", () => {
  const eas = JSON.parse(read("eas.json"));
  const profile = eas.build["hdg-production"];
  assert.equal(profile.extends, "base-production");
  assert.deepEqual(profile.env, {
    APP_BRAND: "hdg",
    APP_ENV: "production",
    EXPO_PUBLIC_API_URL: "https://core.hdgexecutivesuites.com/api/v1",
  });
  const base = eas.build["base-production"];
  assert.equal(base.channel, "production");
  assert.equal(base.environment, "production");
  assert.equal(base.autoIncrement, true);
  assert.equal(base.developmentClient, undefined);
  assert.equal(base.distribution, undefined, "store por defecto: IPA de App Store y AAB");
  assert.equal(base.android?.buildType, undefined, "AAB, no APK");
  assert.equal(eas.cli.appVersionSource, "remote");
});

test("submit hdg-production: ficha de HDG y Android en borrador interno", () => {
  const eas = JSON.parse(read("eas.json"));
  const submit = eas.submit["hdg-production"];
  assert.equal(submit.ios.ascAppId, "6835613644");
  assert.notEqual(submit.ios.ascAppId, eas.submit["worx-production"].ios.ascAppId);
  assert.deepEqual(submit.android, { track: "internal", releaseStatus: "draft" });
});

// ── Modo demo de App Review (backend bc38c9b/45569af, docs/mobile/app-review-demo.md) ──

const DEMO_BODY = { active: true, payments: "SIMULATED", labels: "SAMPLE_PDF", notice: "App Review demo account: payments and shipping labels are simulated." };

test("demo: solo con active true y aviso del servidor; el texto es el del servidor", () => {
  assert.deepEqual(pickDemo(DEMO_BODY), { ...DEMO_BODY });
  assert.equal(pickDemo(null), null);
  assert.equal(pickDemo({ ...DEMO_BODY, active: false }), null);
  assert.equal(pickDemo({ ...DEMO_BODY, active: "true" }), null);
  assert.equal(pickDemo({ ...DEMO_BODY, notice: "  " }), null);
});

test("demo: un cliente normal no lo tiene (campo ausente) y la app no decide nada mas", () => {
  const base = { contractVersion: 1, tenant: { slug: "hdg" }, billing: {}, forwarding: {}, services: { forwarding: false } };
  const normal = deriveCapabilities({ capabilities: base, expectedTenantSlug: "hdg" });
  assert.equal(normal.demo, null);
  assert.equal(demoNotice(normal), null);
  const demo = deriveCapabilities({ capabilities: { ...base, demo: DEMO_BODY }, expectedTenantSlug: "hdg" });
  assert.equal(demoNotice(demo), DEMO_BODY.notice);
  // El modo demo no abre servicios: si el servidor dice forwarding false, sigue false.
  assert.equal(demo.services.forwarding, false);
  assert.equal(deriveCapabilities({ capabilities: null }).demo, null);
});

test("demo: el aviso sale en el panel y en el pago del reenvio", () => {
  assert.match(read("src/app/(client)/dashboard.jsx"), /demoNotice\(capabilities\)/);
  assert.match(read("src/components/common/zoho-forward-payment-card.jsx"), /demoNotice\(capabilities\)/);
});

test("demo: la pagina de pago simulada (host de la API) se puede abrir: no hay lista de hosts de Zoho", () => {
  const source = read("src/lib/secure-url.js");
  assert.doesNotMatch(source, /zoho/i);
});

// ── Enlaces legales de Production (scripts/check-hdg-legal.js) ──

const HDG_BRAND = BRANDS.hdg;
const GOOD = {
  tenant: "hdg",
  privacyPolicyUrl: HDG_BRAND.privacyPolicy.url,
  accountDeletionUrl: HDG_BRAND.accountDeletion.url,
  termsUrl: null,
  accountDeletion: { mode: "ASSISTED" },
};

test("legal: OK solo con las dos URLs publicadas por HDG", () => {
  assert.deepEqual(legalVerdict({ status: 200, body: GOOD }), { ok: true, problems: [] });
});

test("legal: Production de hoy (backend anterior a 0497bab, sin variables) falla con la causa", () => {
  const verdict = legalVerdict({ status: 200, body: { tenant: "hdg", privacyPolicyUrl: null } });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((p) => p.includes("PRIVACY_POLICY_URL__HDG")));
  assert.ok(verdict.problems.some((p) => p.includes("0497bab")));
});

test("legal: variable sin poner, URL de otra pagina, red o 5xx: falla", () => {
  assert.ok(legalVerdict({ status: 200, body: { ...GOOD, accountDeletionUrl: null } }).problems[0].includes("ACCOUNT_DELETION_URL__HDG"));
  assert.equal(legalVerdict({ status: 200, body: { ...GOOD, privacyPolicyUrl: "https://www.hdgexecutivesuites.com/privacy-policy/" } }).ok, false);
  assert.equal(legalVerdict({ status: 200, body: { ...GOOD, tenant: "the_worx" } }).ok, false);
  assert.equal(legalVerdict({ status: 503, body: null }).ok, false);
  assert.equal(legalVerdict({ error: "timeout" }).ok, false);
});

test("legal: hay script de npm", () => {
  assert.equal(JSON.parse(read("package.json")).scripts["check:hdg-legal"], "node scripts/check-hdg-legal.js");
});

// ── Variables en el builder remoto (scripts/check-hdg-production.js) ──

const BUILDER_OK = {
  EAS_BUILD: "true",
  EAS_BUILD_PROFILE: "hdg-production",
  APP_BRAND: "hdg",
  APP_ENV: "production",
  EXPO_PUBLIC_API_URL: "https://core.hdgexecutivesuites.com/api/v1",
};

test("builder: hdg-production con sus tres variables pasa y lo deja escrito", () => {
  const verdict = builderEnvVerdict(BUILDER_OK);
  assert.equal(verdict.ok, true);
  assert.match(verdict.message, /core\.hdgexecutivesuites\.com/);
});

test("builder: hdg-production sin APP_BRAND, con Sandbox o con otra URL se para", () => {
  const { APP_BRAND: _drop, ...noBrand } = BUILDER_OK;
  assert.equal(builderEnvVerdict(noBrand).ok, false);
  assert.equal(builderEnvVerdict({ ...BUILDER_OK, APP_ENV: "sandbox" }).ok, false);
  assert.equal(builderEnvVerdict({ ...BUILDER_OK, EXPO_PUBLIC_API_URL: "https://sandbox-core.hdgexecutivesuites.com/api/v1" }).ok, false);
});

test("builder: otros perfiles (The Worx, Sandbox) no pasan por aqui", () => {
  assert.equal(builderEnvVerdict({ ...BUILDER_OK, EAS_BUILD_PROFILE: "worx-production", APP_BRAND: "the_worx" }), null);
  assert.equal(builderEnvVerdict({ ...BUILDER_OK, EAS_BUILD_PROFILE: "hdg-testflight-sandbox", APP_ENV: "sandbox" }), null);
});

test("builder: el hook de EAS sigue siendo el mismo script", () => {
  assert.equal(JSON.parse(read("package.json")).scripts["eas-build-pre-install"], "node scripts/check-hdg-production.js");
});
