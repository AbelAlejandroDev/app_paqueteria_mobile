/**
 * Convierte el texto de una notificacion en bloques pintables.
 *
 * Se interpreta el mismo formato de texto plano que el backend ya usa para el
 * correo de esas notificaciones: parrafos separados por una linea en blanco y
 * viñetas con "- ". Asi no hace falta inventar un formato nuevo ni que el
 * backend mande HTML, que no se puede pintar de forma segura en la app.
 *
 * Nunca se ejecuta ni se interpreta nada del texto: solo se decide si una linea
 * es parrafo, viñeta o titulo, y que partes son enlaces.
 */

const BULLET = /^\s*[-*•]\s+/;
// Solo http y https. Cualquier otro esquema --javascript:, intent:, file:--
// queda como texto y no se puede tocar.
const URL = /(https?:\/\/[^\s<>"']+)/g;

/** Longitud maxima de una linea para tratarla como titulo de seccion. */
const HEADING_MAX_LENGTH = 60;

/**
 * Una linea suelta, corta, sin puntuacion final y sin enlace es un titulo.
 *
 * Se reconoce por su forma y no por su texto, para no atar la app a las
 * palabras de una plantilla concreta: "✔ Your Virtual Office Includes" es
 * titulo, pero "Dear Ana," (acaba en coma) o "Warm regards,\nThe Worx Offices"
 * (dos lineas) no lo son.
 */
function isHeading(block, isLast) {
  if (isLast || block.kind !== "paragraph") return false;
  const text = block.text;
  if (text.includes("\n") || text.length > HEADING_MAX_LENGTH) return false;
  if (/https?:\/\//i.test(text)) return false;
  return !/[.,;:!?]$/.test(text);
}

export function toBlocks(text) {
  const blocks = [];
  let paragraph = [];
  let bullets = [];

  // Las lineas seguidas se juntan con salto de linea y no con espacio: el
  // backend manda texto con saltos intencionados ("Warm regards," y la firma
  // debajo), y aplanarlos cambiaria lo que escribio.
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushBullets = () => {
    if (bullets.length) blocks.push({ kind: "bullets", items: bullets });
    bullets = [];
  };

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();

    if (!line) {
      flushParagraph();
      flushBullets();
      continue;
    }

    if (BULLET.test(line)) {
      flushParagraph();
      bullets.push(line.replace(BULLET, ""));
      continue;
    }

    flushBullets();
    paragraph.push(line);
  }

  flushParagraph();
  flushBullets();

  return blocks.map((block, index) =>
    isHeading(block, index === blocks.length - 1) ? { kind: "heading", text: block.text } : block
  );
}

/**
 * Parte un texto en trozos normales y enlaces.
 *
 * El signo final de una frase no forma parte del enlace: "visit https://x.com."
 * debe abrir https://x.com, no https://x.com. con el punto.
 */
export function toSegments(text) {
  const segments = [];
  let last = 0;

  for (const match of String(text || "").matchAll(URL)) {
    let url = match[0];
    const trailing = url.match(/[.,;:!?)]+$/)?.[0] || "";
    if (trailing) url = url.slice(0, -trailing.length);

    if (match.index > last) segments.push({ kind: "text", text: text.slice(last, match.index) });
    segments.push({ kind: "link", url });
    last = match.index + url.length;
  }

  if (last < String(text || "").length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

export function isSafeUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

/** "PREMIUM" -> "Premium". Sin plan, nada: no se deduce de otro sitio. */
export function planLabel(data) {
  const raw = data?.planName || data?.planCode;
  if (!raw) return null;
  const text = String(raw).toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
