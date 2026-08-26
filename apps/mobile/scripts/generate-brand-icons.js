/**
 * Genera los iconos de app a partir de los originales de cada marca.
 *
 *   npm run icons
 *
 * Existe porque los originales no sirven tal cual:
 *
 *   - iOS rechaza los iconos con transparencia, y el de HDG la tiene.
 *   - Las tiendas piden 1024x1024; los originales vienen a 500-512.
 *   - Los .webp no valen como icono de app: Expo y EAS exigen PNG.
 *
 * Usa jimp (JavaScript puro) en vez de sharp a propósito: sharp carga un
 * binario nativo y el Control de aplicaciones de Windows lo bloquea.
 *
 * La salida va a assets/brands/<id>/generated/ y se versiona, para que un
 * build de EAS no dependa de ejecutar esto antes.
 */

const fs = require("fs");
const path = require("path");
const { Jimp, intToRGBA, rgbaToInt } = require("jimp");

const { BRANDS } = require("../brands");

const ICON_SIZE = 1024;
const MARK_SIZE = 256;
const BRANDS_DIR = path.join(__dirname, "..", "assets", "brands");

function hexToRgb(hex) {
  const value = String(hex).replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

async function generate(brand) {
  const brandDir = path.join(BRANDS_DIR, brand.id);
  const markPath = path.join(brandDir, brand.assets.mark);

  if (!fs.existsSync(markPath)) {
    throw new Error(`Falta el mark de ${brand.id}: ${markPath}`);
  }

  const mark = await Jimp.read(markPath);

  // Si la esquina del original es opaca, el mark ya trae su propio fondo: se
  // reutiliza ese color exacto para que el splash no muestre un cuadrado
  // recortado contra un tono ligeramente distinto.
  const corner = intToRGBA(mark.getPixelColor(0, 0));
  const detected = corner.a >= 250;
  const background = detected ? toHex(corner) : brand.markBackground;

  const { r, g, b } = hexToRgb(background);
  const canvas = new Jimp({ width: ICON_SIZE, height: ICON_SIZE, color: rgbaToInt(r, g, b, 255) });

  const resized = mark.clone().contain({ w: ICON_SIZE, h: ICON_SIZE });
  canvas.composite(resized, 0, 0);

  const outDir = path.join(brandDir, "generated");
  fs.mkdirSync(outDir, { recursive: true });
  await canvas.write(path.join(outDir, "icon.png"));

  // Versión pequeña para el distintivo de la cabecera: el icono de 1024 pesa
  // de más para mostrarlo a 48 puntos.
  await canvas.clone().resize({ w: MARK_SIZE, h: MARK_SIZE }).write(path.join(outDir, "mark.png"));

  return { brand: brand.id, background, detected, source: brand.assets.mark };
}

(async () => {
  for (const brand of Object.values(BRANDS)) {
    const result = await generate(brand);
    console.log(
      `${result.brand.padEnd(10)} ${ICON_SIZE}x${ICON_SIZE}  fondo ${result.background} ` +
        `(${result.detected ? "detectado del original" : "de markBackground"})  <- ${result.source}`
    );
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
