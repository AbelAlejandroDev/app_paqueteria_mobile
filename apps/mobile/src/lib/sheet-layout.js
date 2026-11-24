/**
 * Alto maximo de una hoja inferior (components/ui/modal), en pixeles. Sin React,
 * para probarlo.
 *
 * Deja libre la zona segura de arriba (isla dinamica, notch, barra de estado) y
 * un margen para que se vea que es una hoja sobre la pantalla. Nunca por debajo
 * de un minimo razonable, aunque la ventana sea muy baja (iPhone SE en
 * horizontal, letra del sistema muy grande).
 */
export const SHEET_TOP_GAP = 24;
export const SHEET_MIN_HEIGHT = 320;

export function sheetMaxHeight({ windowHeight, topInset = 0 } = {}) {
  const height = Number(windowHeight);
  if (!Number.isFinite(height) || height <= 0) return SHEET_MIN_HEIGHT;
  const available = height - Math.max(0, Number(topInset) || 0) - SHEET_TOP_GAP;
  return Math.max(SHEET_MIN_HEIGHT, Math.round(available));
}
