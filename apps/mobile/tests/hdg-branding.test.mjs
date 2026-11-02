import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { BRANDS } = require("../brands");

/** Ancho, alto y tipo de color de un PNG (cabecera IHDR). 2 = RGB, 6 = RGBA. */
function pngInfo(rel) {
  const buffer = fs.readFileSync(path.join(root, rel));
  assert.equal(buffer.toString("ascii", 1, 4), "PNG", rel);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer[25] };
}

/** La config de Tailwind tal como la evalua el build de una marca. */
function tailwindColors(brandId) {
  const previous = process.env.APP_BRAND;
  process.env.APP_BRAND = brandId;
  for (const mod of ["../tailwind.config.js", "../brands"]) delete require.cache[require.resolve(mod)];
  try {
    return require("../tailwind.config.js").theme.extend.colors;
  } finally {
    if (previous === undefined) delete process.env.APP_BRAND;
    else process.env.APP_BRAND = previous;
    for (const mod of ["../tailwind.config.js", "../brands"]) delete require.cache[require.resolve(mod)];
  }
}

test("HDG: iconos nuevos de 1024 y el de iOS sin canal alfa", () => {
  for (const file of ["icon.png", "adaptive-icon.png", "monochrome-icon.png", "generated/icon.png"]) {
    const info = pngInfo("assets/brands/hdg/" + file);
    assert.equal(info.width, 1024, file);
    assert.equal(info.height, 1024, file);
  }
  // App Store rechaza el icono con canal alfa aunque sea opaco.
  assert.equal(pngInfo("assets/brands/hdg/icon.png").colorType, 2);
  // El tematico de Android necesita transparencia para ser una silueta.
  assert.equal(pngInfo("assets/brands/hdg/monochrome-icon.png").colorType, 6);
  // El original aprobado se conserva junto a lo que sale de el.
  assert.ok(fs.existsSync(path.join(root, "assets/brands/hdg/icon.jpg")));
});

test("HDG: el logo sobre blanco no deja recuadros de otro color", () => {
  const hdg = BRANDS.hdg;
  assert.equal(hdg.androidIconBackground, "#FFFFFF");
  assert.equal(hdg.markBackground, "#FFFFFF");
  assert.equal(hdg.splashBackground, "#FFFFFF");
});

test("HDG: paleta definitiva como tokens", () => {
  const { primaryColor, palette } = BRANDS.hdg;
  assert.equal(primaryColor, "#2F4157"); // primary / buttonPrimary
  assert.equal(palette.ink, "#2F4157"); // textPrimary
  assert.equal(palette.glyph, "#577C8E"); // secondary / link
  assert.equal(palette.mutedForeground, "#577C8E"); // textSecondary
  assert.equal(palette.tint, "#C7D9E5"); // accent
  assert.equal(palette.border, "#C7D9E5"); // border
  assert.equal(palette.canvas, "#F4EFEB"); // background
  assert.equal(palette.onPrimary, "#FFFFFF"); // buttonText
  // Exito sigue siendo el verde funcional, no azul de marca.
  assert.equal(palette.success, "#00A887");

  const colors = tailwindColors("hdg");
  assert.equal(colors.border, "#C7D9E5");
  assert.equal(colors.muted.foreground, "#577C8E");
  assert.equal(colors.foreground, "#2F4157");
  assert.equal(colors.background, "#F4EFEB");
  assert.equal(colors.primary.DEFAULT, "#2F4157");
  assert.equal(colors.card.DEFAULT, "#FFFFFF");
});

test("The Worx no cambia: sin colores de HDG y sus tokens derivados de siempre", () => {
  const worx = BRANDS.the_worx;
  assert.equal(worx.palette.border, undefined);
  assert.equal(worx.palette.mutedForeground, undefined);
  const colors = tailwindColors("the_worx");
  assert.equal(colors.primary.DEFAULT, "#65baaf");
  assert.equal(colors.foreground, "#2D2A26");
  assert.equal(colors.border.toLowerCase(), "#eaeae9");
  assert.equal(colors.muted.foreground.toLowerCase(), "#7d7b78");
  const hdgValues = ["#2f4157", "#577c8e", "#c7d9e5", "#f4efeb"];
  const flat = JSON.stringify(colors).toLowerCase();
  for (const value of hdgValues) assert.ok(!flat.includes(value), value);
});

test("ningun componente lleva colores de HDG escritos a mano", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(jsx?|tsx?)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, "src"));
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /#(2F4157|577C8E|C7D9E5|F4EFEB)\b/i, file);
  }
});
