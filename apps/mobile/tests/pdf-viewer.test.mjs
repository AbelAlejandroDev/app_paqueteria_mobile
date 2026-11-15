import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildPdfHtml, isAllowedPdfViewerNavigation, isBase64, PDF_VIEWER_CSP, PDF_VIEWER_ORIGIN } from "../src/lib/pdf-html.js";
import { PDFJS_LIBRARY_BASE64, PDFJS_SHA256, PDFJS_VERSION, PDFJS_WORKER_BASE64 } from "../src/vendor/pdfjs/pdfjs-4.10.38.js";

// Lo que de verdad corre en el WebView: el base64 decodificado como UTF-8.
const PDFJS_LIBRARY_SOURCE = Buffer.from(PDFJS_LIBRARY_BASE64, "base64").toString("utf8");
const PDFJS_WORKER_SOURCE = Buffer.from(PDFJS_WORKER_BASE64, "base64").toString("utf8");

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const { EXPECTED_SHA256, scriptSafeLiteral } = require("../scripts/vendor-pdfjs.js");
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** Un PDF de una pagina, hecho a mano (pdf.js reconstruye la tabla xref si hace falta). */
function tinyPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>",
    "<< /Length 21 >>\nstream\n0 0 1 rg 10 10 50 50 re f\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

// ── pdf.js empaquetado: el que se reviso, sin tocar ─────────────────────────

test("pdf.js va en base64 (ASCII: Hermes no lo duplica en UTF-16)", () => {
  assert.match(PDFJS_LIBRARY_BASE64, /^[A-Za-z0-9+/]+=*$/);
  assert.match(PDFJS_WORKER_BASE64, /^[A-Za-z0-9+/]+=*$/);
  assert.match(read("src/components/common/pdf-viewer.jsx"), /libraryBase64: PDFJS_LIBRARY_BASE64, workerBase64: PDFJS_WORKER_BASE64/);
});

test("pdf.js va empaquetado, con la version y los hashes fijados por el script", () => {
  assert.equal(PDFJS_VERSION, "4.10.38");
  assert.deepEqual(PDFJS_SHA256, EXPECTED_SHA256);
  assert.equal(sha256(PDFJS_LIBRARY_SOURCE), EXPECTED_SHA256["pdf.min.mjs"]);
  assert.equal(sha256(PDFJS_WORKER_SOURCE), EXPECTED_SHA256["pdf.worker.min.mjs"]);
  assert.ok(fs.existsSync(path.join(root, "src/vendor/pdfjs/LICENSE")), "licencia Apache-2.0 junto al codigo");
});

test("el pdf.js empaquetado funciona: abre y pinta un PDF real (Node)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfjs-test-"));
  try {
    const lib = path.join(dir, "pdf.min.mjs");
    const worker = path.join(dir, "pdf.worker.min.mjs");
    fs.writeFileSync(lib, PDFJS_LIBRARY_SOURCE);
    fs.writeFileSync(worker, PDFJS_WORKER_SOURCE);
    const pdfjs = await import(pathToFileURL(lib).href);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(tinyPdf()), isEvalSupported: false, useSystemFonts: false }).promise;
    assert.equal(doc.numPages, 1);
    const page = await doc.getPage(1);
    assert.deepEqual(page.view, [0, 0, 200, 100]);
    const ops = await page.getOperatorList();
    assert.ok(ops.fnArray.length > 0, "la pagina tiene operaciones de dibujo");
    await doc.destroy();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── La pagina del visor: sin red ────────────────────────────────────────────

const html = (over = {}) =>
  buildPdfHtml({ base64: tinyPdf().toString("base64"), background: "#1F1E1C", libraryBase64: PDFJS_LIBRARY_BASE64, workerBase64: PDFJS_WORKER_BASE64, ...over });

test("ningun CDN ni URL de red: pdf.js se carga desde blob: dentro del WebView", () => {
  const page = html();
  assert.doesNotMatch(page, /cdn\.jsdelivr|unpkg|cdnjs/);
  assert.doesNotMatch(page, /<script[^>]+src=/, "ningun script externo");
  assert.match(page, /await import\(moduleUrl\(window\.PDFJS_LIBRARY_BASE64\)\)/);
  assert.match(page, /GlobalWorkerOptions\.workerSrc = moduleUrl\(window\.PDFJS_WORKER_BASE64\)/);
  assert.match(page, /getDocument\(\{ data: bytes, isEvalSupported: false \}\)/);
  for (const file of ["src/components/common/pdf-viewer.jsx", "src/lib/pdf-html.js"]) {
    assert.doesNotMatch(read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /cdn\.jsdelivr|https:\/\/(?!pdf-viewer\.invalid)/, file);
  }
});

test("Content-Security-Policy sin conexiones a la red", () => {
  const page = html();
  assert.ok(page.includes(`<meta http-equiv="Content-Security-Policy" content="${PDF_VIEWER_CSP}">`));
  assert.match(PDF_VIEWER_CSP, /^default-src 'none'/);
  assert.match(PDF_VIEWER_CSP, /connect-src blob: data:/);
  assert.doesNotMatch(PDF_VIEWER_CSP, /https?:|\*/);
  assert.equal(PDF_VIEWER_ORIGIN, "https://pdf-viewer.invalid", "TLD .invalid: nunca resuelve");
});

test("lo inyectado no puede cerrar el <script>: solo dos scripts en la pagina", () => {
  const page = html();
  assert.equal(page.split("</script>").length - 1, 2);
  assert.equal(scriptSafeLiteral("a</script>b"), '"a<\\/script>b"');
});

test("el PDF tiene que ser base64, y el color de fondo un hex", () => {
  assert.equal(isBase64("JVBERi0xLjQK"), true);
  assert.equal(isBase64('";alert(1);//'), false);
  assert.throws(() => html({ base64: "</script><script>alert(1)</script>" }), /base64/);
  assert.match(html({ background: "red;}</style><script>x()</script>" }), /background: #ffffff;/);
  assert.throws(() => buildPdfHtml({ base64: "AAAA", libraryBase64: "", workerBase64: "" }), /pdf\.js empaquetado/);
  assert.throws(() => buildPdfHtml({ base64: "AAAA", libraryBase64: "</script>", workerBase64: "AAAA" }), /no es base64/);
});

test("miniatura: solo la primera pagina, sin zoom", () => {
  const thumb = html({ thumbnail: true });
  assert.match(thumb, /const count = 1;/);
  assert.match(thumb, /user-scalable=no/);
  assert.match(html(), /const count = doc\.numPages;/);
});

test("navegacion del WebView: solo su pagina, about:blank, blob: y data:", () => {
  for (const ok of [PDF_VIEWER_ORIGIN, PDF_VIEWER_ORIGIN + "/", "about:blank", "blob:https://pdf-viewer.invalid/1", "data:application/pdf;base64,AA"]) {
    assert.equal(isAllowedPdfViewerNavigation(ok), true, ok);
  }
  for (const bad of ["https://evil.example/", "https://pdf-viewer.invalid.evil.com/", "http://localhost", "file:///etc/passwd", "javascript:alert(1)", ""]) {
    assert.equal(isAllowedPdfViewerNavigation(bad), false, bad);
  }
});

// ── El componente ───────────────────────────────────────────────────────────

test("el WebView: origen ficticio, sin navegar fuera, sin ficheros, sin cache ni ventanas", () => {
  const viewer = read("src/components/common/pdf-viewer.jsx");
  assert.match(viewer, /source=\{\{ html, baseUrl: PDF_VIEWER_ORIGIN \}\}/);
  assert.match(viewer, /onShouldStartLoadWithRequest=\{\(request\) => isAllowedPdfViewerNavigation\(request\.url\)\}/);
  for (const prop of [
    "javaScriptCanOpenWindowsAutomatically={false}",
    "setSupportMultipleWindows={false}",
    "allowFileAccess={false}",
    "allowFileAccessFromFileURLs={false}",
    "allowUniversalAccessFromFileURLs={false}",
    'mixedContentMode="never"',
    "cacheEnabled={false}",
    "incognito",
  ]) {
    assert.ok(viewer.includes(prop), prop);
  }
  assert.doesNotMatch(viewer, /originWhitelist=\{\["\*"\]\}/);
  assert.match(viewer, /useMemo\(\s*\(\) => buildPdfHtml\(/, "la pagina se arma una vez por documento");
});

test("descarga autenticada por URL firmada y cache privada (se borra al cambiar de cuenta)", () => {
  const viewer = read("src/components/common/pdf-viewer.jsx");
  assert.match(viewer, /const url = media\?\.signedUrl \|\| media\?\.url \|\| "";/);
  assert.match(viewer, /File\.downloadFileAsync\(url, partial, \{ idempotent: true \}\)/);
  assert.match(viewer, /new Directory\(Paths\.cache, PDF_CACHE_DIRECTORY\)/);
  // La copia para compartir tambien vive dentro de la carpeta que se borra.
  assert.match(viewer, /new Directory\(Paths\.cache, PDF_CACHE_DIRECTORY, "share"\)/);
  assert.doesNotMatch(viewer, /new File\(Paths\.cache, fileName\)/);
});
