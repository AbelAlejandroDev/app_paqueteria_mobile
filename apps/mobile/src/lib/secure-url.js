/**
 * Que URL puede abrir la app en el navegador del sistema.
 *
 * Solo https absoluta, con host y sin credenciales dentro (`https://user:pass@`).
 * Vale para lo que da el servidor (paginas de pago, facturas) y para los enlaces
 * fijos de la marca (Conference Room, politica de privacidad): un valor que no
 * pase esto no se abre, se oculta.
 */
export function isSecureHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
}

/** La URL lista para abrir, o null si no es segura. */
export function secureHttpsUrlOrNull(value) {
  return isSecureHttpsUrl(value) ? value.trim() : null;
}
