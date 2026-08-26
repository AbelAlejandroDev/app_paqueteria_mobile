import Constants from "expo-constants";

const FALLBACK = {
  id: "the_worx",
  tenantSlug: "the_worx",
  name: "Client Portal",
  primaryColor: "#65baaf",
  primaryForeground: "#0f172a",
  markBackground: "#0e0d13",
};

/** Marca horneada en el build, inyectada por app.config.js en `extra.brand`. */
export const brand = Constants.expoConfig?.extra?.brand || FALLBACK;

/**
 * Nombre a mostrar. El branding del servidor manda cuando hay sesión, para que
 * un cambio en el panel de admin se refleje sin republicar la app; antes del
 * login se usa el horneado, que es de la propia marca.
 */
export function getBrandName(userBranding) {
  const remote = userBranding?.brandingName || userBranding?.name;
  return (typeof remote === "string" && remote.trim()) || brand.name;
}

/** El logo solo puede venir del servidor: no se empaqueta con la app. */
export function getBrandLogoUrl(userBranding) {
  const logo = userBranding?.logoUrl || userBranding?.logoDataUrl;
  return (typeof logo === "string" && logo.trim()) || null;
}
