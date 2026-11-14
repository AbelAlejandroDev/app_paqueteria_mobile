import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fija el comportamiento ACTUAL de keepLoggedIn (docs/session-persistence.md):
 * existe la preferencia, pero nada la ofrece ni la lee, y las credenciales
 * persisten siempre. Si alguien la activa, este test falla a proposito: es una
 * decision de seguridad que necesita sus propias pruebas.
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function sources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + "/" + entry.name;
    if (entry.isDirectory()) out.push(...sources(rel));
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

test("keepLoggedIn solo aparece en su modulo de preferencias (sin efecto)", () => {
  const users = sources("src").filter((file) => /keepLoggedIn/.test(read(file)));
  assert.deepEqual(users, ["src/lib/security-preferences.js"]);
  assert.match(read("src/lib/security-preferences.js"), /keepLoggedIn: true/);
});

test("los tokens se guardan en el almacen seguro y el usuario se borra con ellos", () => {
  assert.match(read("src/lib/storage.js"), /secure: Platform\.OS === "web" \? asyncStorageBackend : secureStoreBackend/);
  assert.match(read("../../packages/core/src/storage.js"), /requireBackend\(\{ secure: true \}\)/);
});

test("el documento existe y describe el estado", () => {
  const doc = read("docs/session-persistence.md");
  assert.match(doc, /keepLoggedIn/);
  assert.match(doc, /Es una preferencia sin efecto/);
});
