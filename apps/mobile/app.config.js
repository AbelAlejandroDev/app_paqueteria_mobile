const fs = require("fs");
const path = require("path");

const { getBrand } = require("./brands");
const { getForegroundForColor } = require("./brands/color");

const brand = getBrand();

const brandDir = "./assets/brands/" + brand.id;
// Identificadores publicos de Firebase; se versiona. La clave privada de la
// cuenta de servicio NO va aqui: esa se sube a EAS y queda fuera del repo.
const googleServicesFile = brandDir + "/google-services.json";
const generatedIcon = brandDir + "/generated/icon.png";

/** Ruta del asset si esta marca lo tiene; null si no, para poder caer atras. */
function brandAsset(name) {
  const relative = brandDir + "/" + name;
  return fs.existsSync(path.join(__dirname, relative)) ? relative : null;
}

/**
 * Iconos entregados por diseño, uno por proposito.
 *
 * Sustituyen al generado cuando la marca los trae. The Worx los tiene; HDG
 * todavia no y sigue con el generado, que es cuadrado y a sangre.
 *
 * El foreground adaptativo tiene que ser el simbolo suelto con transparencia y
 * margen: si se usa el icono completo, Android recorta un cuadrado negro
 * dentro de su mascara en vez del simbolo.
 */
const brandIcon = brandAsset("icon.png");
const adaptiveForeground = brandAsset("adaptive-icon.png");
const monochromeIcon = brandAsset("monochrome-icon.png");

const appIcon = brandIcon || generatedIcon;

if (!fs.existsSync(path.join(__dirname, appIcon))) {
  throw new Error(
    `Falta el icono de "${brand.id}". Añade assets/brands/${brand.id}/icon.png o ejecuta: npm run icons`
  );
}

module.exports = {
  expo: {
    name: brand.name,
    slug: brand.slug,
    // Los proyectos viven en la organizacion, no en la cuenta personal. Sin
    // esto EAS los busca donde no estan y falla el build.
    owner: "ab-estrategia-360",
    version: "1.0.0",
    orientation: "portrait",
    icon: appIcon,
    scheme: brand.scheme,
    // Actualizaciones OTA. La URL lleva dentro el proyecto, asi que se deriva
    // de la marca: escrita fija, los builds de HDG buscarian las
    // actualizaciones de The Worx.
    ...(brand.easProjectId
      ? {
          updates: { url: "https://u.expo.dev/" + brand.easProjectId },
          // Una actualizacion solo llega a los builds con la misma version de
          // la app, que es lo que evita servir JS nuevo a un binario viejo que
          // no trae el codigo nativo que ese JS necesita.
          runtimeVersion: { policy: "appVersion" },
        }
      : {}),
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: brand.bundleId,
      supportsTablet: false,
      // El icono completo, sin esquinas redondeadas: iOS aplica su propia
      // máscara y redondearlo a mano dejaría un borde doble.
      icon: appIcon,
    },
    android: {
      package: brand.bundleId,
      // Android compone el icono en dos capas. El símbolo va delante con
      // transparencia y el color sólido detrás; el gradiente del icono
      // completo no se reproduce aquí a propósito, porque la capa de fondo
      // solo admite un color.
      adaptiveIcon: {
        backgroundColor: brand.androidIconBackground,
        foregroundImage: adaptiveForeground || generatedIcon,
        // Icono temático de Android 13+: el sistema lo recolorea con el tema
        // del usuario, así que es el símbolo en blanco sobre transparente.
        ...(monochromeIcon ? { monochromeImage: monochromeIcon } : {}),
      },
      predictiveBackGestureEnabled: false,
      // Registra la app ante Firebase y sin el no hay notificaciones en
      // Android. Es por marca porque cada una tiene su propio paquete y por
      // tanto su propio proyecto de Firebase.
      ...(fs.existsSync(path.join(__dirname, googleServicesFile))
        ? { googleServicesFile }
        : {}),
    },
    web: {
      output: "static",
      favicon: generatedIcon,
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          backgroundColor: brand.splashBackground,
          image: generatedIcon,
          imageWidth: 140,
        },
      ],
      "expo-secure-store",
      [
        "expo-local-authentication",
        {
          // iOS rechaza la app en revision si falta este texto.
          faceIDPermission: "Permite Face ID para desbloquear tu buzón sin escribir la contraseña.",
        },
      ],
      [
        "expo-image-picker",
        {
          // iOS rechaza la app si estos textos faltan.
          cameraPermission:
            "Permite el acceso a la cámara para fotografiar tus documentos de verificación USPS.",
          photosPermission:
            "Permite el acceso a tus fotos para adjuntar tus documentos de verificación USPS.",
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    // Lo lee src/lib/brand.js en runtime a través de expo-constants.
    extra: {
      // Proyecto de expo.dev de esta marca. Lo lee getExpoPushTokenAsync; sin
      // el, la app detecta que no puede registrarse y no lo intenta.
      eas: { projectId: brand.easProjectId || null },
      // Se evalua al compilar, asi que queda congelada la fecha real del build
      // que el usuario tiene instalado. En desarrollo es la de cada arranque.
      buildDate: new Date().toISOString(),
      brand: {
        id: brand.id,
        tenantSlug: brand.tenantSlug,
        name: brand.name,
        primaryColor: brand.primaryColor,
        primaryForeground: getForegroundForColor(brand.primaryColor),
        markBackground: brand.markBackground,
      },
    },
  },
};
