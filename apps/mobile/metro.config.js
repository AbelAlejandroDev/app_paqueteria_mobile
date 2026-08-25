// Expo SDK 57 configura Metro para monorepos automáticamente (watchFolders y
// nodeModulesPaths no hacen falta). Aquí solo envolvemos con NativeWind.
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./src/global.css" });
