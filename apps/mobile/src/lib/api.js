import Constants from "expo-constants";
import { router } from "expo-router";
import { createApiClient } from "@paqueteria/core";

import { brand } from "@/lib/brand";
import { assertApiUrlForBrand } from "../../brands/api-environment";

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

/** "sandbox" | "production": de que entorno es esta build. */
export const apiEnvironment = apiConfig.environment;

export const api = createApiClient({
  baseURL: API_BASE_URL,
  onUnauthorized: (reason) => {
    // Equivalente nativo del window.location.assign("/login") del front web.
    // El motivo viaja al login para que diga por que se cerro la sesion.
    router.replace(reason ? { pathname: "/login", params: { reason } } : "/login");
  },
});
