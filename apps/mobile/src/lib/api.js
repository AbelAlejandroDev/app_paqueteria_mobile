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
  headers: {
    // Solo hace falta mientras la API se sirva por el túnel de ngrok.
    // Se puede quitar en cuanto api.theworxoffices.com esté con TLS propio.
    "ngrok-skip-browser-warning": "true",
  },
  onUnauthorized: () => {
    // Equivalente nativo del window.location.assign("/login") del front web.
    router.replace("/login");
  },
});
