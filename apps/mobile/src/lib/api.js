import Constants from "expo-constants";
import { router } from "expo-router";
import * as Updates from "expo-updates";
import { createApiClient, createApiProbe, DEFAULT_TIMEOUT_MS } from "@paqueteria/core";

import { brand } from "@/lib/brand";
import { attachAppInterceptors } from "@/lib/api-interceptors";
import { assertApiUrlForBrand } from "../../brands/api-environment";
import { BRANDS } from "../../brands";
import { assertChannelMatchesEnvironment } from "../../brands/update-channels";

/**
 * La API sale de `extra.api`, que app.config.js ya valido para esta marca y
 * entorno (brands/api-environment.js). Se comprueba otra vez aqui: si por lo
 * que sea llegara la de otra marca, la app no arranca antes que mandar las
 * credenciales de un cliente al servidor equivocado.
 */
const apiConfig = Constants.expoConfig?.extra?.api;

if (!apiConfig?.url) {
  throw new Error("Falta la API de esta build (extra.api). Revisa APP_BRAND y APP_ENV.");
}

const API_BASE_URL = assertApiUrlForBrand(apiConfig.url, brand.id);

// Un OTA de otro entorno (p. ej. un bundle de Sandbox en el canal production) no
// llega a hablar con ninguna API: el canal del binario manda (brands/update-channels).
assertChannelMatchesEnvironment({ brand: BRANDS[brand.id], channel: Updates.channel, environment: apiConfig.environment });

/** "sandbox" | "production": de que entorno es esta build. */
export const apiEnvironment = apiConfig.environment;

/** Milisegundos antes de dar una peticion por perdida (API_TIMEOUT_MS al construir). */
export const API_TIMEOUT_MS = Number(Constants.expoConfig?.extra?.network?.timeoutMs) || DEFAULT_TIMEOUT_MS;

export const api = createApiClient({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  onUnauthorized: (reason) => {
    // Equivalente nativo del window.location.assign("/login") del front web.
    // El motivo viaja al login para que diga por que se cerro la sesion.
    router.replace(reason ? { pathname: "/login", params: { reason } } : "/login");
  },
});

// Disponibilidad del servicio y 402 BILLING_REQUIRED (lib/api-interceptors).
attachAppInterceptors(api);

/** Comprueba si la API responde, sin sesion (ver createApiProbe en core). */
export const probeApi = createApiProbe({ baseURL: API_BASE_URL, timeout: Math.min(API_TIMEOUT_MS, 10000) });
