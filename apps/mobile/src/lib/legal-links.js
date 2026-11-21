/**
 * Los documentos legales que cada organizacion publica en su propia web.
 *
 * Solo enlaces: el texto vive y se mantiene en esa web, no en la app.
 *
 * De donde sale el enlace (backend 51ee69d, HDG_MOBILE_PRODUCTION_HANDOFF §3):
 *   1. El backend manda. Con sesion, `GET /client/capabilities` → `legal`;
 *      antes de iniciar sesion, `GET /public/legal?tenant=<slug>`. Si responde
 *      `privacyPolicyUrl: null` (la organizacion no la tiene configurada) NO hay
 *      enlace: ni uno roto ni el de otra organizacion.
 *   2. Solo si el backend no dice nada (uno anterior a 51ee69d, sin `legal`, o
 *      la peticion fallo), la de la marca de esta build: app.config.js deja en
 *      el bundle solo la suya (`extra.brand.privacyPolicy`, brands/index.js).
 *
 * Va por la organizacion del usuario (`user.tenant.slug`) y nunca hereda la de
 * otra: si no es la organizacion de esta app, no hay enlace.
 */
import { isSecureHttpsUrl } from "./secure-url.js";

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/-/g, "_");
}

/** Lo que dijo el backend: `{ privacyPolicyUrl }`, o null si no dijo nada. */
function serverAnswer(serverLegal) {
  if (!serverLegal || typeof serverLegal !== "object") return null;
  return { privacyPolicyUrl: typeof serverLegal.privacyPolicyUrl === "string" ? serverLegal.privacyPolicyUrl : null };
}

/**
 * `{ name, url }` de la politica de privacidad, o null.
 * @param {string} tenantSlug - la organizacion del usuario (o de la app, antes del login)
 * @param {{ tenantSlug?: string, privacyPolicy?: { name: string, url: string } | null }} appBrand - lib/brand
 * @param {{ privacyPolicyUrl?: string | null } | null} [serverLegal] - capabilities.legal o /public/legal; null = no respondio
 */
export function privacyPolicyFor(tenantSlug, appBrand, serverLegal = null) {
  const slug = normalizeSlug(tenantSlug);
  if (!slug || slug !== normalizeSlug(appBrand?.tenantSlug)) return null;

  const name = typeof appBrand?.privacyPolicy?.name === "string" ? appBrand.privacyPolicy.name : "Privacy Policy";
  const answer = serverAnswer(serverLegal);
  if (answer) {
    // El backend manda, tambien cuando dice que no hay.
    return answer.privacyPolicyUrl && isSecureHttpsUrl(answer.privacyPolicyUrl) ? { name, url: answer.privacyPolicyUrl } : null;
  }

  const policy = appBrand?.privacyPolicy;
  if (!policy || typeof policy.url !== "string" || !isSecureHttpsUrl(policy.url)) return null;
  return { name, url: policy.url };
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
