/**
 * Catálogo de marcas (white-label).
 *
 * Cada marca produce una app independiente: su propio identificador de
 * paquete, nombre en la tienda, esquema de deep link, color y logos. Se elige
 * con la variable de entorno APP_BRAND en tiempo de build.
 *
 * Este fichero lo consumen tres sitios, y por eso es CommonJS plano (se
 * ejecuta en Node durante el empaquetado, no dentro de la app):
 *
 *   - app.config.js       identidad de la app y del build
 *   - tailwind.config.js  color primario horneado en el tema
 *   - src/lib/brand.js    lectura en runtime vía expo-constants
 *
 * `easProjectId` es el proyecto de expo.dev de cada marca. Va aquí y no en
 * app.config.js porque cada marca es una app distinta y necesita el suyo: con
 * uno solo, las notificaciones de una llegarían a los clientes de la otra.
 * Sin él, la app no puede pedir el token push y no registra el dispositivo.
 *
 * `tenantSlug` debe coincidir con la clave de BRAND_EMAIL_CONFIG del backend
 * (src/config/brandEmailConfig.js), que es lo que decide el remitente de los
 * correos de alta.
 *
 * Sobre `assets`:
 *   - `mark`      cuadrado, se usa en el icono de app y en el distintivo de
 *                 la cabecera.
 *   - `wordmark`  lockup horizontal con el nombre. Puede faltar.
 *   - `markBackground` color detrás del `mark`: los marks transparentes
 *                 necesitan un fondo propio, y no siempre vale el de marca
 *                 (el de HDG es morado sobre morado).
 *   - `wordmarkOnDark` el lockup es claro y solo se lee sobre fondo oscuro.
 */

const BRANDS = {
  the_worx: {
    id: "the_worx",
    tenantSlug: "the_worx",
    name: "The Worx Offices",
    slug: "worx-client",
    scheme: "worxclient",
    bundleId: "com.theworxoffices.clientportal",
    easProjectId: "0a24a678-892e-46e5-ad6a-421bceb8803e",
    primaryColor: "#65baaf",
    splashBackground: "#0e0d13",
    androidIconBackground: "#0e0d13",
    markBackground: "#0e0d13",
    assets: {
      mark: "the-worx-icono-simple-background-black.png",
      wordmark: "the-worx-white-transparent.png",
      wordmarkOnDark: true,
    },
  },
  hdg: {
    id: "hdg",
    tenantSlug: "hdg",
    name: "HDG Executive Suites",
    slug: "hdg-client",
    scheme: "hdgclient",
    bundleId: "com.hdgexecutivesuites.clientportal",
    easProjectId: "76e45578-661f-43a5-96fa-bb1089a92586",
    primaryColor: "#5f5971",
    splashBackground: "#ffffff",
    androidIconBackground: "#ffffff",
    markBackground: "#ffffff",
    assets: {
      mark: "hdg-icono-simple-transparent.png",
      wordmark: "logo-horizontal-transparent.png",
      wordmarkOnDark: false,
    },
  },
};

const DEFAULT_BRAND = "the_worx";

function getBrand(brandId = process.env.APP_BRAND) {
  const key = String(brandId || DEFAULT_BRAND).trim().toLowerCase();
  const brand = BRANDS[key];

  if (!brand) {
    const available = Object.keys(BRANDS).join(", ");
    throw new Error(`APP_BRAND="${brandId}" no existe. Marcas disponibles: ${available}`);
  }

  return brand;
}

module.exports = { BRANDS, DEFAULT_BRAND, getBrand };
