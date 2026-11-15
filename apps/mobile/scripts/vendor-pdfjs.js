#!/usr/bin/env node
/**
 * Mete pdf.js DENTRO de la app (src/vendor/pdfjs/), en vez de cargarlo de un CDN.
 *
 * El visor de PDF (components/common/pdf-viewer) pinta los escaneos del cliente
 * con pdf.js en un WebView. Cargarlo de cdn.jsdelivr.net daba a un tercero la
 * ocasion de ejecutar codigo junto a un documento privado. Ahora va empaquetado
 * y el WebView no tiene red (lib/pdf-html: CSP sin conexiones).
 *
 *   node scripts/vendor-pdfjs.js
 *
 * Descarga pdfjs-dist@PDFJS_VERSION con `npm pack` (no lo instala ni ejecuta
 * nada), comprueba el SHA-256 de los dos ficheros contra los fijados aqui y
 * escribe src/vendor/pdfjs/pdfjs-<version>.js con su codigo en base64, mas la
 * licencia. Si un hash no coincide, no escribe nada.
 *
 * Base64 y no el texto tal cual: pdf.js trae unos pocos caracteres no ASCII y
 * Hermes guarda entonces la cadena entera en UTF-16 (el doble: 3,6 MB en vez de
 * 1,8). En base64 es ASCII: 2,4 MB. El visor lo decodifica dentro del WebView.
 *
 * Para cambiar de version: actualizar PDFJS_VERSION y los dos hashes (de un
 * paquete revisado), ejecutar el script y repasar el visor en iOS y Android.
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Buffer } = require("buffer");

const PDFJS_VERSION = "4.10.38";
// SHA-256 de legacy/build/*.min.mjs de pdfjs-dist@4.10.38 (npm registry).
const EXPECTED_SHA256 = {
  "pdf.min.mjs": "44ec6f011027ee77791386b66c14876a5fc29e20bf0433c07c6726fff7212b72",
  "pdf.worker.min.mjs": "bd88805178a26c729db8c0107a5b630cb900ec070f4d8c7529a3e45530afd41d",
};

// La carpeta de la app sale de su package.json (sin __dirname, como pide el lint).
const APP_DIR = path.dirname(require.resolve("../package.json"));
const OUT_DIR = path.join(APP_DIR, "src", "vendor", "pdfjs");
const OUT_FILE = path.join(OUT_DIR, `pdfjs-${PDFJS_VERSION}.js`);

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/**
 * Un literal de JS seguro dentro de un <script> del HTML del visor: JSON escapa
 * comillas y barras, y "</" se escribe "<\/" para que ningun "</script" lo cierre.
 */
function scriptSafeLiteral(text) {
  return JSON.stringify(text).replace(/<\//g, "<\\/");
}

/** UTF-8 -> base64 (solo A-Z a-z 0-9 + / =): nada que escapar en un <script>. */
function toBase64(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "pdfjs-vendor-"));
  try {
    const tarball = execFileSync("npm", ["pack", `pdfjs-dist@${PDFJS_VERSION}`, "--silent"], {
      cwd: work,
      encoding: "utf8",
      shell: process.platform === "win32",
    })
      .trim()
      .split(/\r?\n/)
      .pop();
    execFileSync("tar", ["-xzf", tarball], { cwd: work });

    const build = path.join(work, "package", "legacy", "build");
    const sources = {};
    for (const [name, expected] of Object.entries(EXPECTED_SHA256)) {
      const text = fs.readFileSync(path.join(build, name), "utf8");
      const actual = sha256(text);
      if (actual !== expected) throw new Error(`${name}: SHA-256 ${actual} no es el esperado ${expected}. No se escribe nada.`);
      sources[name] = text;
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      OUT_FILE,
      [
        "/* eslint-disable */",
        `// pdf.js ${PDFJS_VERSION} (pdfjs-dist, legacy/build). Generado por scripts/vendor-pdfjs.js: no editar a mano.`,
        "// Licencia: Apache-2.0 (LICENSE en esta carpeta).",
        `export const PDFJS_VERSION = ${JSON.stringify(PDFJS_VERSION)};`,
        `export const PDFJS_SHA256 = ${JSON.stringify(EXPECTED_SHA256)};`,
        `export const PDFJS_LIBRARY_BASE64 = ${JSON.stringify(toBase64(sources["pdf.min.mjs"]))};`,
        `export const PDFJS_WORKER_BASE64 = ${JSON.stringify(toBase64(sources["pdf.worker.min.mjs"]))};`,
        "",
      ].join("\n")
    );
    fs.copyFileSync(path.join(work, "package", "LICENSE"), path.join(OUT_DIR, "LICENSE"));
    process.stdout.write(`Escrito ${path.relative(process.cwd(), OUT_FILE)} (pdf.js ${PDFJS_VERSION}, hashes verificados).\n`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exit(1);
  }
}

module.exports = { EXPECTED_SHA256, PDFJS_VERSION, scriptSafeLiteral, sha256, toBase64 };
