/**
 * Lo nativo que lleva el binario, para no mandarle por OTA un JS que no puede
 * ejecutar.
 *
 *   npm run native-runtime          compara con native-runtime.json
 *   npm run native-runtime -- --write   lo regenera (tras cambiar la runtime)
 *
 * Una actualizacion OTA solo llega a los builds con la misma runtimeVersion.
 * Es RUNTIME_VERSION en app.config.js, explicita y aparte de la version
 * comercial: con la politica "appVersion" que habia antes, todos los builds de
 * la 1.0.0 compartian runtime aunque unos no traian WebView, FileSystem ni
 * Sharing.
 *
 * native-runtime.json guarda lo nativo de la runtime actual. El test
 * tests/native-runtime.test.mjs falla si lo nativo cambia y la runtime no: hay
 * que subir RUNTIME_VERSION (native-3...), regenerar el fichero y hacer un
 * build nuevo. La version comercial no se toca por eso.
 *
 * Se descarto la politica "fingerprint": en este equipo hay una carpeta
 * android/ generada (ignorada por git) que entra en la huella local y no en la
 * de EAS, asi que un `eas update` desde aqui no llegaria nunca a los builds.
 */

const fs = require("fs");
const path = require("path");

const APP_DIR = path.join(__dirname, "..");
const RECORD_FILE = path.join(APP_DIR, "native-runtime.json");

function packageDir(name) {
  for (const base of [path.join(APP_DIR, "node_modules"), path.join(APP_DIR, "..", "..", "node_modules")]) {
    const dir = path.join(base, name);
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
  }
  return null;
}

/** Un paquete trae codigo nativo si es un modulo Expo, tiene podspec o android/. */
function isNative(dir) {
  if (fs.existsSync(path.join(dir, "expo-module.config.json"))) return true;
  if (fs.existsSync(path.join(dir, "android", "build.gradle"))) return true;
  return fs.readdirSync(dir).some((file) => file.endsWith(".podspec"));
}

function readAppConfig() {
  // app.config.js lee la marca de APP_BRAND; lo nativo es el mismo para todas.
  delete require.cache[require.resolve(path.join(APP_DIR, "app.config.js"))];
  return require(path.join(APP_DIR, "app.config.js")).expo;
}

/** Lo nativo de ahora: runtime del binario, modulos nativos con su version y plugins. */
function currentNativeRuntime() {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8"));
  const modules = {};
  for (const name of Object.keys(pkg.dependencies || {}).sort()) {
    const dir = packageDir(name);
    if (!dir || !isNative(dir)) continue;
    modules[name] = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
  }

  const expo = readAppConfig();
  const plugins = (expo.plugins || []).map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin)).sort();

  return { runtimeVersion: expo.runtimeVersion, modules, plugins };
}

function readRecord() {
  return JSON.parse(fs.readFileSync(RECORD_FILE, "utf8"));
}

/** Que cambio de lo nativo respecto a lo guardado, en frases. */
function nativeChanges(recorded, current) {
  const changes = [];
  const names = new Set([...Object.keys(recorded.modules || {}), ...Object.keys(current.modules || {})]);
  for (const name of [...names].sort()) {
    const before = recorded.modules?.[name];
    const after = current.modules?.[name];
    if (before !== after) changes.push(`${name}: ${before || "(no estaba)"} -> ${after || "(quitado)"}`);
  }
  const pluginsBefore = (recorded.plugins || []).join(", ");
  const pluginsAfter = (current.plugins || []).join(", ");
  if (pluginsBefore !== pluginsAfter) changes.push(`plugins: [${pluginsBefore}] -> [${pluginsAfter}]`);
  return changes;
}

module.exports = { currentNativeRuntime, nativeChanges, readRecord, RECORD_FILE };

if (require.main === module) {
  const current = currentNativeRuntime();
  if (process.argv.includes("--write")) {
    fs.writeFileSync(RECORD_FILE, JSON.stringify(current, null, 2) + "\n");
    console.log(`native-runtime.json: runtime ${current.runtimeVersion}, ${Object.keys(current.modules).length} modulos nativos`);
  } else {
    const recorded = readRecord();
    const changes = nativeChanges(recorded, current);
    console.log(changes.length ? changes.join("\n") : "Sin cambios nativos en " + recorded.runtimeVersion);
    process.exitCode = changes.length && recorded.runtimeVersion === current.runtimeVersion ? 1 : 0;
  }
}
