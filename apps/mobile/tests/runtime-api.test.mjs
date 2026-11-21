import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { assertRuntimeApi } from "../src/lib/runtime-api.js";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { BRANDS } = require("../brands/index.js");

const HDG_SANDBOX = "https://sandbox-core.hdgexecutivesuites.com/api/v1";
const HDG_PRODUCTION = "https://core.hdgexecutivesuites.com/api/v1";
const WORX = "https://core.theworxoffices.com/api/v1";

const hdgSandbox = { brandId: "hdg", environment: "sandbox", url: HDG_SANDBOX, channels: BRANDS.hdg.updateChannels };
const hdgProduction = { brandId: "hdg", environment: "production", url: HDG_PRODUCTION, channels: BRANDS.hdg.updateChannels };
const worx = { brandId: "the_worx", environment: "production", url: WORX, channels: BRANDS.the_worx.updateChannels };

test("la OTA de Sandbox en el canal testflight-sandbox habla con sandbox-core", () => {
  assert.equal(assertRuntimeApi({ apiConfig: hdgSandbox, brandId: "hdg", bundledUrl: HDG_SANDBOX, channel: "testflight-sandbox" }), HDG_SANDBOX);
  assert.equal(assertRuntimeApi({ apiConfig: hdgProduction, brandId: "hdg", bundledUrl: HDG_PRODUCTION + "/", channel: "production" }), HDG_PRODUCTION);
  assert.equal(assertRuntimeApi({ apiConfig: worx, brandId: "the_worx", bundledUrl: WORX, channel: "production" }), WORX);
  // Sin canal (Expo Go, expo start): solo las comprobaciones de URL.
  assert.equal(assertRuntimeApi({ apiConfig: hdgSandbox, brandId: "hdg", bundledUrl: HDG_SANDBOX, channel: null }), HDG_SANDBOX);
});

test("estricta como 5e1da2a: la URL es EXACTAMENTE la empaquetada, aunque la otra sea de la misma marca", () => {
  // El caso de la 1.0.0 (2): config que dice Sandbox pero apunta a core.
  const oldTestflight = { ...hdgSandbox, url: HDG_PRODUCTION };
  assert.throws(
    () => assertRuntimeApi({ apiConfig: oldTestflight, brandId: "hdg", bundledUrl: HDG_SANDBOX, channel: "testflight-sandbox" }),
    (e) => e.code === "API_ENVIRONMENT_INVALID" && /la API es https:\/\/sandbox-core/.test(e.message)
  );
  assert.throws(() => assertRuntimeApi({ apiConfig: hdgProduction, brandId: "hdg", bundledUrl: HDG_SANDBOX, channel: "production" }), /la API es/);
  assert.throws(() => assertRuntimeApi({ apiConfig: hdgSandbox, brandId: "hdg", bundledUrl: undefined, channel: null }), /no lleva EXPO_PUBLIC_API_URL/);
});

test("otra marca, http o sin URL: no arranca", () => {
  assert.throws(() => assertRuntimeApi({ apiConfig: worx, brandId: "hdg", bundledUrl: WORX, channel: null }), /es de the_worx, no de hdg/);
  assert.throws(() => assertRuntimeApi({ apiConfig: { ...hdgSandbox, url: "http://sandbox-core.hdgexecutivesuites.com/api/v1" }, brandId: "hdg", bundledUrl: HDG_SANDBOX }), /HTTPS/);
  assert.throws(() => assertRuntimeApi({ apiConfig: undefined, brandId: "hdg", bundledUrl: HDG_SANDBOX }), /Falta la API/);
});

test("un bundle de otro entorno en un canal, o un canal ajeno, no arranca la API", () => {
  assert.throws(
    () => assertRuntimeApi({ apiConfig: hdgSandbox, brandId: "hdg", bundledUrl: HDG_SANDBOX, channel: "production" }),
    (e) => e.code === "UPDATE_CHANNEL_INVALID" && /update de otro entorno/.test(e.message)
  );
  assert.throws(() => assertRuntimeApi({ apiConfig: hdgProduction, brandId: "hdg", bundledUrl: HDG_PRODUCTION, channel: "testflight-sandbox" }), /update de otro entorno/);
  assert.throws(() => assertRuntimeApi({ apiConfig: worx, brandId: "the_worx", bundledUrl: WORX, channel: "testflight-sandbox" }), /no es de the_worx/);
  assert.throws(() => assertRuntimeApi({ apiConfig: { ...hdgSandbox, channels: undefined }, brandId: "hdg", bundledUrl: HDG_SANDBOX, channel: "preview" }), /no es de hdg/);
});

test("ningun codigo de la app importa el catalogo de marcas (no entra en el bundle)", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "vendor") walk(full);
      } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
        const source = fs.readFileSync(full, "utf8");
        if (/(from\s+["']|require\(\s*["'])(\.\.\/)+brands(\/|["'])/.test(source)) offenders.push(path.relative(root, full));
      }
    }
  };
  walk(path.join(root, "src"));
  assert.deepEqual(offenders, []);
});
