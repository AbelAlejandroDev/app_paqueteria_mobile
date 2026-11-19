import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

/** Las entradas "marca:centro" -> archivo de CENTER_HEROES. */
function centerHeroes() {
  const source = read("src/lib/brand-assets.js");
  const block = source.slice(source.indexOf("const CENTER_HEROES"), source.indexOf("};", source.indexOf("const CENTER_HEROES")));
  return [...block.matchAll(/"([a-z_]+):([a-z0-9-]+)": require\("\.\.\/\.\.\/(assets\/[^"]+)"\)/g)].map((m) => ({
    brand: m[1],
    center: m[2],
    file: m[3],
  }));
}

test("cada foto de centro existe y va en la carpeta de su marca", () => {
  const heroes = centerHeroes();
  assert.ok(heroes.length > 0);
  for (const hero of heroes) {
    assert.ok(fs.existsSync(path.join(root, hero.file)), hero.file);
    assert.ok(hero.file.startsWith(`assets/brands/${hero.brand}/`), hero.file);
  }
});

test("Hallandale y Sandlake tienen cada uno su foto; la general de la marca ya no existe", () => {
  const heroes = centerHeroes();
  const fileOf = (center) => heroes.find((h) => h.brand === "the_worx" && h.center === center)?.file;
  assert.equal(fileOf("hallandale"), "assets/brands/the_worx/hallandale-hero.jpg");
  assert.equal(fileOf("sandlake"), "assets/brands/the_worx/sandlake-hero.jpg");
  assert.equal(fs.existsSync(path.join(root, "assets/brands/the_worx/home-hero.jpg")), false);
});

/** Ancho y alto de un JPEG (marcador SOF0..SOF15 salvo DHT/JPG/DAC), o null. */
function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

test("HDG Hollywood tiene su foto, en la carpeta de HDG y solo para el centro hollywood", () => {
  const heroes = centerHeroes();
  const hdg = heroes.filter((h) => h.brand === "hdg");
  assert.deepEqual(hdg, [{ brand: "hdg", center: "hollywood", file: "assets/brands/hdg/hollywood-hero.jpg" }]);
  // La foto de Hollywood no la usa ningun centro de otra marca.
  for (const hero of heroes.filter((h) => h.brand !== "hdg")) {
    assert.doesNotMatch(hero.file, /hollywood/, hero.file);
  }
});

test("la foto de Hollywood es el JPG original del portal web (1200x801, ligero)", () => {
  const buffer = fs.readFileSync(path.join(root, "assets/brands/hdg/hollywood-hero.jpg"));
  assert.deepEqual(jpegSize(buffer), { width: 1200, height: 801 });
  assert.ok(buffer.length < 200 * 1024, `${buffer.length} bytes`);
  // El mismo fichero que front-web public/center-images/hollywood-hero.jpg (blob de git).
  const blob = crypto.createHash("sha1").update(`blob ${buffer.length}\0`).update(buffer).digest("hex");
  assert.equal(blob, "9179ccb80e562cd7ee4ab52ca6f6e3ba16bd9525");
});

test("la foto exige una sesion de la organizacion de la app", () => {
  const source = read("src/lib/brand-assets.js");
  assert.match(source, /import \{ isSessionForTenant \} from "@\/lib\/session-tenant"/);
  assert.match(source, /isSessionForTenant\(user, brand\.tenantSlug\)/);
});

test("el panel y la bienvenida eligen la foto por el centro del cliente", () => {
  assert.match(read("src/lib/brand-assets.js"), /user\?\.center\?\.slug/);
  assert.match(read("src/app/(client)/dashboard.jsx"), /hero=\{homeHeroFor\(user\)\}/);
  assert.match(read("src/components/onboarding/welcome-onboarding.jsx"), /hero=\{homeHeroFor\(user\)\}/);
  for (const file of ["src/app/(client)/dashboard.jsx", "src/components/onboarding/welcome-onboarding.jsx"]) {
    assert.doesNotMatch(read(file), /brandHomeHero/, file);
  }
});
