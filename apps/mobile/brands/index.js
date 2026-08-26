/**
 * Catálogo de marcas (white-label).
 *
 * Cada marca produce una app independiente: su propio identificador de
 * paquete, nombre en la tienda, esquema de deep link y color. Se elige con la
 * variable de entorno APP_BRAND en tiempo de build.
 *
 * Este fichero lo consumen tres sitios, y por eso es CommonJS plano (se
 * ejecuta en Node durante el empaquetado, no dentro de la app):
 *
 *   - app.config.js       identidad de la app y del build
 *   - tailwind.config.js  color primario horneado en el tema
 *   - src/lib/brand.js    lectura en runtime vía expo-constants
 *
 * `tenantSlug` debe coincidir con la clave de BRAND_EMAIL_CONFIG del backend
 * (src/config/brandEmailConfig.js), que es lo que decide el remitente de los
 * correos de alta.
 */

const BRANDS = {
  the_worx: {
    id: "the_worx",
    tenantSlug: "the_worx",
    name: "The Worx Offices",
    slug: "worx-client",
    scheme: "worxclient",
    bundleId: "com.theworxoffices.clientportal",
    primaryColor: "#65baaf",
    splashBackground: "#0f172a",
    androidIconBackground: "#E6F4FE",
  },
  hdg: {
    id: "hdg",
    tenantSlug: "hdg",
    name: "HDG Executive Suites",
    slug: "hdg-client",
    scheme: "hdgclient",
    bundleId: "com.hdgexecutivesuites.clientportal",
    primaryColor: "#65baaf",
    splashBackground: "#0f172a",
    androidIconBackground: "#E6F4FE",
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
