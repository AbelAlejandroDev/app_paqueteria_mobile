/**
 * Los documentos legales que cada organizacion publica en su propia web.
 *
 * Solo enlaces: el texto vive y se mantiene en esa web, no en la app. La
 * Privacy Policy de The Worx es corporativa y vale igual para Sandlake,
 * Hallandale y Hunters Creek.
 *
 * Va por la organizacion del usuario (`user.tenant.slug`), no por la marca de
 * la app, y sin valor por defecto: una organizacion que no esta en la lista
 * (HDG hoy) no tiene enlace en vez de heredar el de The Worx. Los mismos datos
 * que el portal web (src/lib/legalLinks.js en el front).
 */
const PRIVACY_POLICIES = {
  the_worx: {
    name: "The Worx Offices Privacy Policy",
    url: "https://theworxoffices.com/privacy-policy",
  },
};

/** `{ name, url }` de la organizacion, o null si no tiene una publicada. */
export function privacyPolicyFor(tenantSlug) {
  const key = String(tenantSlug || "").trim().toLowerCase().replace(/-/g, "_");
  return Object.prototype.hasOwnProperty.call(PRIVACY_POLICIES, key) ? PRIVACY_POLICIES[key] : null;
}
