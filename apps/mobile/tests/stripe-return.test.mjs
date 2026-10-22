import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isStripeReturnUrl, stripeReturnBody } from "../src/lib/stripe-return.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("solo una URL https absoluta vale como vuelta de Stripe", () => {
  assert.equal(isStripeReturnUrl("https://core.theworxoffices.com/mail-items?payment=success"), true);
  assert.equal(isStripeReturnUrl("  https://members.example.com/billing  "), true);

  for (const value of [
    "worxclient://mail-items/abc", // el deep link de produccion
    "hdgclient://billing",
    "exp://192.168.1.5:8081/--/mail-items/abc", // Expo Go
    "worxclient://192.168.1.5:8081/billing", // development build
    "http://core.theworxoffices.com/billing", // sin TLS
    "javascript:alert(1)",
    "data:text/html,hola",
    "/mail-items/abc", // relativa
    "https://user:pass@core.theworxoffices.com/billing", // credenciales dentro
    "https://",
    "",
    null,
    undefined,
    42,
  ]) {
    assert.equal(isStripeReturnUrl(value), false, String(value));
  }
});

test("el cuerpo omite lo que Stripe no acepta y el backend rellena con su portal", () => {
  const deepLink = "worxclient://mail-items/abc";
  assert.deepEqual(stripeReturnBody({ successUrl: deepLink, cancelUrl: deepLink }), {});
  assert.deepEqual(stripeReturnBody({ returnUrl: "exp://10.0.0.2:8081/--/billing" }), {});
  assert.deepEqual(
    stripeReturnBody({ successUrl: "https://a.example.com/ok", cancelUrl: deepLink }),
    { successUrl: "https://a.example.com/ok" }
  );
  // Nunca claves vacias: el schema del backend es .strict() y z.string().url().
  assert.deepEqual(stripeReturnBody({ returnUrl: "" }), {});
  assert.deepEqual(stripeReturnBody(null), {});
});

test("Checkout del reenvio y portal de facturacion pasan por stripeReturnBody", () => {
  const item = read("src/app/(client)/mail-items/[id].jsx");
  assert.match(item, /"\/checkout-session",\s*stripeReturnBody\(\{ successUrl: returnUrl, cancelUrl: returnUrl \}\)/);
  assert.match(item, /WebBrowser\.openAuthSessionAsync\(url, returnUrl\)/);

  const billing = read("src/app/(client)/billing.jsx");
  assert.match(billing, /"\/client\/billing\/payment-portal", stripeReturnBody\(\{ returnUrl \}\)\)/);
  assert.match(billing, /WebBrowser\.openAuthSessionAsync\(url, returnUrl\)/);

  // Ningun otro sitio manda un deep link a Stripe por su cuenta.
  for (const source of [item, billing]) {
    assert.doesNotMatch(source, /checkout-session",\s*\{/);
    assert.doesNotMatch(source, /payment-portal",\s*\{/);
  }
});

test("volver del navegador no da nada por pagado: solo recarga", () => {
  const item = read("src/app/(client)/mail-items/[id].jsx");
  const card = item.slice(item.indexOf("function ForwardPaymentCard"), item.indexOf("function ForwardPaymentCard") + 2000);
  assert.match(card, /onSuccess: async \(\) => \{\s*await onRefresh\?\.\(\);\s*\}/);
  assert.doesNotMatch(card, /paymentStatus:\s*"PAID"/);
});
