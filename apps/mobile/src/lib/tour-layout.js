/**
 * Donde va el resaltado y la tarjeta del recorrido. Sin React, para probarlo.
 *
 * Todo se calcula a partir de la medida real del elemento y del tamaño de la
 * ventana: no hay posiciones fijas para un modelo de telefono.
 */

/** Margen alrededor del elemento resaltado, para que no quede pegado al borde. */
export const HIGHLIGHT_PADDING = 8;

/** El hueco resaltado: el elemento con margen, recortado a la pantalla. */
export function highlightRect(target, window, padding = HIGHLIGHT_PADDING) {
  if (!target) return null;

  const x = Math.max(0, target.x - padding);
  const y = Math.max(0, target.y - padding);
  const right = Math.min(window.width, target.x + target.width + padding);
  const bottom = Math.min(window.height, target.y + target.height + padding);

  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/**
 * Donde colocar la tarjeta: debajo del resaltado si cabe, si no encima, y si
 * no cabe en ninguno de los dos (un elemento enorme) superpuesta abajo del
 * todo. Sin elemento, centrada.
 *
 * Devuelve { top } o { bottom } en coordenadas de ventana, dentro de las
 * zonas seguras.
 */
export function cardPlacement({ highlight, window, insets, cardHeight, gap = 12 }) {
  const safeTop = (insets?.top || 0) + 12;
  const safeBottom = (insets?.bottom || 0) + 12;

  if (!highlight) {
    return { top: Math.max(safeTop, (window.height - cardHeight) / 2), placement: "center" };
  }

  const spaceBelow = window.height - safeBottom - (highlight.y + highlight.height + gap);
  const spaceAbove = highlight.y - gap - safeTop;

  if (spaceBelow >= cardHeight) {
    return { top: highlight.y + highlight.height + gap, placement: "below" };
  }

  if (spaceAbove >= cardHeight) {
    return { top: highlight.y - gap - cardHeight, placement: "above" };
  }

  // No cabe sin taparlo: se pega al lado con mas espacio, sobre la zona segura.
  return spaceAbove > spaceBelow
    ? { top: safeTop, placement: "above" }
    : { top: window.height - safeBottom - cardHeight, placement: "below" };
}
