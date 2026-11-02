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
 * `name` es la empresa (el logo, la cabecera del panel); `appName` es el
 * producto, lo que el telefono muestra bajo el icono. Cambiar `appName` toca lo
 * nativo: un OTA no renombra una app ya instalada, hace falta un build.
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
 *   - `onPrimary` texto e iconos sobre el color primario. El diseño de The
 *                 Worx usa blanco sobre su verde aunque el contraste calculado
 *                 pediria oscuro.
 *   - `heroFrom` / `heroTo` el fondo oscuro de la tarjeta de bienvenida del
 *                 panel y de la tarjeta de pago (de izquierda a derecha).
 *   - `shadow`  el tinte de las sombras suaves.
 *   - `border` / `mutedForeground` (opcionales) el borde y el texto
 *                 secundario; sin ellos se derivan de `ink`.
 *
 * `fonts` son las familias de la marca, una por peso: Android no sintetiza la
 * negrita de una fuente cargada a mano, asi que cada peso es su propia familia.
 */

const BRANDS = {
  the_worx: {
    id: "the_worx",
    tenantSlug: "the_worx",
    name: "The Worx Offices",
    // El producto: el nombre bajo el icono, en la instalacion y en los avisos.
    appName: "My Worx Mail",
    // Como se nombra la marca en una frase ("Welcome to The Worx").
    shortName: "The Worx",
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
      onPrimary: "#FFFFFF",
      heroFrom: "#0F3A33",
      heroTo: "#2F6F62",
      shadow: "#1D4E4A",
    },
    fonts: {
      regular: "HankenGrotesk_400Regular",
      medium: "HankenGrotesk_500Medium",
      semibold: "HankenGrotesk_600SemiBold",
      bold: "HankenGrotesk_700Bold",
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
    appName: "My HDG Mail",
    shortName: "HDG Executive Suites",
    slug: "hdg-client",
    scheme: "hdgclient",
    bundleId: "com.hdgexecutivesuites.clientportal",
    easProjectId: "2e12104c-c190-48aa-b044-da110d34e8f1",
    // Manual de marca de HDG: Primary #2F4157, Secondary #577C8E, Accent
    // #C7D9E5, Background #F4EFEB; complementarios Dark Navy #12203A, Muted
    // Blue #66809B, Light Gray Blue #DCE2EE, Neutral Gray #727375.
    primaryColor: "#2F4157",
    // El icono aprobado es el logo a color sobre blanco: el splash, la capa
    // de fondo del icono adaptativo y el cuadro del distintivo van en blanco
    // para que no aparezca un recuadro de otro color alrededor.
    splashBackground: "#FFFFFF",
    androidIconBackground: "#FFFFFF",
    markBackground: "#FFFFFF",
    // Paleta definitiva (oct. 2026): primary, buttonPrimary y textPrimary
    // #2F4157; secondary, textSecondary y link #577C8E; accent y border
    // #C7D9E5; background #F4EFEB; surface #FFFFFF. "success" es el verde de
    // estado (recibido, completado): es funcional, no de marca, y se comparte;
    // error y aviso tampoco cambian.
    palette: {
      ink: "#2F4157", // textPrimary
      tint: "#C7D9E5", // accent: rellenos suaves y chips
      glyph: "#577C8E", // secondary: iconos y enlaces
      sand: "#66809B", // Muted Blue: acento secundario
      success: "#00A887",
      canvas: "#F4EFEB", // background
      media: "#DCE2EE", // Light Gray Blue: fondo de fotos
      onPrimary: "#FFFFFF", // buttonText
      border: "#C7D9E5", // border
      mutedForeground: "#577C8E", // textSecondary
      heroFrom: "#2F4157", // primary -> secondary: azul marino sin oscurecer
      heroTo: "#577C8E",
      shadow: "#2F4157",
    },
    fonts: {
      regular: "Poppins_400Regular",
      medium: "Poppins_500Medium",
      semibold: "Poppins_600SemiBold",
      bold: "Poppins_700Bold",
    },
    // Icono aprobado (oct. 2026): icon.jpg, el logo HDG a color sobre blanco,
    // sin "Executive Suites". icon.png, adaptive-icon.png (logo dentro de la
    // zona segura) y monochrome-icon.png (silueta) salen de el sin
    // redibujarlo; generated/ lo genera `npm run icons -- hdg`. Los
    // anteriores estan en old/.
    assets: {
      mark: "icon.png",
      wordmark: "hdg-logo-completo-transparent.png",
      wordmarkOnDark: false,
    },
    // Login, recuperar y crear contraseña con el logo horizontal oficial en
    // vez del simbolo con el nombre en texto (el logo ya lleva el nombre).
    authLogo: "wordmark",
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
