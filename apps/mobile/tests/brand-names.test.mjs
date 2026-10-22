import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { buildWelcomeSlides } from "../src/lib/onboarding-content.js";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

/** app.config.js tal como lo evalua EAS para una marca. */
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

// Lo que no puede cambiar al renombrar: tiendas, push, OTA y deep links
// cuelgan de estos valores.
const EXPECTED = {
  the_worx: {
    appName: "My Worx Mail",
    company: "The Worx Offices",
    bundleId: "com.theworxoffices.clientportal",
    scheme: "worxclient",
    slug: "worx-client",
    projectId: "922f4b80-6a1f-4072-a4df-c0d35fe374c8",
    tenantSlug: "the_worx",
    googleServices: "./assets/brands/the_worx/google-services.json",
  },
  hdg: {
    appName: "My HDG Mail",
    company: "HDG Executive Suites",
    bundleId: "com.hdgexecutivesuites.clientportal",
    scheme: "hdgclient",
    slug: "hdg-client",
    projectId: "2e12104c-c190-48aa-b044-da110d34e8f1",
    tenantSlug: "hdg",
    googleServices: undefined, // HDG aun no tiene google-services.json
  },
};

for (const [brandId, want] of Object.entries(EXPECTED)) {
  test(`${brandId}: el telefono muestra "${want.appName}"`, () => {
    const expo = appConfig(brandId);
    assert.equal(expo.name, want.appName);
    assert.equal(expo.extra.brand.appName, want.appName);
    // La empresa sigue siendo la empresa: logo, cabecera y textos legales.
    assert.equal(expo.extra.brand.name, want.company);
  });

  test(`${brandId}: renombrar no toca identificadores ni versiones`, () => {
    const expo = appConfig(brandId);
    assert.equal(expo.ios.bundleIdentifier, want.bundleId);
    assert.equal(expo.android.package, want.bundleId);
    assert.equal(expo.scheme, want.scheme);
    assert.equal(expo.slug, want.slug);
    assert.equal(expo.owner, "ab-estrategia-360");
    assert.equal(expo.extra.eas.projectId, want.projectId);
    assert.equal(expo.updates.url, "https://u.expo.dev/" + want.projectId);
    assert.equal(expo.extra.brand.tenantSlug, want.tenantSlug);
    assert.equal(expo.android.googleServicesFile, want.googleServices);
    assert.equal(expo.version, "1.0.0");
    assert.equal(expo.runtimeVersion, "native-2");
  });
}

// ── El nombre de la app en la interfaz ───────────────────────────────────

test("login, recuperar y crear contrasena muestran el nombre de la app bajo el logo", () => {
  const identity = read("src/components/common/brand-identity.jsx");
  assert.match(identity, /const appName = brand\.appName \|\| brandName;/);
  // En las dos variantes: logo cuadrado + texto (The Worx) y logo horizontal (HDG).
  assert.equal(identity.match(/\{appName\}/g).length, 2);
  // El logo sigue describiendose con la empresa.
  assert.match(identity, /accessibilityLabel=\{brandName\}/);
  for (const screen of ["src/app/login.jsx", "src/app/forgot-password.jsx", "src/app/set-password.jsx"]) {
    assert.match(read(screen), /<BrandIdentity centered/, screen);
  }
});

test("bienvenida, ajustes y bloqueo usan el nombre de la app", () => {
  assert.match(read("src/components/onboarding/onboarding-provider.jsx"), /brandName: brand\.appName \|\|/);
  assert.equal(buildWelcomeSlides({ plan: "BASIC", brandName: "My Worx Mail" })[0].title, "Welcome to My Worx Mail");
  assert.match(read("src/app/(client)/settings/index.jsx"), /\{ label: "App", value: brand\.appName \|\| brand\.name \}/);
  assert.match(read("src/components/common/biometric-gate.jsx"), /Unlock to open \$\{brand\.appName/);
});
