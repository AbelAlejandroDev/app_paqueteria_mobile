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

/**
 * Runtime de OTA del binario, aparte de la version comercial.
 *
 * Cambia (native-3, native-4...) cada vez que cambia lo nativo: un modulo
 * nativo nuevo o con otra version, o un config plugin. La version comercial no
 * cambia por eso. tests/native-runtime.test.mjs falla si lo nativo cambia y
 * esto no; scripts/native-runtime.js explica como regenerar el registro.
 *
 * Los builds anteriores tienen runtime "1.0.0" (la politica "appVersion" que
 * habia antes), con modulos nativos distintos entre si: ningun OTA de esta
 * runtime les llega.
 */
const RUNTIME_VERSION = "native-2";

if (!fs.existsSync(path.join(__dirname, appIcon))) {
  throw new Error(
    `Falta el icono de "${brand.id}". Añade assets/brands/${brand.id}/icon.png o ejecuta: npm run icons`
  );
}

module.exports = {
  expo: {
    // El nombre bajo el icono es el del producto ("My Worx Mail"), no el de la
    // empresa. Es nativo: cambiarlo pide un build, un OTA no lo renombra.
    name: brand.appName || brand.name,
    slug: brand.slug,
    // Los proyectos viven en la organizacion, no en la cuenta personal. Sin
    // esto EAS los busca donde no estan y falla el build.
    owner: "ab-estrategia-360",
    // La version que ve el cliente en la tienda. No decide a que builds llega
    // un OTA: eso es RUNTIME_VERSION. Los numeros de build (ios.buildNumber,
    // android.versionCode) los lleva EAS (appVersionSource "remote").
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
          // Una actualizacion solo llega a los builds con la misma runtime, que
          // es lo que evita servir JS nuevo a un binario viejo que no trae el
          // codigo nativo que ese JS necesita.
          runtimeVersion: RUNTIME_VERSION,
        }
      : {}),
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: brand.bundleId,
      // La app solo cifra con HTTPS, que esta exento. Declararlo evita que App
      // Store Connect pregunte por la exportacion de cifrado en cada build y
      // la deje parada hasta responder.
      config: { usesNonExemptEncryption: false },
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
      // Avisos push (Expo -> FCM/APNs). Expo pide declararlo para los builds de
      // EAS; el color es el de la marca en la barra de notificaciones de Android.
      ["expo-notifications", { color: brand.primaryColor }],
      [
        "expo-local-authentication",
        {
          // iOS rechaza la app en revision si falta este texto.
          faceIDPermission: "Allow Face ID to unlock your mailbox without typing your password.",
        },
      ],
      [
        "expo-image-picker",
        {
          // iOS rechaza la app si estos textos faltan.
          cameraPermission:
            "Allow camera access to photograph your USPS verification documents.",
          photosPermission:
            "Allow photo access to attach your USPS verification documents.",
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
      brand: {
        id: brand.id,
        tenantSlug: brand.tenantSlug,
        authLogo: brand.authLogo || "mark",
        name: brand.name,
        appName: brand.appName || brand.name,
        shortName: brand.shortName || brand.name,
        primaryColor: brand.primaryColor,
        primaryForeground: brand.palette.onPrimary || getForegroundForColor(brand.primaryColor),
        markBackground: brand.markBackground,
        palette: brand.palette,
        fonts: brand.fonts,
      },
    },
  },
};
