/**
 * Una sesion solo vale en la app de su organizacion.
 *
 * El login manda `tenantSlug` (el de la marca, fijado en la build: nunca lo
 * escribe el usuario ni llega de fuera). Sin portal, el backend lo traduce a su
 * tenantId (src/controllers/auth/shared/resolveTenant.js). Pero si el correo no
 * esta en esa organizacion y solo existe en otra, `tenantIdByUniqueEmail`
 * resuelve esa otra: la respuesta seria una sesion valida... de otra
 * organizacion. La app de HDG no puede quedarse con una sesion de The Worx ni
 * al reves, asi que se comprueba `user.tenant.slug` (lo serializa siempre
 * serializeAuthUser) en el login, en /auth/me, al activar la contraseña y con el
 * usuario guardado al arrancar.
 *
 * La app nunca usa ni guarda un tenantId: no lo necesita y no lo inventa.
 */

export const WRONG_ORGANIZATION = "WRONG_ORGANIZATION";

export function tenantSlugOf(user) {
  return String(user?.tenant?.slug || "").trim().toLowerCase() || null;
}

/** Si el usuario es de la organizacion de esta app. Sin slug, no. */
export function isSessionForTenant(user, expectedTenantSlug) {
  const actual = tenantSlugOf(user);
  const expected = String(expectedTenantSlug || "").trim().toLowerCase();
  return Boolean(actual && expected && actual === expected);
}

export function wrongOrganizationMessage(brandName) {
  return `This account isn't part of ${brandName || "this app"}. Sign in with the app of your center.`;
}

/** El cuerpo del login de esta app: la organizacion va siempre, y nunca un tenantId. */
export function loginPayload(email, password, tenantSlug) {
  return { email, password, tenantSlug };
}
