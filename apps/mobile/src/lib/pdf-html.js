/**
 * La pagina que pinta un PDF dentro del WebView. Sin React, para probarla.
 *
 * pdf.js va DENTRO de la app (src/vendor/pdfjs, scripts/vendor-pdfjs.js): sus dos
 * ficheros viajan en base64 en la pagina, se decodifican (UTF-8) y se cargan como
 * modulos desde blob: URLs creadas en el propio WebView. Nada se pide a la red:
 *
 *   - Content-Security-Policy sin ninguna conexion: default-src 'none'; solo
 *     scripts en linea y blob:, workers blob:, imagenes/fuentes data: y blob:.
 *   - Origen ficticio en `.invalid` (RFC 2606: nunca resuelve), solo para que
 *     los blob: sean del mismo origen que la pagina.
 *   - isEvalSupported: false (pdf.js no genera codigo a partir del PDF).
 *   - El WebView ademas bloquea cualquier navegacion fuera de este origen
 *     (components/common/pdf-viewer).
 *
 * El PDF ya esta descargado y en cache (descarga autenticada por URL firmada,
 * borrado al cambiar de cuenta: lib/private-files); llega en base64.
 */

export const PDF_VIEWER_ORIGIN = "https://pdf-viewer.invalid";

export const PDF_VIEWER_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  "worker-src blob:",
  "connect-src blob: data:",
  "img-src blob: data:",
  "font-src blob: data:",
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Un literal de JS que ningun "</script" puede cerrar dentro del HTML. */
function scriptSafe(value) {
  return JSON.stringify(String(value)).replace(/<\//g, "<\\/");
}

/** Solo base64 estandar: el PDF no puede inyectar nada en la pagina. */
export function isBase64(value) {
  return typeof value === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

/** Color CSS conocido: un hex de 3/6/8 digitos. Cualquier otra cosa, blanco. */
function safeColor(value) {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?$/.test(String(value || "")) ? value : "#ffffff";
}

/**
 * @param {object} options
 * @param {string} options.base64 - el PDF
 * @param {boolean} [options.thumbnail] - solo la primera pagina, sin margen
 * @param {string} [options.background] - color de fondo (#hex)
 * @param {string} options.libraryBase64 - pdf.min.mjs en base64 (vendor)
 * @param {string} options.workerBase64 - pdf.worker.min.mjs en base64 (vendor)
 */
export function buildPdfHtml({ base64, thumbnail = false, background, libraryBase64, workerBase64 }) {
  if (!isBase64(base64)) throw new Error("El PDF no es base64 valido.");
  if (!libraryBase64 || !workerBase64) throw new Error("Falta pdf.js empaquetado.");
  if (!isBase64(libraryBase64) || !isBase64(workerBase64)) throw new Error("pdf.js empaquetado no es base64 valido.");

  // En miniatura solo la primera pagina, sin margen ni desplazamiento: es una
  // vista previa, el toque lo recoge la tarjeta.
  const padding = thumbnail ? 0 : 12;
  const bg = safeColor(background);

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PDF_VIEWER_CSP}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=${thumbnail ? "no" : "yes"}">
<style>
  html, body { margin: 0; padding: 0; background: ${bg}; ${thumbnail ? "overflow: hidden;" : ""} }
  #pages { padding: ${padding}px; }
  canvas { display: block; width: 100%; max-width: 100%; height: auto; margin-bottom: ${thumbnail ? 0 : 12}px; background: #fff; ${thumbnail ? "" : "border-radius: 4px;"} }
</style>
</head><body>
<div id="pages"></div>
<script>
  window.PDF_BASE64 = ${scriptSafe(base64)};
  window.PDFJS_LIBRARY_BASE64 = ${scriptSafe(libraryBase64)};
  window.PDFJS_WORKER_BASE64 = ${scriptSafe(workerBase64)};
</script>
<script type="module">
  const send = (message) => window.ReactNativeWebView.postMessage(JSON.stringify(message));
  const bytesOf = (b64) => {
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };
  // Los bytes UTF-8 tal cual: el Blob los guarda sin volver a codificarlos.
  const moduleUrl = (b64) => URL.createObjectURL(new Blob([bytesOf(b64)], { type: "text/javascript;charset=utf-8" }));
  try {
    const pdfjs = await import(moduleUrl(window.PDFJS_LIBRARY_BASE64));
    pdfjs.GlobalWorkerOptions.workerSrc = moduleUrl(window.PDFJS_WORKER_BASE64);
    // Ya no hacen falta: menos memoria con PDFs largos.
    window.PDFJS_LIBRARY_BASE64 = null;
    window.PDFJS_WORKER_BASE64 = null;

    const bytes = bytesOf(window.PDF_BASE64);
    window.PDF_BASE64 = null;

    const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const container = document.getElementById("pages");
    const width = container.clientWidth - ${padding * 2};
    const ratio = window.devicePixelRatio || 1;
    const count = ${thumbnail ? 1 : "doc.numPages"};

    for (let number = 1; number <= count; number++) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      container.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      if (number === 1) send({ type: "ready", pages: doc.numPages });
    }
  } catch (error) {
    send({ type: "error", message: String((error && error.message) || error) });
  }
</script>
</body></html>`;
}

/**
 * Que navegaciones deja hacer el WebView del visor: solo su propia pagina
 * (el origen ficticio), about:blank y blob:/data:. Un enlace dentro del PDF o
 * cualquier otra cosa no sale del visor.
 */
export function isAllowedPdfViewerNavigation(url) {
  const value = String(url || "");
  if (value === "about:blank" || value.startsWith("about:srcdoc")) return true;
  if (value.startsWith("blob:") || value.startsWith("data:")) return true;
  return value === PDF_VIEWER_ORIGIN || value.startsWith(PDF_VIEWER_ORIGIN + "/");
}
