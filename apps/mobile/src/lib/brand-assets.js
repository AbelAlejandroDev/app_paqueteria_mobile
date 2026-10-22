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
 * El simbolo en blanco sobre transparente, para pintarlo sobre el color de
 * marca (la cabecera del detalle del item). HDG no lo tiene todavia y cae al
 * `mark` sobre su fondo.
 */
const MONOCHROME_MARKS = {
  the_worx: require("../../assets/brands/the_worx/monochrome-icon.png"),
  hdg: require("../../assets/brands/hdg/monochrome-icon.png"),
};

export const brandMonochromeMark = MONOCHROME_MARKS[brand.id] || null;

/**
 * Foto de fondo de la tarjeta de bienvenida del panel y de la bienvenida, una
 * por centro: cada cliente ve su oficina. La clave es "marca:slug del centro"
 * (`user.center.slug` de /auth/me). El centro que no tenga foto se queda con el
 * degradado de la marca.
 */
const CENTER_HEROES = {
  "the_worx:hallandale": require("../../assets/brands/the_worx/hallandale-hero.jpg"),
  "the_worx:sandlake": require("../../assets/brands/the_worx/sandlake-hero.jpg"),
};

export function homeHeroFor(user) {
  const slug = user?.center?.slug;
  if (!slug) return null;
  return CENTER_HEROES[brand.id + ":" + String(slug).toLowerCase()] || null;
}

/**
 * Logotipo completo para fondo claro. El icono cuadrado (`mark`) se sigue
 * usando para el icono de la app; esto es la versión con el nombre, para
 * pintarla dentro de tarjetas blancas.
 */
const WORDMARKS_ON_LIGHT = {
  the_worx: require("../../assets/brands/the_worx/the-worx-black-transparent.png"),
  hdg: require("../../assets/brands/hdg/hdg-logo-completo-transparent.png"),
};

export const brandWordmarkOnLight = WORDMARKS_ON_LIGHT[brand.id] || null;
