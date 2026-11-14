import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { sandboxIndicator } from "../src/lib/environment-indicator.js";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const { getBrand } = require("../brands/index.js");
const { resolveApiConfig } = require("../brands/api-environment.js");

const hdgBuild = resolveApiConfig({ brand: getBrand("hdg"), env: { APP_ENV: "sandbox" } }).environment;
const worxBuild = resolveApiConfig({ brand: getBrand("the_worx"), env: {} }).environment;

test("con sesion manda environment de /client/capabilities: sandbox enseña la franja", () => {
  const indicator = sandboxIndicator({ apiEnvironment: hdgBuild, serverEnvironment: "sandbox" });
  assert.equal(indicator.visible, true);
  assert.equal(indicator.mismatch, false);
  assert.match(indicator.label, /Sandbox/);
});

test("The Worx: environment production, sin franja", () => {
  assert.deepEqual(sandboxIndicator({ apiEnvironment: worxBuild, serverEnvironment: "production" }), {
    visible: false,
    label: null,
    mismatch: false,
  });
});

test("antes del login (sin capacidades) decide la build: HDG Sandbox si, The Worx no", () => {
  assert.equal(sandboxIndicator({ apiEnvironment: hdgBuild, serverEnvironment: null }).visible, true);
  assert.equal(sandboxIndicator({ apiEnvironment: worxBuild, serverEnvironment: null }).visible, false);
});

test("'unspecified' (backend en desarrollo local) no es sandbox ni production: sigue la build", () => {
  assert.equal(sandboxIndicator({ apiEnvironment: worxBuild, serverEnvironment: "unspecified" }).visible, false);
  assert.equal(sandboxIndicator({ apiEnvironment: hdgBuild, serverEnvironment: "unspecified" }).visible, true);
});

test("build y servidor que no coinciden se avisan en rojo", () => {
  const prodAppSandboxServer = sandboxIndicator({ apiEnvironment: "production", serverEnvironment: "sandbox" });
  assert.equal(prodAppSandboxServer.visible, true);
  assert.equal(prodAppSandboxServer.mismatch, true);

  const sandboxAppProdServer = sandboxIndicator({ apiEnvironment: "sandbox", serverEnvironment: "production" });
  assert.equal(sandboxAppProdServer.visible, true);
  assert.equal(sandboxAppProdServer.mismatch, true);
});

test("sin datos no se inventa nada", () => {
  assert.equal(sandboxIndicator().visible, false);
});

test("la franja envuelve la app y lee environment de las capacidades", () => {
  assert.match(read("src/app/_layout.jsx"), /<SandboxFrame>/);
  const frame = read("src/components/common/sandbox-frame.jsx");
  assert.match(frame, /const \{ environment \} = useCapabilities\(\);/);
  assert.match(frame, /sandboxIndicator\(\{ apiEnvironment, serverEnvironment: environment \}\)/);
  assert.match(frame, /SafeAreaInsetsContext\.Provider value=\{\{ \.\.\.insets, top: 0 \}\}/, "no duplica el inset superior");
  assert.match(read("src/lib/api.js"), /export const apiEnvironment = apiConfig\.environment;/);
});
