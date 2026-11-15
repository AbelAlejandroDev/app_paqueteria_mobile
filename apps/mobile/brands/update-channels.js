/**
 * Canales de EAS Update: que entorno de API puede llevar cada uno, por marca.
 *
 * Cada marca es otro proyecto de EAS (brands/index.js, easProjectId; la URL de
 * updates lleva el proyecto): un update de una marca no puede llegar a la otra.
 * Dentro de una marca, un canal es de UN entorno (brand.updateChannels): un
 * update hecho con la configuracion de Sandbox no puede publicarse en un canal
 * de produccion ni al reves.
 *
 * Dos barreras:
 *   - Al publicar: scripts/eas-update.js arma el comando con marca, entorno, URL
 *     y entorno de EAS coherentes con el canal, o se niega.
 *   - En la app: src/lib/api.js compara Updates.channel (el canal del binario)
 *     con el entorno del bundle que corre; si no encajan, no arranca la API.
 *
 * CommonJS: lo usan app.config, scripts, tests y la app.
 */

const { getBrand } = require("./index");
const { resolveApiConfig } = require("./api-environment");

function fail(message) {
  const error = new Error(message);
  error.code = "UPDATE_CHANNEL_INVALID";
  return error;
}

/** El entorno que lleva un canal de esa marca, o null si el canal no es suyo. */
function environmentForChannel(brand, channel) {
  return (brand?.updateChannels || {})[String(channel || "")] || null;
}

/**
 * En runtime: el canal del binario (Updates.channel) frente al entorno del
 * bundle que corre. Sin canal (Expo Go, `expo start`, web) no hay nada que
 * comprobar. Lanza si el canal no es de la marca o lleva otro entorno.
 */
function assertChannelMatchesEnvironment({ brand, channel, environment }) {
  if (!channel) return true;
  const expected = environmentForChannel(brand, channel);
  if (!expected) throw fail(`El canal "${channel}" no es de ${brand.id}.`);
  if (expected !== environment) {
    throw fail(`Este binario es del canal "${channel}" (${expected}) y el codigo es de ${environment}: update de otro entorno.`);
  }
  return true;
}

/** Los perfiles de eas.json de una marca con su canal y entorno de EAS. */
function profilesForBrand(eas, brandId) {
  const resolve = (name) => {
    const profile = eas.build[name];
    const parent = profile.extends ? resolve(profile.extends) : {};
    return { ...parent, ...profile, env: { ...(parent.env || {}), ...(profile.env || {}) } };
  };
  return Object.keys(eas.build)
    .filter((name) => !name.startsWith("base-"))
    .map((name) => ({ name, ...resolve(name) }))
    .filter((profile) => profile.env.APP_BRAND === brandId);
}

/**
 * El `eas update` correcto para marca + canal, o un error. No lo ejecuta.
 * El entorno de EAS (--environment) es el de los perfiles de build de ese canal.
 */
function updatePlan({ brandId, channel, eas, message }) {
  const brand = getBrand(brandId);
  const environment = environmentForChannel(brand, channel);
  if (!environment) throw fail(`${brand.id} no tiene el canal "${channel}". Canales: ${Object.keys(brand.updateChannels || {}).join(", ")}.`);

  const env = { APP_BRAND: brand.id, APP_ENV: environment };
  // Lanza si el entorno esta bloqueado (HDG production) o no tiene API.
  const api = resolveApiConfig({ brand, env });
  env.EXPO_PUBLIC_API_URL = api.url;

  const profiles = profilesForBrand(eas, brand.id).filter((profile) => profile.channel === channel);
  if (!profiles.length) throw fail(`Ningun perfil de build de ${brand.id} usa el canal "${channel}": no hay binarios que lo reciban.`);
  const easEnvironments = [...new Set(profiles.map((profile) => profile.environment).filter(Boolean))];
  if (easEnvironments.length !== 1) throw fail(`Los perfiles del canal "${channel}" no coinciden en el entorno de EAS: ${easEnvironments.join(", ")}.`);
  for (const profile of profiles) {
    if (profile.env.APP_ENV !== environment) {
      throw fail(`El perfil ${profile.name} (canal ${channel}) es de ${profile.env.APP_ENV}, no de ${environment}.`);
    }
  }

  if (!message || !String(message).trim()) throw fail("Falta --message: cada update dice que cambia.");

  return {
    env,
    command: "npx",
    args: ["eas-cli", "update", "--channel", channel, "--environment", easEnvironments[0], "--message", String(message).trim(), "--non-interactive"],
  };
}

module.exports = { assertChannelMatchesEnvironment, environmentForChannel, profilesForBrand, updatePlan };
