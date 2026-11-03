import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { privacyPolicyFor } from "../src/lib/legal-links.js";

/**
 * Settings → Legal → Privacy Policy: un enlace a la politica publica de la
 * organizacion del usuario. The Worx (sus tres centros) enlaza su politica
 * corporativa; HDG no hereda la de The Worx.
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const URL = "https://theworxoffices.com/privacy-policy";

test("The Worx tiene su politica corporativa; HDG y los desconocidos no heredan nada", () => {
  assert.deepEqual(privacyPolicyFor("the_worx"), { name: "The Worx Offices Privacy Policy", url: URL });
  assert.equal(privacyPolicyFor("The-Worx")?.url, URL);
  for (const slug of ["hdg", "", null, undefined, "otro", "__proto__", "constructor"]) {
    assert.equal(privacyPolicyFor(slug), null, String(slug));
  }
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
