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

/**
 * `keyboardHeight` (iOS): el KeyboardAvoidingView de la hoja suma esa altura
 * como padding debajo. Si la hoja no la resta, hoja + teclado miden mas que la
 * pantalla y la cabecera queda cortada bajo la isla dinamica. Con el teclado
 * abierto el minimo baja: lo que no cabe se desplaza dentro de la hoja.
 */
export const SHEET_MIN_HEIGHT_WITH_KEYBOARD = 160;

export function sheetMaxHeight({ windowHeight, topInset = 0, keyboardHeight = 0 } = {}) {
  const height = Number(windowHeight);
  if (!Number.isFinite(height) || height <= 0) return SHEET_MIN_HEIGHT;
  const keyboard = Math.max(0, Number(keyboardHeight) || 0);
  const available = height - Math.max(0, Number(topInset) || 0) - SHEET_TOP_GAP - keyboard;
  return Math.max(keyboard > 0 ? SHEET_MIN_HEIGHT_WITH_KEYBOARD : SHEET_MIN_HEIGHT, Math.round(available));
}
