// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // src/vendor: codigo de terceros generado (scripts/vendor-pdfjs.js).
    ignores: ["dist/*", "src/vendor/*"],
  }
]);
