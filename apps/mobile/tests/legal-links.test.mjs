import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { privacyPolicyFor } from "../src/lib/legal-links.js";

/**
 * Settings → Legal → Privacy Policy: un enlace a la politica publica de la
 * organizacion del usuario. The Worx (sus tres centros) enlaza su politica
 * corporativa; HDG la suya, y ninguna hereda la de la otra.
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const URL = "https://theworxoffices.com/privacy-policy";

test("cada organizacion tiene la suya; los desconocidos no heredan nada", () => {
  assert.deepEqual(privacyPolicyFor("the_worx"), { name: "The Worx Offices Privacy Policy", url: URL });
  assert.equal(privacyPolicyFor("The-Worx")?.url, URL);
  assert.deepEqual(privacyPolicyFor("hdg"), {
    name: "HDG Executive Suites Privacy Policy",
    url: "https://www.hdgexecutivesuites.com/privacy-policy/",
  });
  assert.equal(privacyPolicyFor("HDG")?.url, "https://www.hdgexecutivesuites.com/privacy-policy/");
  // Aislamiento: ninguna enlaza la web de la otra.
  assert.doesNotMatch(privacyPolicyFor("hdg").url, /theworx/);
  assert.doesNotMatch(privacyPolicyFor("the_worx").url, /hdgexecutivesuites/);
  for (const slug of ["", null, undefined, "otro", "__proto__", "constructor"]) {
    assert.equal(privacyPolicyFor(slug), null, String(slug));
  }
});

test("las politicas son https sin credenciales (lo que la app abre en el navegador)", async () => {
  const { isSecureHttpsUrl } = await import("../src/lib/secure-url.js");
  for (const slug of ["the_worx", "hdg"]) assert.equal(isSecureHttpsUrl(privacyPolicyFor(slug).url), true, slug);
});

test("Settings tiene Legal con Privacy Policy, por la organizacion del usuario y no por la marca", () => {
  const settings = read("src/app/(client)/settings/index.jsx");
  assert.match(settings, />Legal</);
  assert.match(settings, /const privacyPolicy = privacyPolicyFor\(user\?\.tenant\?\.slug\);/);
  assert.match(settings, /\{privacyPolicy \? \(/, "sin politica no hay seccion");
  assert.match(settings, /label="Privacy Policy"/);
  assert.doesNotMatch(settings, /privacyPolicyFor\(brand/);
});

test("se abre fuera de la app con el mismo patron que Conference Room, y nada se pide al servidor", () => {
  const settings = read("src/app/(client)/settings/index.jsx");
  assert.match(settings, /onPress=\{\(\) => WebBrowser\.openBrowserAsync\(privacyPolicy\.url\)\}/);
  assert.match(settings, /\{external \? <ExternalLink/);
  const lib = read("src/lib/legal-links.js");
  assert.doesNotMatch(lib, /api\.|fetch\(|wp-json/);
});

test("Terms & Conditions sigue donde estaba", () => {
  const settings = read("src/app/(client)/settings/index.jsx");
  assert.match(settings, /\{ label: "Terms & Conditions", href: "\/settings\/terms", icon: FileText \}/);
});
