import { brand } from "@/lib/brand";
import { isSessionForTenant } from "@/lib/session-tenant";

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
 *
 * Son las mismas fotos que el portal web (front-web `public/center-images/`, ver
 * su `src/lib/centerImages.js`), copiadas byte a byte del JPG original: la app no
 * depende de la web para pintarlas. HDG Hollywood lleva el rotulo de HDG a la
 * derecha, que es la parte que el degradado deja ver (`contentPosition="right"`).
 *
 * Como en la web, la foto exige ademas que la sesion sea de la organizacion de
 * esta app: una sesion de otra organizacion nunca pinta la foto de un centro.
 */
const CENTER_HEROES = {
  "the_worx:hallandale": require("../../assets/brands/the_worx/hallandale-hero.jpg"),
  "the_worx:sandlake": require("../../assets/brands/the_worx/sandlake-hero.jpg"),
  "hdg:hollywood": require("../../assets/brands/hdg/hollywood-hero.jpg"),
};

export function homeHeroFor(user) {
  const slug = user?.center?.slug;
  if (!slug || !isSessionForTenant(user, brand.tenantSlug)) return null;
  return CENTER_HEROES[brand.id + ":" + String(slug).trim().toLowerCase()] || null;
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
