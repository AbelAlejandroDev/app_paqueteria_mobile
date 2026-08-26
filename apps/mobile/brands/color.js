/**
 * Contraste del color de marca, portado de src/lib/theme.js del front web.
 *
 * En la web esto corría en el navegador para decidir el color de texto sobre
 * el color primario. Aquí corre en Node, durante el build: como cada marca es
 * una app distinta, el color se hornea en el tema de Tailwind y no hace falta
 * resolverlo en runtime.
 */

const DEFAULT_PRIMARY_COLOR = "#65baaf";
const DARK_FOREGROUND = "#0f172a";
const LIGHT_FOREGROUND = "#f8fafc";

function normalizeHexColor(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  const normalized = rawValue.startsWith("#") ? rawValue : "#" + rawValue;
  if (!/^#([\da-fA-F]{3}|[\da-fA-F]{6})$/.test(normalized)) return "";

  if (normalized.length === 4) {
    return (
      "#" +
      normalized
        .slice(1)
        .split("")
        .map((char) => char + char)
        .join("")
    ).toLowerCase();
  }

  return normalized.toLowerCase();
}

function hexToRgb(hexColor) {
  const normalized = normalizeHexColor(hexColor) || DEFAULT_PRIMARY_COLOR;
  const value = normalized.slice(1);

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function toRelativeLuminanceChannel(value) {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function getRelativeLuminance({ r, g, b }) {
  return 0.2126 * toRelativeLuminanceChannel(r) + 0.7152 * toRelativeLuminanceChannel(g) + 0.0722 * toRelativeLuminanceChannel(b);
}

function getContrastRatio(background, foreground) {
  const backgroundLuminance = getRelativeLuminance(background);
  const foregroundLuminance = getRelativeLuminance(foreground);
  const lighter = Math.max(backgroundLuminance, foregroundLuminance);
  const darker = Math.min(backgroundLuminance, foregroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

/** Elige el texto (oscuro o claro) que mejor contrasta sobre `color`. */
function getForegroundForColor(color) {
  const rgb = hexToRgb(color);
  const darkContrast = getContrastRatio(rgb, hexToRgb(DARK_FOREGROUND));
  const lightContrast = getContrastRatio(rgb, hexToRgb(LIGHT_FOREGROUND));

  return darkContrast >= lightContrast ? DARK_FOREGROUND : LIGHT_FOREGROUND;
}

module.exports = {
  DEFAULT_PRIMARY_COLOR,
  DARK_FOREGROUND,
  LIGHT_FOREGROUND,
  getForegroundForColor,
  normalizeHexColor,
};
