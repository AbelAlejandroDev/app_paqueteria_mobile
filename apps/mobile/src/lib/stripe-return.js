/**
 * Las URL de vuelta que la app manda a Stripe: el Checkout del reenvio
 * (successUrl / cancelUrl) y el portal de facturacion (returnUrl).
 *
 * El deep link de la app (worxclient://..., o exp://... en desarrollo) no se
 * manda: Stripe espera paginas web y el backend lo pasa tal cual, que es la
 * sospecha detras del "Stripe 400 - Not a valid URL". Sin URL, el backend usa
 * la suya: el portal de miembros del centro del cliente, por https.
 *
 * Solo pasa una URL https absoluta, sin usuario ni contrasena dentro. Volver
 * por ella no da nada por pagado: eso lo decide el webhook de Stripe, y la
 * pantalla solo recarga al cerrarse el navegador.
 */

export function isStripeReturnUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (!url.hostname || url.username || url.password) return false;
  return true;
}

/**
 * El cuerpo de la peticion con solo las URL que Stripe acepta. Lo demas se
 * omite (no se manda vacio): el backend rellena lo que falte con su portal.
 */
export function stripeReturnBody(urls) {
  const body = {};
  for (const [key, value] of Object.entries(urls || {})) {
    if (isStripeReturnUrl(value)) body[key] = value.trim();
  }
  return body;
}
