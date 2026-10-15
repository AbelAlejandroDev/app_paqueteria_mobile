/**
 * Lo que manda "Olvide mi contrasena" al servidor (POST /auth/forgot-password).
 *
 * Va con la organizacion de esta app: el servidor la deduciria del dominio, y
 * core.theworxoffices.com es de The Worx, asi que un cliente de HDG nunca
 * recibiria su enlace.
 */
export function forgotPasswordPayload(email, tenantSlug) {
  const payload = { email: String(email || "").trim() };
  if (tenantSlug) payload.tenantSlug = tenantSlug;
  return payload;
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

/** El mismo mensaje exista o no la cuenta: no se confirma quien es cliente. */
export const FORGOT_PASSWORD_SENT_MESSAGE =
  "If an account exists for that email, we've sent a link to reset your password. Check your inbox and spam folder.";
