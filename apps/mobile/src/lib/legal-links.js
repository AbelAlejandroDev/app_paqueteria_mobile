/**
 * Los documentos legales que cada organizacion publica en su propia web.
 *
 * Solo enlaces: el texto vive y se mantiene en esa web, no en la app. La
 * politica de cada organizacion esta en el catalogo de marcas
 * (brands/index.js, `privacyPolicy`) y app.config.js deja en el bundle SOLO la
 * de la marca de esta build (`extra.brand.privacyPolicy`): la app de HDG no
 * lleva la URL de The Worx ni al reves.
 *
 * Va por la organizacion del usuario (`user.tenant.slug`), y sin valor por
 * defecto: si no es la organizacion de esta app (o no tiene una publicada) no
 * hay enlace, en vez de heredar el de otra.
 */

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/-/g, "_");
}

/**
 * `{ name, url }` de la organizacion del usuario, o null.
 * @param {string} tenantSlug - user.tenant.slug
 * @param {{ tenantSlug?: string, privacyPolicy?: { name: string, url: string } | null }} appBrand - la marca de esta build (lib/brand)
 */
export function privacyPolicyFor(tenantSlug, appBrand) {
  const slug = normalizeSlug(tenantSlug);
  if (!slug || slug !== normalizeSlug(appBrand?.tenantSlug)) return null;
  const policy = appBrand?.privacyPolicy;
  if (!policy || typeof policy.url !== "string" || typeof policy.name !== "string") return null;
  return { name: policy.name, url: policy.url };
}
