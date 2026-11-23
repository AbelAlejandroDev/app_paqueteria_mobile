/**
 * Los documentos legales que cada organizacion publica en su propia web.
 *
 * Solo enlaces: el texto vive y se mantiene en esa web, no en la app.
 *
 * De donde sale cada enlace (backend HDG 3a17a0e, src/config/legalLinks.js):
 *   1. Si el backend da una URL https valida, esa. Con sesion,
 *      `GET /client/capabilities` → `legal`; antes de iniciar sesion,
 *      `GET /public/legal?tenant=<slug>`. Campos: `privacyPolicyUrl` y
 *      `accountDeletionUrl` (este, desde 3a17a0e).
 *   2. Si no la da (null porque la variable no esta configurada, un backend
 *      anterior, o la peticion fallo), la de la marca de esta build:
 *      app.config.js deja en el bundle solo la suya (`extra.brand`,
 *      brands/index.js). Son paginas publicadas por la propia organizacion y
 *      comprobadas; el backend de Production devolvia null mientras tanto y la
 *      app se quedaba sin politica, que las tiendas exigen.
 *
 * Va por la organizacion del usuario (`user.tenant.slug`) y nunca hereda la de
 * otra: si no es la organizacion de esta app, no hay enlace.
 */
import { isSecureHttpsUrl } from "./secure-url.js";

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/-/g, "_");
}

const stringOrNull = (value) => (typeof value === "string" ? value : null);

/** Lo que dijo el backend, o null si no dijo nada. */
function serverAnswer(serverLegal) {
  if (!serverLegal || typeof serverLegal !== "object") return null;
  return {
    privacyPolicyUrl: stringOrNull(serverLegal.privacyPolicyUrl),
    accountDeletionUrl: stringOrNull(serverLegal.accountDeletionUrl),
  };
}

/** La URL del backend si es https valida; si no, la de la marca; si no, null. */
function pickLink(tenantSlug, appBrand, serverLegal, field, brandLink, fallbackName) {
  const slug = normalizeSlug(tenantSlug);
  if (!slug || slug !== normalizeSlug(appBrand?.tenantSlug)) return null;

  const name = typeof brandLink?.name === "string" ? brandLink.name : fallbackName;
  const fromServer = serverAnswer(serverLegal)?.[field];
  if (fromServer && isSecureHttpsUrl(fromServer)) return { name, url: fromServer };

  if (!brandLink || typeof brandLink.url !== "string" || !isSecureHttpsUrl(brandLink.url)) return null;
  return { name, url: brandLink.url };
}

/**
 * `{ name, url }` de la politica de privacidad, o null.
 * @param {string} tenantSlug - la organizacion del usuario (o de la app, antes del login)
 * @param {{ tenantSlug?: string, privacyPolicy?: { name: string, url: string } | null }} appBrand - lib/brand
 * @param {{ privacyPolicyUrl?: string | null } | null} [serverLegal] - capabilities.legal o /public/legal; null = no respondio
 */
export function privacyPolicyFor(tenantSlug, appBrand, serverLegal = null) {
  return pickLink(tenantSlug, appBrand, serverLegal, "privacyPolicyUrl", appBrand?.privacyPolicy, "Privacy Policy");
}

/** `{ name, url }` de la pagina web para pedir el borrado de la cuenta, o null. */
export function accountDeletionLinkFor(tenantSlug, appBrand, serverLegal = null) {
  return pickLink(tenantSlug, appBrand, serverLegal, "accountDeletionUrl", appBrand?.accountDeletion, "Delete your account on the web");
}

/** GET /public/legal de la organizacion de esta app (sin sesion). */
export function publicLegalPath(tenantSlug) {
  return "/public/legal?tenant=" + encodeURIComponent(normalizeSlug(tenantSlug));
}

/**
 * La respuesta de /public/legal solo vale si es de la organizacion pedida;
 * si no, null (como si no hubiera respondido).
 */
export function parsePublicLegal(body, expectedTenantSlug) {
  if (!body || typeof body !== "object") return null;
  if (normalizeSlug(body.tenant) !== normalizeSlug(expectedTenantSlug)) return null;
  return serverAnswer(body);
}
