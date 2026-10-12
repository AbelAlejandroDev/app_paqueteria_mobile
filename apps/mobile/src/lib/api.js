import { router } from "expo-router";
import { createApiClient } from "@paqueteria/core";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL;

if (!API_BASE_URL) {
  throw new Error(
    "Falta EXPO_PUBLIC_API_URL. Copia .env.example a .env y apúntalo a la API."
  );
}

export const api = createApiClient({
  baseURL: API_BASE_URL,
  onUnauthorized: (reason) => {
    // Equivalente nativo del window.location.assign("/login") del front web.
    // El motivo viaja al login para que diga por que se cerro la sesion.
    router.replace(reason ? { pathname: "/login", params: { reason } } : "/login");
  },
});
