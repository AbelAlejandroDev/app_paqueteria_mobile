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

import { autoChargeSettingsVisible } from "../src/lib/auto-charge-consent.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

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
