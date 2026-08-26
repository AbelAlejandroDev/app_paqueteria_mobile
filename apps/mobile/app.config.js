const fs = require("fs");
const path = require("path");

const { getBrand } = require("./brands");
const { getForegroundForColor } = require("./brands/color");

const brand = getBrand();

/**
 * Devuelve el asset propio de la marca si existe, o el compartido si todavía
 * no se ha añadido. Permite arrancar una marca nueva sin bloquearse esperando
 * los ficheros de diseño.
 */
function asset(relativePath, fallback) {
  const branded = path.join("assets", "brands", brand.id, relativePath);
  return fs.existsSync(path.join(__dirname, branded)) ? "./" + branded.split(path.sep).join("/") : fallback;
}

module.exports = {
  expo: {
    name: brand.name,
    slug: brand.slug,
    version: "1.0.0",
    orientation: "portrait",
    icon: asset("icon.png", "./assets/images/icon.png"),
    scheme: brand.scheme,
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: brand.bundleId,
      supportsTablet: false,
    },
    android: {
      package: brand.bundleId,
      adaptiveIcon: {
        backgroundColor: brand.androidIconBackground,
        foregroundImage: asset("android-icon-foreground.png", "./assets/images/android-icon-foreground.png"),
        backgroundImage: asset("android-icon-background.png", "./assets/images/android-icon-background.png"),
        monochromeImage: asset("android-icon-monochrome.png", "./assets/images/android-icon-monochrome.png"),
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          backgroundColor: brand.splashBackground,
          image: asset("splash-icon.png", "./assets/images/splash-icon.png"),
          imageWidth: 76,
        },
      ],
      "expo-secure-store",
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    // Lo lee src/lib/brand.js en runtime a través de expo-constants.
    extra: {
      brand: {
        id: brand.id,
        tenantSlug: brand.tenantSlug,
        name: brand.name,
        primaryColor: brand.primaryColor,
        primaryForeground: getForegroundForColor(brand.primaryColor),
      },
    },
  },
};
