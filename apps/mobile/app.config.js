const fs = require("fs");
const path = require("path");

const { getBrand } = require("./brands");
const { getForegroundForColor } = require("./brands/color");

const brand = getBrand();

const brandDir = "./assets/brands/" + brand.id;
const generatedIcon = brandDir + "/generated/icon.png";

if (!fs.existsSync(path.join(__dirname, generatedIcon))) {
  throw new Error(
    `Falta el icono generado de "${brand.id}". Ejecuta: npm run icons`
  );
}

module.exports = {
  expo: {
    name: brand.name,
    slug: brand.slug,
    version: "1.0.0",
    orientation: "portrait",
    icon: generatedIcon,
    scheme: brand.scheme,
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: brand.bundleId,
      supportsTablet: false,
    },
    android: {
      package: brand.bundleId,
      // El icono generado es cuadrado y a sangre; la máscara adaptativa lo
      // recorta a círculo sobre el mismo color de fondo, así que no se nota
      // el recorte.
      adaptiveIcon: {
        backgroundColor: brand.androidIconBackground,
        foregroundImage: generatedIcon,
      },
      predictiveBackGestureEnabled: false,
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
        markBackground: brand.markBackground,
      },
    },
  },
};
