/**
 * La API con la que habla la app, comprobada en runtime. Sin React ni Expo.
 *
 * La app NO carga el catalogo de marcas (brands/): se queda en Node, en
 * app.config.js, que valida marca y entorno y deja en `extra.api` solo lo de
 * esta build ({ brandId, environment, url, host, channels }). Asi el bundle de
 * HDG Sandbox no contiene la API de Production ni nada de The Worx.
 *
 * La comprobacion estricta (antes 5e1da2a, assertApiUrlForEnvironment) sigue,
 * con una fuente independiente del manifiesto: `bundledUrl` es
 * process.env.EXPO_PUBLIC_API_URL, que Expo escribe en el JS al empaquetar, y
 * que app.config.js ya exigio que fuera EXACTAMENTE la de esa marca y entorno
 * (brands/api-environment.js, resolveApiConfig). Si la configuracion que llega
 * (la del binario o la de un update) trae otra URL, aunque sea de la misma marca
 * (HDG: core frente a sandbox-core), la app no arranca la API.
 *
 * Lanza un Error con `code = "API_ENVIRONMENT_INVALID"` o `"UPDATE_CHANNEL_INVALID"`.
 */

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

/**
 * @param {object} options
 * @param {{ brandId?: string, environment?: string, url?: string, channels?: Record<string, string> }} options.apiConfig - extra.api
 * @param {string} options.brandId - la marca de esta build (extra.brand.id)
 * @param {string|undefined} options.bundledUrl - process.env.EXPO_PUBLIC_API_URL tal como quedo en el JS
 * @param {string|null|undefined} options.channel - Updates.channel (el canal del binario)
 * @returns {string} la URL base, normalizada
 */
export function assertRuntimeApi({ apiConfig, brandId, bundledUrl, channel }) {
  const url = normalizeUrl(apiConfig?.url);
  if (!url) throw fail("API_ENVIRONMENT_INVALID", "Falta la API de esta build (extra.api). Revisa APP_BRAND y APP_ENV.");
  if (!url.startsWith("https://")) throw fail("API_ENVIRONMENT_INVALID", `La API tiene que ser HTTPS (${url}).`);

  if (!brandId || apiConfig.brandId !== brandId) {
    throw fail("API_ENVIRONMENT_INVALID", `La API de esta build es de ${apiConfig.brandId || "(sin marca)"}, no de ${brandId || "(sin marca)"}.`);
  }

  const expected = normalizeUrl(bundledUrl);
  if (!expected) {
    throw fail("API_ENVIRONMENT_INVALID", "Este bundle no lleva EXPO_PUBLIC_API_URL: empaquetalo con el perfil o el script de su marca.");
  }
  if (url !== expected) {
    throw fail("API_ENVIRONMENT_INVALID", `${brandId} ${apiConfig.environment || ""}: la API es ${expected}, no ${url}.`);
  }

  // Sin canal (Expo Go, `expo start`, web) no hay nada que comprobar.
  if (channel) {
    const channelEnvironment = (apiConfig.channels || {})[String(channel)];
    if (!channelEnvironment) throw fail("UPDATE_CHANNEL_INVALID", `El canal "${channel}" no es de ${brandId}.`);
    if (channelEnvironment !== apiConfig.environment) {
      throw fail(
        "UPDATE_CHANNEL_INVALID",
        `Este binario es del canal "${channel}" (${channelEnvironment}) y el codigo es de ${apiConfig.environment}: update de otro entorno.`
      );
    }
  }

  return url;
}
