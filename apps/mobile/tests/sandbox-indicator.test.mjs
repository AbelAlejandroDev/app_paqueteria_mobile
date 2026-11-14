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

test("HDG Sandbox (build sandbox) enseña la franja", () => {
  const { environment } = resolveApiConfig({ brand: getBrand("hdg"), env: { APP_ENV: "sandbox" } });
  const indicator = sandboxIndicator({ apiEnvironment: environment, deployment: null });
  assert.equal(indicator.visible, true);
  assert.equal(indicator.mismatch, false);
  assert.match(indicator.label, /Sandbox/);
});

test("The Worx (production) no la enseña", () => {
  const { environment } = resolveApiConfig({ brand: getBrand("the_worx"), env: {} });
  assert.deepEqual(sandboxIndicator({ apiEnvironment: environment, deployment: null }), { visible: false, label: null, mismatch: false });
});

test("si el servidor dice sandbox, se enseña aunque la build sea de production, marcado como discrepancia", () => {
  const indicator = sandboxIndicator({ apiEnvironment: "production", deployment: "sandbox" });
  assert.equal(indicator.visible, true);
  assert.equal(indicator.mismatch, true);
});

test("build sandbox con el servidor confirmando sandbox: franja normal", () => {
  assert.equal(sandboxIndicator({ apiEnvironment: "sandbox", deployment: "sandbox" }).mismatch, false);
});

test("sin datos no se inventa nada", () => {
  assert.equal(sandboxIndicator().visible, false);
  assert.equal(sandboxIndicator({ apiEnvironment: undefined, deployment: undefined }).visible, false);
});

test("la franja envuelve toda la app y recibe el entorno real de la build", () => {
  const layout = read("src/app/_layout.jsx");
  assert.match(layout, /<SandboxFrame apiEnvironment=\{apiEnvironment\}/);
  assert.match(read("src/lib/api.js"), /export const apiEnvironment = apiConfig\.environment;/);
  const frame = read("src/components/common/sandbox-frame.jsx");
  assert.match(frame, /SafeAreaInsetsContext\.Provider value=\{\{ \.\.\.insets, top: 0 \}\}/, "no duplica el inset superior");
});
