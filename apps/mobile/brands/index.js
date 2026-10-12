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
 *
 * `palette` son los tonos que acompañan al primario en el detalle del item:
 *   - `ink`     texto; los grises salen de el con opacidad, no de slate.
 *   - `tint`    relleno suave de chips y avisos.
 *   - `glyph`   iconos de los botones secundarios.
 *   - `sand`    acento secundario (eventos antiguos, "Not mine").
 *   - `success` estado recibido.
 *   - `canvas`  fondo de la pantalla.
 *   - `media`   fondo de la foto mientras carga o si no hay.
 */

const BRANDS = {
  the_worx: {
    id: "the_worx",
    tenantSlug: "the_worx",
    name: "The Worx Offices",
    slug: "worx-client",
    scheme: "worxclient",
    bundleId: "com.theworxoffices.clientportal",
    easProjectId: "922f4b80-6a1f-4072-a4df-c0d35fe374c8",
    primaryColor: "#65baaf",
    splashBackground: "#0e0d13",
    // Capa de fondo del icono adaptativo de Android. Coincide con la esquina
    // del degradado de icon.png (#08090D), que es lo que asoma al recortar la
    // mascara.
    androidIconBackground: "#090A0D",
    markBackground: "#0e0d13",
    palette: {
      ink: "#2D2A26",
      tint: "#A5E5D9",
      glyph: "#4D7F71",
      sand: "#C2BA98",
      success: "#00A887",
      canvas: "#F1FCFA",
      media: "#EEF2F1",
    },
    assets: {
      mark: "icon.png",
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
    easProjectId: "2e12104c-c190-48aa-b044-da110d34e8f1",
    primaryColor: "#5f5971",
    splashBackground: "#ffffff",
    androidIconBackground: "#ffffff",
    markBackground: "#ffffff",
    // Sin diseño propio todavia: los mismos papeles que The Worx, sobre su
    // morado en vez del verde.
    palette: {
      ink: "#2D2A26",
      tint: "#D9D4E6",
      glyph: "#5F5971",
      sand: "#B8B0C8",
      success: "#00A887",
      canvas: "#F8F7FB",
      media: "#EFEEF3",
    },
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
