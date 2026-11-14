/**
 * A que API se conecta cada build: marca + entorno.
 *
 * CommonJS plano por lo mismo que brands/index.js: lo ejecuta Node al evaluar
 * app.config.js (expo start, eas build, eas update) y tambien lo importa la app
 * en runtime (src/lib/api.js) como segunda comprobacion.
 *
 * Reglas, que fallan el build en vez de dejarlo pasar:
 *   - Cada marca solo habla con SUS APIs (brand.api). Una app de HDG nunca
 *     puede apuntar a core.theworxoffices.com, ni al reves.
 *   - APP_ENV elige el entorno ("sandbox" | "production"); sin el, el de
 *     brand.defaultEnvironment. EXPO_PUBLIC_API_URL, si viene, tiene que ser
 *     exactamente la de esa marca y ese entorno: no elige, solo se comprueba.
 *   - Production exige brand.productionRelease.authorized. HDG lo tiene en
 *     false hasta que exista su API de produccion y se autorice el lanzamiento.
 *   - Una build de production nunca lleva una URL de sandbox.
 */

const { BRANDS } = require("./index");

const ENVIRONMENTS = ["sandbox", "production"];

function normalizeUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Todas las URLs de API que declara una marca, de cualquier entorno. */
function brandApiUrls(brand) {
  return Object.values(brand?.api || {})
    .filter(Boolean)
    .map(normalizeUrl);
}

/** A que marca pertenece una URL de API, o null si no es de ninguna. */
function brandForApiUrl(url, brands = BRANDS) {
  const normalized = normalizeUrl(url);
  for (const brand of Object.values(brands)) {
    if (brandApiUrls(brand).includes(normalized)) return brand.id;
  }
  return null;
}

function fail(message) {
  const error = new Error(message);
  error.code = "API_ENVIRONMENT_INVALID";
  return error;
}

/**
 * La API de esta build. Lanza si la combinacion no esta permitida.
 *
 * @param {object} options
 * @param {object} options.brand - Una entrada de BRANDS.
 * @param {Record<string, string|undefined>} [options.env] - process.env.
 * @returns {{ brandId: string, environment: "sandbox"|"production", url: string, host: string }}
 */
function resolveApiConfig({ brand, env = process.env, brands = BRANDS } = {}) {
  if (!brand?.id) throw fail("resolveApiConfig necesita una marca.");

  const environment = String(env.APP_ENV || brand.defaultEnvironment || "")
    .trim()
    .toLowerCase();

  if (!ENVIRONMENTS.includes(environment)) {
    throw fail(`APP_ENV="${env.APP_ENV}" no existe. Entornos: ${ENVIRONMENTS.join(", ")}.`);
  }

  if (environment === "production" && brand.productionRelease?.authorized !== true) {
    throw fail(
      `${brand.id}: los builds de production estan bloqueados. ` +
        (brand.productionRelease?.reason || "Falta configurar su API de produccion y autorizar el lanzamiento.") +
        " Para desarrollo usa APP_ENV=sandbox."
    );
  }

  const expected = normalizeUrl(brand.api?.[environment]);
  if (!expected) {
    throw fail(`${brand.id} no tiene API de ${environment} (brands/index.js, api.${environment}).`);
  }

  if (!expected.startsWith("https://")) {
    throw fail(`${brand.id} ${environment}: la API tiene que ser HTTPS (${expected}).`);
  }

  // Configuracion del catalogo: una URL no puede ser de dos marcas, ni la de
  // production de una marca ser su sandbox.
  for (const other of Object.values(brands)) {
    if (other.id !== brand.id && brandApiUrls(other).includes(expected)) {
      throw fail(`${expected} esta declarada a la vez para ${brand.id} y ${other.id}.`);
    }
  }
  if (environment === "production" && normalizeUrl(brand.api?.sandbox) === expected) {
    throw fail(`${brand.id}: la API de production no puede ser la de sandbox (${expected}).`);
  }

  const given = normalizeUrl(env.EXPO_PUBLIC_API_URL);
  if (given && given !== expected) {
    const owner = brandForApiUrl(given, brands);
    throw fail(
      `EXPO_PUBLIC_API_URL=${given} no es la API de ${brand.id} ${environment} (${expected})` +
        (owner && owner !== brand.id ? `: es la de ${owner}.` : ".") +
        " Revisa el perfil de eas.json o el .env local."
    );
  }

  return { brandId: brand.id, environment, url: expected, host: hostOf(expected) };
}

/**
 * Comprobacion en runtime: la URL con la que va a hablar la app es una de las
 * de su marca. Lanza si no.
 */
function assertApiUrlForBrand(url, brandId, brands = BRANDS) {
  const brand = brands[brandId];
  if (!brand) throw fail(`Marca desconocida: ${brandId}.`);
  if (!brandApiUrls(brand).includes(normalizeUrl(url))) {
    const owner = brandForApiUrl(url, brands);
    throw fail(`La app de ${brandId} no puede usar ${url || "(sin URL)"}` + (owner ? ` (es de ${owner}).` : "."));
  }
  return normalizeUrl(url);
}

module.exports = { ENVIRONMENTS, assertApiUrlForBrand, brandForApiUrl, resolveApiConfig };
