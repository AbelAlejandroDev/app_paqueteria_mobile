import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeRunningUpdate } from "../src/lib/update-info.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("una OTA se ve por el inicio de su Update ID y el canal", () => {
  assert.equal(
    describeRunningUpdate({
      updateId: "01A1F35B-EC40-711E-AEA4-397EC97F53DA",
      isEmbeddedLaunch: false,
      channel: "testflight-sandbox",
    }),
    "01a1f35b · testflight-sandbox"
  );
});

test("el codigo que vino en la build se ve como Built-in", () => {
  assert.equal(
    describeRunningUpdate({ updateId: "ae96ea36-0ec0-4a50-8dd4-50e25e8fd2e9", isEmbeddedLaunch: true, channel: "testflight-sandbox" }),
    "Built-in · testflight-sandbox"
  );
  assert.equal(describeRunningUpdate({ updateId: null, isEmbeddedLaunch: false, channel: "production" }), "Built-in · production");
});

test("sin expo-updates (desarrollo) no inventa nada", () => {
  assert.equal(describeRunningUpdate({}), "Development");
  assert.equal(describeRunningUpdate(), "Development");
  assert.equal(describeRunningUpdate({ updateId: "01a1f35b-ec40", isEmbeddedLaunch: false }), "01a1f35b");
});

test("Settings ensena la actualizacion en curso con los datos de expo-updates", () => {
  const source = fs.readFileSync(path.join(root, "src/app/(client)/settings/index.jsx"), "utf8");
  assert.match(source, /import \* as Updates from "expo-updates"/);
  assert.match(source, /label: "App Update"/);
  assert.match(source, /describeRunningUpdate\(\{\s*updateId: Updates\.updateId,\s*isEmbeddedLaunch: Updates\.isEmbeddedLaunch,\s*channel: Updates\.channel,/);
});
