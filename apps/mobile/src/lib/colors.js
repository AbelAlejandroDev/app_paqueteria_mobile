/**
 * Mezcla un color con blanco y devuelve el resultado opaco, en hex.
 *
 * Sirve para los "velos" de marca (el verde al 14 %, por ejemplo) sobre
 * superficies con sombra: en Android la sombra (elevation) se pinta debajo de
 * la vista, y un fondo translucido la deja ver como un recuadro oscuro.
 */
export function overWhite(hex, alpha) {
  const value = parseInt(String(hex).replace("#", "").slice(0, 6), 16);
  const mix = (channel) => Math.round(channel * alpha + 255 * (1 - alpha));
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(mix);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
