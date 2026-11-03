import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function appConfig(brandId) {
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
}

const pluginOptions = (expo, name) =>
  (expo.plugins || []).find((plugin) => Array.isArray(plugin) && plugin[0] === name)?.[1] || {};

test("sin microfono: la app solo toma y elige fotos", () => {
  for (const brand of ["the_worx", "hdg"]) {
    const picker = pluginOptions(appConfig(brand), "expo-image-picker");
    assert.equal(picker.microphonePermission, false, brand);
    assert.ok(picker.cameraPermission && picker.photosPermission, brand + ": los textos de camara y fotos siguen");
  }
  // Ningun uso de video o audio en el codigo.
  const picker = read("src/components/common/document-picker-field.jsx");
  assert.equal((picker.match(/mediaTypes: \["images"\]/g) || []).length, 2);
  assert.doesNotMatch(picker, /videos|livePhotos/);
  const pkg = JSON.parse(read("package.json"));
  for (const dep of ["expo-av", "expo-audio", "expo-video", "expo-camera"]) {
    assert.equal(pkg.dependencies[dep], undefined, dep);
  }
});

test("envio a las tiendas: TestFlight con su app y Google Play en internal, sin claves en el repo", () => {
  const submit = JSON.parse(read("eas.json")).submit["worx-production"];
  assert.equal(submit.ios.ascAppId, "6822867406");
  assert.equal(submit.android.track, "internal");
  // Una app que aun no esta publicada en Play solo admite releases en borrador.
  assert.equal(submit.android.releaseStatus, "draft");
  // La cuenta de servicio vive en EAS, no en un archivo del repo.
  assert.equal(submit.android.serviceAccountKeyPath, undefined);

  const gitignore = read(".gitignore");
  for (const pattern of ["*service-account*.json", "google-play*.json", "*.p8", "*.p12", "*.keystore", "*.jks"]) {
    assert.ok(gitignore.includes(pattern), pattern);
  }
  // google-services.json es publico y tiene que ir en el build.
  assert.ok(fs.existsSync(path.join(root, "assets/brands/the_worx/google-services.json")));
});
