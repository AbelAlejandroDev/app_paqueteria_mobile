import test from "node:test";
import assert from "node:assert/strict";
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

test("el panel y la bienvenida eligen la foto por el centro del cliente", () => {
  assert.match(read("src/lib/brand-assets.js"), /user\?\.center\?\.slug/);
  assert.match(read("src/app/(client)/dashboard.jsx"), /hero=\{homeHeroFor\(user\)\}/);
  assert.match(read("src/components/onboarding/welcome-onboarding.jsx"), /hero=\{homeHeroFor\(user\)\}/);
  for (const file of ["src/app/(client)/dashboard.jsx", "src/components/onboarding/welcome-onboarding.jsx"]) {
    assert.doesNotMatch(read(file), /brandHomeHero/, file);
  }
});
