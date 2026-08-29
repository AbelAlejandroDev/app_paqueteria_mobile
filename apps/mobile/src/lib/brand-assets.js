import { brand } from "@/lib/brand";

/**
 * Metro resuelve los `require` de assets en tiempo de compilación, así que la
 * ruta no puede construirse con `brand.id`. El mapa es explícito y solo se
 * empaqueta el que usa la marca activa (el resto queda como referencia muerta
 * y el minificador la descarta).
 */
const MARKS = {
  the_worx: require("../../assets/brands/the_worx/generated/mark.png"),
  hdg: require("../../assets/brands/hdg/generated/mark.png"),
};

export const brandMark = MARKS[brand.id] || null;

/**
 * Logotipo completo para fondo claro. El icono cuadrado (`mark`) se sigue
 * usando para el icono de la app; esto es la versión con el nombre, para
 * pintarla dentro de tarjetas blancas.
 */
const WORDMARKS_ON_LIGHT = {
  the_worx: require("../../assets/brands/the_worx/the-worx-black-transparent.png"),
  hdg: require("../../assets/brands/hdg/logo-horizontal-transparent.png"),
};

export const brandWordmarkOnLight = WORDMARKS_ON_LIGHT[brand.id] || null;
