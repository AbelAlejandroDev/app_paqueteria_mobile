import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { currentNativeRuntime, nativeChanges, readRecord } = require("../scripts/native-runtime.js");

/** Runtimes de builds ya instalados, con lo nativo distinto: no se reutilizan. */
const RETIRED_RUNTIMES = ["1.0.0"];

const appConfig = (brandId) => {
  const previous = process.env.APP_BRAND;
  process.env.APP_BRAND = brandId;
  delete require.cache[require.resolve("../app.config.js")];
  try {
    return require("../app.config.js").expo;
  } finally {
    if (previous === undefined) delete process.env.APP_BRAND;
    else process.env.APP_BRAND = previous;
    delete require.cache[require.resolve("../app.config.js")];
  }
};

test("lo nativo no cambia sin cambiar la runtime", () => {
  const recorded = readRecord();
  const current = currentNativeRuntime();
  const changes = nativeChanges(recorded, current);

  if (recorded.runtimeVersion === current.runtimeVersion) {
    assert.deepEqual(
      changes,
      [],
      "Cambio lo nativo con la misma runtime: sube RUNTIME_VERSION en app.config.js, ejecuta " +
        "`npm run native-runtime -- --write` y haz un build nuevo antes de cualquier OTA."
    );
  } else {
    assert.fail(`native-runtime.json es de ${recorded.runtimeVersion} y la app de ${current.runtimeVersion}: regeneralo.`);
  }
});

test("nativeChanges describe modulos y plugins cambiados", () => {
  const before = { runtimeVersion: "native-2", modules: { a: "1.0.0", b: "2.0.0" }, plugins: ["x"] };
  const after = { runtimeVersion: "native-2", modules: { a: "1.0.1", c: "1.0.0" }, plugins: ["x", "y"] };
  assert.deepEqual(nativeChanges(before, after), [
    "a: 1.0.0 -> 1.0.1",
    "b: 2.0.0 -> (quitado)",
    "c: (no estaba) -> 1.0.0",
    "plugins: [x] -> [x, y]",
  ]);
});

test("la runtime es explicita y no la comparten los builds antiguos", () => {
  for (const brandId of ["the_worx", "hdg"]) {
    const expo = appConfig(brandId);
    // Una cadena fija: ni "appVersion" ni "fingerprint", que la deducirian.
    assert.equal(typeof expo.runtimeVersion, "string", brandId);
    assert.match(expo.runtimeVersion, /^native-\d+$/, brandId);
    // Los builds de la politica anterior tienen runtime "1.0.0": ningun OTA
    // de esta runtime puede llegarles.
    assert.ok(!RETIRED_RUNTIMES.includes(expo.runtimeVersion), brandId);
    assert.notEqual(expo.runtimeVersion, expo.version, "runtime aparte de la version comercial");
    assert.match(expo.updates.url, /^https:\/\/u\.expo\.dev\/[0-9a-f-]{36}$/);
  }
});

test("version comercial 1.0.0; los numeros de build los lleva EAS", () => {
  const expo = appConfig("the_worx");
  assert.equal(expo.version, "1.0.0");
  // Con appVersionSource "remote", buildNumber y versionCode del config se
  // ignorarian: no se escriben, para que nadie crea que mandan.
  assert.equal(expo.ios?.buildNumber, undefined);
  assert.equal(expo.android?.versionCode, undefined);

  const eas = JSON.parse(fs.readFileSync(path.join(root, "eas.json"), "utf8"));
  assert.equal(eas.cli.appVersionSource, "remote");
  assert.equal(eas.build["base-production"].autoIncrement, true);
});

test("cada perfil de EAS va a su canal", () => {
  const eas = JSON.parse(fs.readFileSync(path.join(root, "eas.json"), "utf8"));
  assert.equal(eas.build["base-production"].channel, "production");
  assert.equal(eas.build["base-preview"].channel, "preview");
  assert.equal(eas.build["base-development"].channel, "development");
  for (const brand of ["worx", "hdg"]) {
    assert.equal(eas.build[`${brand}-production`].extends, "base-production");
  }
});
