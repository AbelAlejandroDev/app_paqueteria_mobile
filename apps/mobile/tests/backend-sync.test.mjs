import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findPaidForwardAwaitingLabel, describePaidForwardProgress, shouldPollForLabel } from "../src/lib/forward-progress.js";
import { describeCancellationPreview, cancellationStatusLabel } from "../src/lib/membership-cancellation.js";
import { forgotPasswordPayload, isValidEmail, FORGOT_PASSWORD_SENT_MESSAGE } from "../src/lib/forgot-password.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// ── Builds: la API de cada perfil ─────────────────────────────────────────

test("todos los perfiles de EAS apuntan a la API publica por HTTPS (sin localhost ni ngrok)", () => {
  const eas = JSON.parse(read("eas.json"));
  const resolve = (name) => {
    const profile = eas.build[name];
    const parent = profile.extends ? resolve(profile.extends) : {};
    return { ...(parent || {}), ...(profile.env || {}) };
  };
  for (const name of Object.keys(eas.build)) {
    const url = resolve(name).EXPO_PUBLIC_API_URL;
    assert.equal(url, "https://core.theworxoffices.com/api/v1", name);
  }
});

test("la app no lleva URLs de desarrollo ni secretos del servidor", () => {
  const sources = ["src/lib/api.js", "src/context/AuthContext.jsx", "eas.json", "app.config.js"].map(read).join("\n");
  assert.doesNotMatch(sources, /localhost|127\.0\.0\.1|ngrok/);
  assert.doesNotMatch(sources, /sk_(live|test)_|whsec_|PB_CLIENT_SECRET|SMTP_PASS/);
});

test("login y recuperar contrasena mandan la organizacion de la app", () => {
  assert.match(read("src/context/AuthContext.jsx"), /api\.post\("\/auth\/login", \{ email, password, tenantSlug: brand\.tenantSlug \}\)/);
  assert.deepEqual(forgotPasswordPayload("  ana@example.com ", "hdg"), { email: "ana@example.com", tenantSlug: "hdg" });
  assert.deepEqual(forgotPasswordPayload("ana@example.com"), { email: "ana@example.com" });
});

test("recuperar contrasena: validacion y mensaje que no revela si la cuenta existe", () => {
  assert.equal(isValidEmail("ana@example.com"), true);
  assert.equal(isValidEmail("ana@"), false);
  assert.match(FORGOT_PASSWORD_SENT_MESSAGE, /^If an account exists/);
  assert.match(read("src/app/login.jsx"), /router\.push\("\/forgot-password"\)/);
});

// ── Reenvio pagado esperando etiqueta (worker) ───────────────────────────

const forward = (status, details) => ({ type: "FORWARD", status, forwardDetails: details });

test("un reenvio pagado sin etiqueta se detecta; con etiqueta o cerrado, no", () => {
  const paid = forward("PROCESSING", { paymentStatus: "PAID", shipmentStatus: "PENDING_FULFILLMENT", paidAt: new Date().toISOString() });
  assert.equal(findPaidForwardAwaitingLabel([paid]), paid);
  assert.equal(findPaidForwardAwaitingLabel([forward("READY_TO_SHIP", { paymentStatus: "PAID", shipmentStatus: "LABEL_PURCHASED" })]), null);
  assert.equal(findPaidForwardAwaitingLabel([forward("PROCESSING", { paymentStatus: "PAID", trackingNumber: "9400" })]), null);
  assert.equal(findPaidForwardAwaitingLabel([forward("REJECTED", { paymentStatus: "PAID" })]), null);
  assert.equal(findPaidForwardAwaitingLabel([forward("OPEN", { paymentStatus: "READY_FOR_PAYMENT" })]), null);
});

test("al cliente no se le enseñan codigos internos, ni en revision", () => {
  const review = describePaidForwardProgress(forward("PROCESSING", { paymentStatus: "PAID", shipmentStatus: "EXCEPTION", failureCode: "FORWARD_LABEL_PURCHASE_UNCERTAIN" }));
  assert.equal(review.needsReview, true);
  assert.doesNotMatch(review.description, /FORWARD_|UNCERTAIN|Pitney|EXCEPTION/);
  assert.match(review.description, /don't need to pay again/);
});

test("se sondea solo mientras se prepara y solo los primeros minutos", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const preparing = (minsAgo, shipmentStatus = "PENDING_FULFILLMENT") =>
    [forward("PROCESSING", { paymentStatus: "PAID", shipmentStatus, paidAt: new Date(now - minsAgo * 60000).toISOString() })];
  assert.equal(shouldPollForLabel(preparing(1), now), true);
  assert.equal(shouldPollForLabel(preparing(11), now), false);
  assert.equal(shouldPollForLabel(preparing(1, "EXCEPTION"), now), false);
  assert.equal(shouldPollForLabel([], now), false);
});

// ── Baja de la membresia ─────────────────────────────────────────────────

test("baja: se pintan las fechas del centro tal cual y se avisa si hay un cobro mas", () => {
  const view = describeCancellationPreview({
    canRequest: true, noticePeriodDays: 15, willBeChargedAgain: true,
    display: { effectiveAt: "December 5, 2026", nextChargeAt: "November 5, 2026" },
  });
  assert.equal(view.canRequest, true);
  assert.ok(view.lines.some((l) => l.includes("December 5, 2026")));
  assert.ok(view.lines.some((l) => l.includes("November 5, 2026") && l.includes("15 days")));
});

test("baja: con una peticion viva no se ofrece otra; una rechazada si deja pedir de nuevo", () => {
  const live = describeCancellationPreview({ canRequest: false, existingRequest: { status: "PENDING", display: { effectiveAt: "December 5, 2026" } } });
  assert.equal(live.kind, "existing");
  assert.equal(live.canRequest, false);
  assert.equal(live.status, cancellationStatusLabel("PENDING"));
  const again = describeCancellationPreview({ canRequest: true, display: {}, existingRequest: { status: "REJECTED" } });
  assert.equal(again.canRequest, true);
});

test("baja: si el servidor dice que no se puede, se muestra su motivo", () => {
  const view = describeCancellationPreview({ canRequest: false, message: "No active subscription." });
  assert.deepEqual(view, { kind: "unavailable", lines: ["No active subscription."], canRequest: false });
});
