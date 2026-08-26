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
