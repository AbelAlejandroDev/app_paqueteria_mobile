/**
 * Leer el Fee Schedule en un telefono, sin React.
 *
 * El centro lo escribe en texto plano y alinea las columnas con espacios
 * ("Mail Scanning          $5 + $.50 per page"). Con la fuente del telefono esos
 * espacios no alinean nada. Aqui se reconoce la forma de cada linea y la
 * pantalla la pinta como fila de dos columnas, titulo o vineta. El texto no se
 * cambia: solo se decide como se ve cada linea.
 */

// Dos o mas espacios (o un tabulador) separan las columnas de una fila.
const COLUMN_GAP = /\s{2,}|\t+/;

function isSectionHeading(line) {
  // "1. Monthly Membership Fees", "10. Taxes": numero, punto y texto corto sin columnas.
  return /^\d{1,2}\.\s+\S/.test(line) && !COLUMN_GAP.test(line.trim()) && line.length <= 80;
}

/**
 * Convierte el texto en bloques:
 * - { kind: "heading", text }       "1. Monthly Membership Fees"
 * - { kind: "columnsHeader", left, right }  "Service   Fee"
 * - { kind: "row", left, right }    "Basic Virtual Office Membership   $59.00 / month"
 * - { kind: "bullet", text }        "• One (1) scheduled mail forwarding..."
 * - { kind: "text", text }          el resto, tal cual
 * - { kind: "space" }               una o varias lineas en blanco
 */
export function feeScheduleBlocks(content) {
  const blocks = [];
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      if (blocks.length && blocks[blocks.length - 1].kind !== "space") blocks.push({ kind: "space" });
      continue;
    }

    if (isSectionHeading(line)) {
      blocks.push({ kind: "heading", text: line });
      continue;
    }

    const bullet = line.match(/^[•*-]\s+(.*)$/);
    if (bullet) {
      blocks.push({ kind: "bullet", text: bullet[1] });
      continue;
    }

    const parts = line.split(COLUMN_GAP).filter(Boolean);
    if (parts.length >= 2) {
      const left = parts[0];
      const right = parts.slice(1).join(" ");
      const header = left.toLowerCase() === "service" && right.toLowerCase() === "fee";
      blocks.push(header ? { kind: "columnsHeader", left, right } : { kind: "row", left, right });
      continue;
    }

    blocks.push({ kind: "text", text: line });
  }

  // Sin huecos al principio ni al final.
  while (blocks[0]?.kind === "space") blocks.shift();
  while (blocks[blocks.length - 1]?.kind === "space") blocks.pop();
  return blocks;
}
