const fs = require("fs");
const path = require("path");

const { getBrand } = require("./brands");
const { getForegroundForColor } = require("./brands/color");
const { resolveApiConfig, resolveApiTimeout } = require("./brands/api-environment");

const brand = getBrand();

// La API de esta build (marca + APP_ENV). Lanza aqui, antes de que EAS
// construya o publique nada, si la combinacion no esta permitida: una app de
// HDG apuntando a The Worx (o al reves), un production de HDG sin autorizar,
// o un EXPO_PUBLIC_API_URL que no es el de esa marca y entorno.
const apiConfig = resolveApiConfig({ brand });
const apiTimeoutMs = resolveApiTimeout();

const brandDir = "./assets/brands/" + brand.id;
// Identificadores publicos de Firebase; se versiona. La clave privada de la
// cuenta de servicio NO va aqui: esa se sube a EAS y queda fuera del repo.
const googleServicesFile = brandDir + "/google-services.json";
const generatedIcon = brandDir + "/generated/icon.png";
// Sin el google-services.json de la marca no hay Firebase: ni push en Android.
const hasGoogleServices = fs.existsSync(path.join(__dirname, googleServicesFile));

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
 * Universal Links (iOS) y App Links (Android) de los enlaces de activacion.
 * Solo si la marca los tiene encendidos (brands/index.js, appLinks.enabled):
 * encenderlos cambia lo nativo (entitlement de Associated Domains y filtros de
 * intent), asi que pide un build nuevo y subir RUNTIME_VERSION. Sin los ficheros
 * publicados en los portales, el enlace se abre en el navegador como hoy.
 */
function appLinksConfig(appLinks) {
  if (!appLinks?.enabled || !Array.isArray(appLinks.hosts) || !appLinks.hosts.length) return { ios: {}, android: {} };
  const paths = appLinks.paths?.length ? appLinks.paths : ["/set-password"];
  return {
    ios: { associatedDomains: appLinks.hosts.map((host) => "applinks:" + host) },
    android: {
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: appLinks.hosts.flatMap((host) => paths.map((pathPrefix) => ({ scheme: "https", host, pathPrefix }))),
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
  };
}

const appLinks = appLinksConfig(brand.appLinks);

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
// native-3 (2026-11-15): parches del SDK 57 con codigo nativo nuevo en
// expo-sharing, expo-notifications, expo-updates, expo-router, @expo/ui y
// expo-glass-effect (docs/release-checklist.md). Los builds native-2 (las de
// tienda de The Worx hasta ahora) no reciben OTAs de este codigo.
const RUNTIME_VERSION = "native-3";

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
      ...appLinks.ios,
    },
    android: {
      ...appLinks.android,
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
      ...(hasGoogleServices ? { googleServicesFile } : {}),
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
          // Solo se toman y eligen fotos (mediaTypes: ["images"]), nunca video
          // ni audio. false quita NSMicrophoneUsageDescription en iOS y bloquea
          // RECORD_AUDIO en Android aunque otra libreria lo pida: un permiso
          // que no se usa es una pregunta mas en la revision de las tiendas.
          microphonePermission: false,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    // Lo lee src/lib/brand.js en runtime a través de expo-constants.
    extra: {
      // La lee src/lib/api.js: la URL ya validada, no la variable suelta.
      api: apiConfig,
      // Push en Android: solo con el google-services.json de esta marca. Sin el
      // la app lo dice y no intenta registrarse (lib/push-presentation).
      push: { androidFcmConfigured: hasGoogleServices },
      // Cuanto espera una peticion antes de darla por perdida (API_TIMEOUT_MS).
      network: { timeoutMs: apiTimeoutMs },
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
