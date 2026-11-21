import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { appliesTo, checkProduction, productionVerdict } = require("../scripts/check-hdg-production.js");

// Lo que devuelve hoy core.hdgexecutivesuites.com (comprobado el 2026-11-21 con Origin members.).
const SANDBOX_PORTAL = { deployment: "sandbox", tenant: { slug: "hdg" }, center: { slug: "hollywood" } };
const PRODUCTION_PORTAL = { tenant: { slug: "hdg" }, center: { slug: "hollywood" } };

test("frena mientras core siga siendo Sandbox (deployment presente)", () => {
  const verdict = productionVerdict({ status: 200, body: SANDBOX_PORTAL });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /sigue siendo HDG sandbox/);
  // Cualquier valor de deployment frena: solo Production no lo trae.
  assert.equal(productionVerdict({ status: 200, body: { ...PRODUCTION_PORTAL, deployment: null } }).ok, false);
});

test("deja pasar HDG Production: sin deployment y tenant hdg", () => {
  assert.deepEqual(productionVerdict({ status: 200, body: PRODUCTION_PORTAL }).ok, true);
});

test("ante la duda frena: red, 5xx, error, JSON raro u otra organizacion", () => {
  assert.equal(productionVerdict({ error: "timeout" }).ok, false);
  assert.equal(productionVerdict({ status: 502, body: null }).ok, false);
  assert.equal(productionVerdict({ status: 200, body: { error: "Portal not found" } }).ok, false);
  assert.equal(productionVerdict({ status: 200, body: "html" }).ok, false);
  assert.equal(productionVerdict({ status: 200, body: { tenant: { slug: "the_worx" } } }).ok, false);
  assert.equal(productionVerdict({ status: 200, body: {} }).ok, false);
});

test("pide public/portal de core con el Origin del portal de miembros, solo GET", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return { status: 200, json: async () => PRODUCTION_PORTAL };
  };
  assert.equal((await checkProduction({ fetchImpl: fakeFetch })).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://core.hdgexecutivesuites.com/api/v1/public/portal");
  assert.equal(calls[0].options.headers.Origin, "https://members.hdgexecutivesuites.com");
  assert.equal(calls[0].options.method, undefined, "GET por defecto: nunca escribe");
  assert.equal(calls[0].options.body, undefined);

  const failing = async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  };
  const verdict = await checkProduction({ fetchImpl: failing });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /ENOTFOUND/);
});

test("solo se aplica a HDG Production: The Worx y HDG Sandbox no pasan por el freno", () => {
  assert.equal(appliesTo({ APP_BRAND: "hdg", APP_ENV: "production" }), true);
  assert.equal(appliesTo({ APP_BRAND: "hdg", APP_ENV: "sandbox" }), false);
  assert.equal(appliesTo({ APP_BRAND: "the_worx", APP_ENV: "production" }), false);
  assert.equal(appliesTo({}), false);
});

test("EAS lo ejecuta antes de instalar en cada build (hook eas-build-pre-install)", () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  assert.equal(scripts["eas-build-pre-install"], "node scripts/check-hdg-production.js");
  assert.equal(scripts["check:hdg-production"], "node scripts/check-hdg-production.js");
  const source = fs.readFileSync(path.join(root, "scripts/check-hdg-production.js"), "utf8");
  // En EAS, solo actua en HDG Production; fuera de EAS (a mano) comprueba siempre.
  assert.match(source, /if \(process\.env\.EAS_BUILD && !appliesTo\(\)\) return;/);
  assert.match(source, /if \(!verdict\.ok\) process\.exitCode = 1;/);
});
