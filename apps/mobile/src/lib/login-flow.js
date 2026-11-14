import { isSessionForTenant, loginPayload, WRONG_ORGANIZATION } from "./session-tenant.js";

/**
 * POST /auth/login de esta app, sin React (lo usa AuthContext; se prueba solo).
 *
 * Manda `tenantSlug` (el de la build) y nunca un tenantId: sin portal, el
 * backend lo resuelve con su base de datos (resolveTenant.js); sin ninguno de
 * los dos responde 400 "tenantId required", que es lo que se veia al entrar a
 * core.hdgexecutivesuites.com sin contexto.
 *
 * Devuelve { ok: true, data } con una sesion de ESTA organizacion, o
 * { ok: false, code: WRONG_ORGANIZATION } si el backend resolvio otra: en ese
 * caso nada se guarda (ni tokens ni usuario). Los errores HTTP se lanzan.
 */
export async function requestLogin(api, { email, password, tenantSlug }) {
  const response = await api.post("/auth/login", loginPayload(email, password, tenantSlug));
  const data = response.data || {};
  if (!isSessionForTenant(data.user, tenantSlug)) return { ok: false, code: WRONG_ORGANIZATION };
  return { ok: true, data };
}
