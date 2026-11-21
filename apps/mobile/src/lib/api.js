import Constants from "expo-constants";
import { router } from "expo-router";
import * as Updates from "expo-updates";
import { createApiClient, createApiProbe, DEFAULT_TIMEOUT_MS } from "@paqueteria/core";

import { brand } from "@/lib/brand";
import { attachAppInterceptors } from "@/lib/api-interceptors";
import { assertRuntimeApi } from "@/lib/runtime-api";

/**
 * La API sale de `extra.api`, que app.config.js ya valido para esta marca y
 * entorno con el catalogo completo (brands/, que no entra en el bundle). Se
 * comprueba otra vez aqui (lib/runtime-api): si no es EXACTAMENTE la que se
 * empaqueto en el JS, si es de otra marca o si el canal del binario es de otro
 * entorno, la app no arranca antes que mandar las credenciales de un cliente al
 * servidor equivocado. Un binario de Sandbox nunca habla con Production.
 */
const apiConfig = Constants.expoConfig?.extra?.api;

const API_BASE_URL = assertRuntimeApi({
  apiConfig,
  brandId: brand.id,
  // Acceso directo a process.env.EXPO_PUBLIC_*: Expo lo sustituye por el valor
  // al empaquetar (no desestructurar, o no se sustituye).
  bundledUrl: process.env.EXPO_PUBLIC_API_URL,
  channel: Updates.channel,
});

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
