/**
 * Autorizacion de cobro automatico y cobro iniciado por el centro (HDG).
 * Contrato: docs/hdg-cartas-cobro-automatico.md (version
 * HDG-FWD-AUTOCHARGE-2026-11-24.3, backend 103ddd7).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  AUTO_CHARGE_CONSENT_PATH,
  autoChargeConsentEnabled,
  collectPendingReason,
  consentErrorOutcome,
  consentPlatformHeaders,
  describeConsent,
  estimatedForwardCharge,
  formatConsentAmount,
  grantConsentBody,
  isOfferAccepted,
  REVOKE_CONSENT_BODY,
  staffChargeDecision,
} from "../src/lib/auto-charge-consent.js";
import { interpretPrepareResponse } from "../src/lib/zoho-forward-payment.js";
import { forwardPaymentError } from "../src/lib/forward-payment.js";
import { describeForwardStage } from "../src/lib/forward-stage.js";
import { isStaffPreparedForward } from "../src/lib/forward-form.js";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const VERSION = "HDG-FWD-AUTOCHARGE-2026-11-24.3";
// El importe sale SIEMPRE de la API. 7500 es el tope elegido para HDG Sandbox,
// solo como dato de entrada de las pruebas; 5000 es el del ejemplo del contrato.
const offerResponse = (overrides = {}) => ({
  available: true,
  valid: false,
  enabled: false,
  missing: "CLIENT_CONSENT",
  maxOfferedCents: 7500,
  maxAmountCents: null,
  currency: "USD",
  version: VERSION,
  text: "I authorize this center to automatically charge my saved card up to $75.00 USD per shipment for letter and large envelope forwarding.",
  authorization: null,
  ...overrides,
});
const authorizedResponse = (overrides = {}) => ({
  available: true,
  valid: true,
  enabled: true,
  missing: null,
  maxOfferedCents: 7500,
  maxAmountCents: 7500,
  currency: "USD",
  version: VERSION,
  text: "I authorize … up to $75.00 USD per shipment …",
  authorization: {
    id: "auth-1",
    centerId: "hollywood",
    maxAmountCents: 7500,
    currency: "USD",
    grantedAt: "2026-11-24T18:00:00.000Z",
    textVersion: VERSION,
    text: "I authorize … up to $75.00 USD per shipment …",
  },
  ...overrides,
});
const axiosError = (status, data) => ({ response: { status, data } });

// ── GET: estados ────────────────────────────────────────────────────────────

test("CLIENT_CONSENT: se ofrece la casilla con el texto completo y el maximo de la API", () => {
  const consent = describeConsent(offerResponse());
  assert.equal(consent.state, "not-authorized");
  assert.equal(consent.valid, false);
  assert.equal(consent.canGrant, true);
  assert.equal(consent.offer.text, offerResponse().text, "el texto tal cual");
  assert.equal(consent.offer.maxOfferedCents, 7500);
  assert.equal(consent.offer.amountLabel, "$75.00 USD");
  assert.equal(consent.offer.version, VERSION);
  assert.equal(consent.canRevoke, false, "no hay nada que retirar");

  // Otro tope (el del ejemplo): la app ensena lo que diga la API, sin constante.
  assert.equal(describeConsent(offerResponse({ maxOfferedCents: 5000 })).offer.amountLabel, "$50.00 USD");
});

test("autorizacion vigente: el maximo EFECTIVO de la raiz, con su moneda, y se puede retirar", () => {
  const consent = describeConsent(authorizedResponse({ maxAmountCents: 6000 }));
  assert.equal(consent.state, "authorized");
  assert.equal(consent.valid, true);
  assert.equal(consent.effectiveMaxCents, 6000, "el menor del aceptado y el tope: lo da la raiz");
  assert.equal(consent.effectiveMaxLabel, "$60.00 USD");
  assert.equal(consent.authorization.maxAmountCents, 7500, "el aceptado en su dia, aparte");
  assert.equal(consent.canGrant, false, "no se ofrece otra alta encima");
  assert.equal(consent.canRevoke, true);
});

test("valid sin maximo efectivo o sin enabled no cuenta como autorizada", () => {
  assert.equal(describeConsent(authorizedResponse({ maxAmountCents: null })).valid, false);
  assert.equal(describeConsent(authorizedResponse({ enabled: false })).valid, false);
  assert.equal(describeConsent(authorizedResponse({ maxAmountCents: 0 })).valid, false);
  assert.equal(describeConsent(authorizedResponse({ maxAmountCents: "7500" })).valid, false, "solo enteros");
});

test("MAX_NOT_CONFIGURED: no se ofrece el alta; si hay una anterior, se puede retirar", () => {
  const none = describeConsent(offerResponse({ missing: "MAX_NOT_CONFIGURED", maxOfferedCents: null, text: null }));
  assert.equal(none.state, "unavailable");
  assert.equal(none.canGrant, false);
  assert.equal(none.canRevoke, false);

  // Aunque viniera texto e importe, sin tope configurado no hay alta.
  const withText = describeConsent(offerResponse({ missing: "MAX_NOT_CONFIGURED" }));
  assert.equal(withText.canGrant, false);

  const previous = describeConsent(
    offerResponse({ missing: "MAX_NOT_CONFIGURED", maxOfferedCents: null, authorization: authorizedResponse().authorization })
  );
  assert.equal(previous.canGrant, false);
  assert.equal(previous.canRevoke, true, "retirarla sigue siendo posible");
});

test("available: false (The Worx): sin alta; con una autorizacion antigua, solo retirarla", () => {
  assert.equal(describeConsent(offerResponse({ available: false })).canGrant, false);
  const old = describeConsent(offerResponse({ available: false, authorization: authorizedResponse().authorization }));
  assert.equal(old.canGrant, false);
  assert.equal(old.canRevoke, true);
});

test("CONSENT_VERSION_OUTDATED y CENTER_CHANGED: hay que aceptar de nuevo, y la anterior se puede retirar", () => {
  const outdated = describeConsent(offerResponse({ missing: "CONSENT_VERSION_OUTDATED", authorization: authorizedResponse().authorization }));
  assert.equal(outdated.state, "outdated");
  assert.equal(outdated.canGrant, true);
  assert.equal(outdated.canRevoke, true);
  assert.equal(outdated.valid, false, "la vieja no vale para cobrar");

  const moved = describeConsent(offerResponse({ missing: "CENTER_CHANGED", authorization: authorizedResponse().authorization }));
  assert.equal(moved.state, "center-changed");
  assert.equal(moved.canGrant, true);
});

test("oferta incompleta (sin texto, version o importe) o missing desconocido: no se ofrece", () => {
  assert.equal(describeConsent(offerResponse({ text: "" })).canGrant, false, "sin texto no hay nada que aceptar");
  assert.equal(describeConsent(offerResponse({ version: null })).canGrant, false);
  assert.equal(describeConsent(offerResponse({ maxOfferedCents: null })).canGrant, false);
  assert.equal(describeConsent(offerResponse({ currency: null })).canGrant, false);
  assert.equal(describeConsent(offerResponse({ missing: "SOMETHING_NEW" })).canGrant, false);
  assert.equal(describeConsent(null).state, "unknown");
  assert.equal(describeConsent(undefined).canRevoke, false);
});

// ── Casilla: nunca aceptada sola ────────────────────────────────────────────

test("la casilla empieza desmarcada y se desmarca si cambia texto, version, importe o moneda", () => {
  const offer = describeConsent(offerResponse()).offer;
  assert.equal(isOfferAccepted(null, offer), false, "nunca viene marcada");
  assert.equal(isOfferAccepted(offer.key, offer), true);

  for (const change of [
    { text: offerResponse().text + " Updated." },
    { version: "HDG-FWD-AUTOCHARGE-2026-12-01.4" },
    { maxOfferedCents: 5000 },
    { currency: "EUR" },
  ]) {
    const next = describeConsent(offerResponse(change)).offer;
    assert.equal(isOfferAccepted(offer.key, next), false, JSON.stringify(change));
  }
  assert.equal(isOfferAccepted(offer.key, null), false);
});

test("una tarjeta guardada no es una autorizacion: nada en la app la deduce de billing", () => {
  const lib = read("src/lib/auto-charge-consent.js");
  const hook = read("src/lib/use-auto-charge-consent.js");
  for (const source of [lib, hook]) {
    assert.ok(!/cards|savedCard|last4|billing\/payment/.test(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "solo GET/PUT del consentimiento");
  }
});

test("el maximo no esta escrito en el codigo: ni 7500 ni $75", () => {
  const files = [
    "src/lib/auto-charge-consent.js",
    "src/lib/use-auto-charge-consent.js",
    "src/components/common/auto-charge-consent-offer.jsx",
    "src/app/(client)/settings/forwarding-charges.jsx",
    "src/components/common/letter-forward-sheet.jsx",
    "src/app/(client)/mail-items/[id].jsx",
    "brands/index.js",
  ];
  for (const file of files) {
    // Sin comentarios: el codigo, que es lo que decide el importe.
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    // (5000 no se busca: [id].jsx sondea la etiqueta cada 5000 ms.)
    assert.ok(!/\b7500\b|\$75(\.00)?\b/.test(code), file);
  }
});

// ── PUT ─────────────────────────────────────────────────────────────────────

test("alta: la version y el importe de la oferta MOSTRADA; retirada: { enabled: false }", () => {
  const offer = describeConsent(offerResponse()).offer;
  assert.deepEqual(grantConsentBody(offer), { enabled: true, acceptedVersion: VERSION, maxAmountCents: 7500 });
  assert.throws(() => grantConsentBody(null), /AUTO_CHARGE_OFFER_INCOMPLETE/);
  assert.throws(() => grantConsentBody({ version: VERSION, maxOfferedCents: 0 }), /AUTO_CHARGE_OFFER_INCOMPLETE/);
  assert.deepEqual(REVOKE_CONSENT_BODY, { enabled: false });
  assert.equal(AUTO_CHARGE_CONSENT_PATH, "/client/forwarding/auto-charge-consent");
});

test("x-client-platform solo con ios/android", () => {
  assert.deepEqual(consentPlatformHeaders("ios"), { "x-client-platform": "ios" });
  assert.deepEqual(consentPlatformHeaders("android"), { "x-client-platform": "android" });
  assert.deepEqual(consentPlatformHeaders("web"), {});
});

test("errores del alta: cada codigo del contrato, siempre releyendo la oferta", () => {
  const cases = [
    [axiosError(409, { code: "AUTO_CHARGE_CONSENT_VERSION_MISMATCH", currentVersion: "x.4" }), "outdated"],
    [axiosError(409, { code: "AUTO_CHARGE_MAX_ABOVE_CAP", maxOfferedCents: 5000 }), "cap-changed"],
    [axiosError(400, { code: "AUTO_CHARGE_MAX_REQUIRED" }), "invalid"],
    [axiosError(409, { code: "AUTO_CHARGE_NOT_AVAILABLE", missing: "MAX_NOT_CONFIGURED" }), "unavailable"],
    [axiosError(400, { error: "Invalid body" }), "invalid"],
    [axiosError(503, {}), "temporary"],
    [new Error("Network Error"), "unknown"],
  ];
  for (const [error, kind] of cases) {
    const outcome = consentErrorOutcome(error);
    assert.equal(outcome.kind, kind);
    assert.equal(outcome.refetch, true);
    assert.ok(outcome.message.length > 10);
  }
});

test("revocacion: la respuesta del PUT (mismo contrato que el GET) deja de estar autorizada y es idempotente", () => {
  const afterRevoke = describeConsent(
    offerResponse({ authorization: null, valid: false, enabled: false, maxAmountCents: null })
  );
  assert.equal(afterRevoke.valid, false);
  assert.equal(afterRevoke.state, "not-authorized", "se puede volver a dar");
  // Retirar otra vez, con el tope apagado: sigue sin autorizacion y sin error.
  const again = describeConsent(offerResponse({ missing: "MAX_NOT_CONFIGURED", maxOfferedCents: null }));
  assert.equal(again.valid, false);
  assert.equal(again.canGrant, false);
});

test("solo se guarda lo que confirmo la API: setQueryData con la respuesta del PUT, nunca un valor propio", () => {
  const hook = read("src/lib/use-auto-charge-consent.js");
  assert.ok(hook.includes("queryClient.setQueryData(queryKey, data)"));
  assert.equal((hook.match(/setQueryData\(/g) || []).length, 1);
  assert.ok(/onSuccess: store/.test(hook) && /onError: \(\) => queryClient\.invalidateQueries\(\{ queryKey \}\)/.test(hook));

  const screen = read("src/app/(client)/settings/forwarding-charges.jsx");
  assert.ok(screen.includes("const result = describeConsent(await grant.mutateAsync(offer));"));
  assert.ok(/if \(result\.valid\) \{\s*setConfirmation/.test(screen), "solo se confirma con valid de la API");
  assert.ok(screen.includes('useState(null);'), "casilla desmarcada al entrar");
  assert.ok(/disabled=\{!checked \|\| busy\}/.test(screen), "sin casilla no se puede autorizar");
});

test("Settings: revocar pide confirmacion y confirma al terminar", () => {
  const screen = read("src/app/(client)/settings/forwarding-charges.jsx");
  assert.ok(screen.includes('"Withdraw authorization?"'));
  assert.ok(screen.includes('Alert.alert("Authorization withdrawn", message)'));
  assert.ok(screen.includes("consent.canRevoke ?"), "retirar tambien una no valida");
  assert.ok(screen.includes("consent.effectiveMaxLabel"), "maximo efectivo con moneda");
  assert.ok(screen.includes('label="Currency"'));
  assert.ok(screen.includes('<Redirect href="/settings" />'), "otra marca no entra");
});

// La hoja de reenvio ya no acepta nada (tests/forward-submit.test.mjs): el alta
// vive solo en Settings → Automatic Forwarding Charges.

// ── Cobro iniciado por el centro ────────────────────────────────────────────

const consentValid = describeConsent(authorizedResponse());
const ready = (overrides = {}) => ({ paymentStatus: "READY_FOR_PAYMENT", quotedAmountCents: 943, ...overrides });

test("LETTER y LARGE_ENVELOPE: autorizacion valida y total <= maximo -> lo cobra el centro, sin Review & Pay", () => {
  for (const itemType of ["LETTER", "LARGE_ENVELOPE"]) {
    assert.equal(isStaffPreparedForward(itemType), true);
    const decision = staffChargeDecision({ itemType, details: ready(), consent: consentValid, feeCents: 500 });
    assert.equal(decision.mode, "staff-charge", itemType);
    assert.equal(decision.totalCents, 1443, "Shipping & Handling + Mail Forwarding Fee");
    assert.equal(decision.maxLabel, "$75.00 USD");
    assert.deepEqual(decision.charge, { shippingAndHandling: 943, mailForwardingFee: 500, total: 1443 });
  }
});

test("maximo: igual entra; un centavo por encima, pago manual", () => {
  assert.equal(staffChargeDecision({ itemType: "LETTER", details: ready({ quotedAmountCents: 7000 }), consent: consentValid, feeCents: 500 }).mode, "staff-charge");
  const over = staffChargeDecision({ itemType: "LETTER", details: ready({ quotedAmountCents: 7001 }), consent: consentValid, feeCents: 500 });
  assert.deepEqual(over, { mode: "manual", reason: "LIMIT_EXCEEDED" });
});

test("recotizado: repricedAmount ?? quotedAmountCents, como el backend (acceptedRepricedAmount no cuenta)", () => {
  assert.equal(estimatedForwardCharge(ready({ repricedAmount: 8000 }), 500).total, 8500);
  // forwardingPayments.amountForPayment: aceptar una subida no le gana a un precio vigente mas bajo.
  assert.equal(estimatedForwardCharge(ready({ acceptedRepricedAmount: 1200 }), 500).total, 1443);
  assert.equal(estimatedForwardCharge(ready({ repricedAmount: 900, acceptedRepricedAmount: 1200 }), 500).total, 1400);
  assert.equal(
    staffChargeDecision({ itemType: "LETTER", details: ready({ repricedAmount: 8000 }), consent: consentValid, feeCents: 500 }).reason,
    "LIMIT_EXCEEDED"
  );
});

test("sin autorizacion (o revocada): pago manual", () => {
  const notAuthorized = describeConsent(offerResponse());
  assert.equal(staffChargeDecision({ itemType: "LETTER", details: ready(), consent: notAuthorized, feeCents: 500 }).reason, "NOT_AUTHORIZED");
  assert.equal(staffChargeDecision({ itemType: "LETTER", details: ready(), consent: null, feeCents: 500 }).reason, "NOT_AUTHORIZED");
  const outdated = describeConsent(offerResponse({ missing: "CONSENT_VERSION_OUTDATED", authorization: authorizedResponse().authorization }));
  assert.equal(staffChargeDecision({ itemType: "LETTER", details: ready(), consent: outdated, feeCents: 500 }).mode, "manual");
});

test("sin total (falta el fee o la tarifa): Review & Pay", () => {
  assert.equal(staffChargeDecision({ itemType: "LETTER", details: ready(), consent: consentValid, feeCents: null }).reason, "TOTAL_UNKNOWN");
  assert.equal(staffChargeDecision({ itemType: "LETTER", details: ready({ quotedAmountCents: null }), consent: consentValid, feeCents: 500 }).reason, "TOTAL_UNKNOWN");
  assert.equal(estimatedForwardCharge(ready({ quotedAmountCents: 0 }), 500).total, null, "0 no es un precio");
});

test("moneda: los campos reales de forwardDetails (no hay `currency`); sin ninguno no se compara", () => {
  const decide = (details) => staffChargeDecision({ itemType: "LETTER", details: ready(details), consent: consentValid, feeCents: 500 });
  assert.equal(decide({ quotedCurrency: "EUR" }).reason, "CURRENCY_MISMATCH");
  assert.equal(decide({ quotedCurrency: "USD", repricedCurrency: "EUR" }).reason, "CURRENCY_MISMATCH", "la recotizada manda");
  assert.equal(decide({ quotedCurrency: "EUR", acceptedRepricedCurrency: "USD" }).mode, "staff-charge", "la aceptada manda (currencyForPayment)");
  assert.equal(decide({ quotedCurrency: "usd" }).mode, "staff-charge");
  assert.equal(decide({ currency: "EUR" }).mode, "staff-charge", "un campo que el backend no manda no se lee");
  assert.equal(decide({}).mode, "staff-charge", "sin moneda: el backend cobra en USD y vuelve a comprobarla");
});

test("otro estado: pago manual", () => {
  for (const paymentStatus of ["NOT_STARTED", "RECONFIRMATION_REQUIRED", "PAYMENT_PENDING", "FAILED", "PAID"]) {
    assert.equal(staffChargeDecision({ itemType: "LETTER", details: ready({ paymentStatus }), consent: consentValid, feeCents: 500 }).reason, "STATUS", paymentStatus);
  }
});

test("PACKAGE: nunca lo cobra el centro, aunque haya autorizacion", () => {
  const decision = staffChargeDecision({ itemType: "PACKAGE", details: ready(), consent: consentValid, feeCents: 500 });
  assert.deepEqual(decision, { mode: "manual", reason: "NOT_ELIGIBLE" });
  // El hook ni consulta para PACKAGE ni fuera de Zoho.
  const hook = read("src/lib/use-auto-charge-consent.js");
  assert.ok(hook.includes('const relevant = Boolean(details) && staffPrepared && paymentMode === FORWARD_PAYMENT_ZOHO_HOSTED && details.paymentStatus === "READY_FOR_PAYMENT";'));
});

// ── Estados del pago en la app ──────────────────────────────────────────────

const request = (details, status = "OPEN") => ({ type: "FORWARD", status, forwardDetails: details });

test("READY_FOR_PAYMENT con cobro del centro: aviso con el maximo y sin accion de pago", () => {
  const decision = staffChargeDecision({ itemType: "LETTER", details: ready(), consent: consentValid, feeCents: 500 });
  const stage = describeForwardStage(request(ready()), { staffPrepared: true, staffCharge: decision });
  assert.equal(stage.key, "staff-charge");
  assert.equal(stage.title, "Your center will charge your saved card");
  assert.equal(stage.description, "Up to $75.00 USD. You will be notified.");
  assert.equal(stage.action, null, "no se pide pagar");

  const manual = describeForwardStage(request(ready()), { staffPrepared: true, staffCharge: { mode: "manual", reason: "LIMIT_EXCEEDED" } });
  assert.equal(manual.key, "payment-pending");
  assert.equal(manual.action, "pay");
});

test("pago rechazado (FAILED): tarjeta rechazada con las dos salidas para cartas; PACKAGE como antes", () => {
  const letter = describeForwardStage(request({ paymentStatus: "FAILED", quotedAmountCents: 943 }), { staffPrepared: true });
  assert.equal(letter.title, "Card declined");
  assert.match(letter.description, /Update your card/);
  assert.match(letter.description, /pay in the app/);
  assert.equal(letter.action, "update-payment");

  const pkg = describeForwardStage(request({ paymentStatus: "FAILED", quotedAmountCents: 943 }));
  assert.equal(pkg.title, "Payment declined");
  assert.equal(pkg.description, "The payment did not go through. Review your payment method, then try again.");
});

test("PACKAGE sin opciones: describeForwardStage da exactamente lo de antes", () => {
  const cases = [
    [{ paymentStatus: "READY_FOR_PAYMENT", quotedAmountCents: 943 }, "payment-pending"],
    [{ paymentStatus: "PAYMENT_PENDING", quotedAmountCents: 943 }, "payment-processing"],
    [{ paymentStatus: "PAID", quotedAmountCents: 943 }, "label-in-preparation"],
    [{ paymentStatus: "NOT_STARTED" }, "staff-preparation"],
  ];
  for (const [details, key] of cases) assert.equal(describeForwardStage(request(details)).key, key);
});

test("estado incierto: prepare-payment sin pagina y COLLECT_IN_PROGRESS/UNCONFIRMED -> consultar, nunca otro intento", () => {
  for (const reason of ["COLLECT_IN_PROGRESS", "COLLECT_UNCONFIRMED"]) {
    assert.deepEqual(interpretPrepareResponse({ paymentUrl: null, reason }), { kind: "collect-pending", reason });
    assert.deepEqual(interpretPrepareResponse({ paymentUrl: null, autoCharge: { reason } }), { kind: "collect-pending", reason });
    assert.equal(collectPendingReason({ paymentUrl: null, reason }), reason);
  }
  // Con pagina, o con otro motivo, sigue como antes.
  assert.equal(collectPendingReason({ paymentUrl: "https://billing.zoho.com/pay/1", reason: "COLLECT_IN_PROGRESS" }), null);
  assert.equal(interpretPrepareResponse({ paymentUrl: null }).kind, "invalid");
  assert.equal(interpretPrepareResponse({ paid: true }).kind, "paid");
});

test("respuesta real de Sandbox (103ddd7): GET del consentimiento sin autorizar", () => {
  // Tal como la confirmo el VPS; el texto se abrevia, los campos son los reales.
  const consent = describeConsent({
    available: true,
    enabled: false,
    valid: false,
    missing: "CLIENT_CONSENT",
    maxOfferedCents: 7500,
    maxAmountCents: null,
    currency: "USD",
    version: "HDG-FWD-AUTOCHARGE-2026-11-24.3",
    text: "I authorize HDG Executive Suites to automatically charge … up to $75.00 USD per shipment …",
    authorization: null,
  });
  assert.equal(consent.state, "not-authorized");
  assert.equal(consent.canGrant, true);
  assert.equal(consent.canRevoke, false);
  assert.equal(consent.valid, false, "sin autorizar: nada lo cobra el centro");
  assert.equal(consent.offer.amountLabel, "$75.00 USD");
  assert.deepEqual(grantConsentBody(consent.offer), { enabled: true, acceptedVersion: "HDG-FWD-AUTOCHARGE-2026-11-24.3", maxAmountCents: 7500 });
});

test("respuesta real de prepare-payment (103ddd7): 200, PAYMENT_PENDING, paymentUrl null y autoCharge.reason COLLECT_*", () => {
  for (const reason of ["COLLECT_IN_PROGRESS", "COLLECT_UNCONFIRMED"]) {
    // Sin desglose, sin expiresAt, sin invoiceNumber: nada de eso se exige.
    const body = { paymentStatus: "PAYMENT_PENDING", paymentUrl: null, autoCharge: { attempted: false, paid: false, reason } };
    assert.deepEqual(interpretPrepareResponse(body), { kind: "collect-pending", reason }, reason);
    // Tambien si paymentUrl ni viene.
    assert.deepEqual(interpretPrepareResponse({ paymentStatus: "PAYMENT_PENDING", autoCharge: { reason } }), { kind: "collect-pending", reason });
  }
  // PAYMENT_PENDING no es "pagado".
  assert.notEqual(interpretPrepareResponse({ paymentStatus: "PAYMENT_PENDING", paymentUrl: null, autoCharge: { reason: "COLLECT_IN_PROGRESS" } }).kind, "paid");
  // Otro motivo sin pagina no se toma como cobro en curso.
  assert.equal(interpretPrepareResponse({ paymentStatus: "PAYMENT_PENDING", paymentUrl: null, autoCharge: { reason: "DECLINED" } }).kind, "invalid");
});

test("payment-status sin autoCharge.reason: se sigue consultando y no se desbloquea el pago", async () => {
  const { interpretPaymentStatus } = await import("../src/lib/forward-payment.js");
  const reading = interpretPaymentStatus({ provider: "ZOHO", paymentStatus: "PAYMENT_PENDING", shipmentStatus: "NOT_CREATED", chargeStatus: "INVOICE_OPEN", paymentLinkExpired: false });
  assert.equal(reading.state, "pending");
  assert.equal(reading.terminal, false, "se sigue preguntando");

  const zoho = read("src/components/common/zoho-forward-payment-card.jsx");
  // Solo FAILED suelta el bloqueo; una pagina caducada no (el collect puede seguir vivo).
  assert.ok(/if \(reading\.state === "failed"\) \{\s*setCollectPending\(false\);/.test(zoho));
  assert.ok(!/link-expired"[^\n]*\n[^\n]*\n[^\n]*setCollectPending\(false\)/.test(zoho));
  assert.equal((zoho.match(/setCollectPending\(false\)/g) || []).length, 1);
  // Cada intento de pago pasa por el candado del collect; abrir la pagina de la tarjeta no.
  for (const action of ["review", "confirmReprice", "payWithSavedCard", "openSecurePage"]) {
    assert.ok(zoho.includes("guardedPayment(" + action + ")"), action);
    assert.ok(!zoho.includes("guarded(" + action + ")"), action);
  }
  assert.ok(zoho.includes("const guardedPayment = (mutation, variables) => (collectPending ? null : guarded(mutation, variables));"));
  // Consultar sigue disponible con el bloqueo puesto.
  assert.ok(zoho.includes("Check payment status"));
});

test("409 COLLECT_IN_PROGRESS / COLLECT_UNCONFIRMED: no reintentable, consultar el estado", () => {
  for (const code of ["COLLECT_IN_PROGRESS", "COLLECT_UNCONFIRMED"]) {
    const outcome = forwardPaymentError(axiosError(409, { code }));
    assert.equal(outcome.retryable, false, code);
    assert.equal(outcome.checkStatus, true, code);
    assert.match(outcome.message, /Nothing new was charged/);
  }
  // Los de siempre no cambian.
  assert.equal(forwardPaymentError(axiosError(409, { code: "ZOHO_PAYMENT_IN_PROGRESS" })).retryable, true);
  assert.equal(forwardPaymentError(axiosError(503, { code: "ZOHO_OUTCOME_UNCERTAIN" })).retryable, false);
});

test("sin pagos duplicados: con cobro del centro no hay boton de pago; procesando, solo consultar", () => {
  const detail = read("src/app/(client)/mail-items/[id].jsx");
  // Cobro del centro: solo "Pay now instead", y con confirmacion.
  assert.ok(detail.includes(") : centerCharges ? ("));
  assert.ok(detail.includes('"Pay now instead?"'));
  assert.ok(detail.includes("Pay now instead"));
  assert.ok(detail.includes("waitingForCapabilities || deciding"), "mientras se decide, nada que pulsar");
  assert.ok(detail.includes('processing={staffPrepared && details.paymentStatus === "PAYMENT_PENDING"}'));
  assert.ok(detail.includes('declinedByCenter={staffPrepared && details.paymentStatus === "FAILED"}'));

  const zoho = read("src/components/common/zoho-forward-payment-card.jsx");
  // Solo el backend bloquea (collect vivo); PAYMENT_PENDING por si solo no.
  assert.ok(zoho.includes("const [collectPending, setCollectPending] = useState(false);"));
  assert.ok(zoho.includes("quoteBlocked || collectPending ||"), "un collect vivo bloquea Review/Pay");
  assert.ok(!/const blocked = [^\n]*processing/.test(zoho), "PAYMENT_PENDING no bloquea por si solo");
  assert.ok(zoho.includes("(collectPending || processing) && !status.waiting"), "en proceso, siempre se puede consultar");
  assert.ok(zoho.includes("Check payment status"));
  assert.ok(/if \(result\.kind === "collect-pending"\) \{\s*enterCollectPending\(\);/.test(zoho));
  // El candado contra la doble pulsacion sigue.
  assert.ok(zoho.includes("lock.run(() => (quoteBlocked ? Promise.resolve() : mutation.mutateAsync(variables).catch(() => {})));"));
});

test("pago manual en PAYMENT_PENDING: caducado/anulado se recupera, incierto queda bloqueado, siempre se consulta", async () => {
  const { interpretPaymentStatus } = await import("../src/lib/forward-payment.js");
  const { PAYABLE_PAYMENT_STATUSES } = await import("../src/lib/mail-item-detail.js");
  // Pagina caducada: se ofrece pagar otra vez (ensureHostedPage rehace la pagina de la MISMA factura).
  assert.equal(interpretPaymentStatus({ paymentStatus: "PAYMENT_PENDING", chargeStatus: "INVOICE_OPEN", paymentLinkExpired: true }).state, "link-expired");
  // Factura anulada en Zoho: el backend deja FAILED ("Prepare the payment again"), que se puede pagar.
  assert.equal(interpretPaymentStatus({ paymentStatus: "FAILED", chargeStatus: "VOIDED" }).state, "failed");
  assert.ok(PAYABLE_PAYMENT_STATUSES.includes("FAILED"));
  assert.ok(PAYABLE_PAYMENT_STATUSES.includes("PAYMENT_PENDING"), "en curso, la tarjeta sigue (consultar / revisar)");
  // Pendiente sin confirmar: sigue consultando, no es final.
  assert.equal(interpretPaymentStatus({ paymentStatus: "PAYMENT_PENDING", chargeStatus: "INVOICE_OPEN" }).terminal, false);
  // Resultado incierto o en revision: bloqueado hasta conciliar.
  assert.equal(forwardPaymentError(axiosError(503, { code: "ZOHO_OUTCOME_UNCERTAIN" })).retryable, false);
  assert.equal(forwardPaymentError(axiosError(409, { code: "ZOHO_PAYMENT_UNDER_REVIEW" })).kind, "review");
  assert.equal(interpretPaymentStatus({ paymentStatus: "PAYMENT_PENDING", chargeStatus: "REVIEW" }).state, "review");
});

test("pago rechazado en la tarjeta: Update your card y pagar en la app", () => {
  const zoho = read("src/components/common/zoho-forward-payment-card.jsx");
  assert.ok(zoho.includes("useState(Boolean(declinedByCenter))"));
  assert.ok(zoho.includes('{declinedByCenter ? "Pay in the app" : "Review payment"}'));
  assert.ok(/declinedByCenter && declined && zohoActions\.updateCard \? \(\s*<Button[^\n]*ZOHO_UPDATE_CARD_PATH/.test(zoho));
});

test("precio: solo Shipping & Handling, Mail Forwarding Fee y Total", () => {
  const detail = read("src/app/(client)/mail-items/[id].jsx");
  assert.ok(detail.includes("chargeRows(decision.charge).map"));
  const lib = read("src/lib/auto-charge-consent.js");
  assert.ok(!/handlingCents|carrierPostageCents|staffBreakdown\./.test(lib.replace(/\/\*[\s\S]*?\*\//g, "")), "el desglose interno nunca");
});

// ── Aislamiento HDG / The Worx ──────────────────────────────────────────────

/** app.config.js tal como lo evalua EAS para una marca. */
function appConfig(brandId) {
  const previous = process.env.APP_BRAND;
  process.env.APP_BRAND = brandId;
  delete require.cache[require.resolve("../app.config.js")];
  try {
    return require("../app.config.js").expo;
  } finally {
    if (previous === undefined) delete process.env.APP_BRAND;
    else process.env.APP_BRAND = previous;
    delete require.cache[require.resolve("../app.config.js")];
  }
}

test("HDG lo tiene; The Worx no, y su app no llama al endpoint", () => {
  assert.equal(appConfig("hdg").extra.brand.forwardingAutoCharge, true);
  assert.equal(appConfig("the_worx").extra.brand.forwardingAutoCharge, false);

  const hdg = { tenantSlug: "hdg", forwardingAutoCharge: true };
  const worx = { tenantSlug: "the_worx", forwardingAutoCharge: false };
  assert.equal(autoChargeConsentEnabled("hdg", hdg), true);
  assert.equal(autoChargeConsentEnabled("the_worx", worx), false);
  assert.equal(autoChargeConsentEnabled("the_worx", hdg), false, "otra organizacion en la app de HDG: nada");
  assert.equal(autoChargeConsentEnabled("hdg", worx), false, "la app de The Worx no lo enciende");
  assert.equal(autoChargeConsentEnabled("", hdg), false);
  assert.equal(autoChargeConsentEnabled("hdg", { tenantSlug: "hdg" }), false, "sin la bandera, apagado");

  const hook = read("src/lib/use-auto-charge-consent.js");
  assert.ok(hook.includes("autoChargeConsentEnabled(user?.tenant?.slug, brand)"));
  assert.ok(hook.includes("enabled: enabled && wanted"), "sin la marca, el GET no sale");
  const settings = read("src/app/(client)/settings/index.jsx");
  assert.ok(settings.includes("if (!autoChargeConsentEnabled(user?.tenant?.slug, brand)) return SECTIONS;"));
});

test("los identificadores de las apps no cambian", () => {
  assert.equal(appConfig("hdg").android.package, "com.hdgexecutivesuites.clientportal");
  assert.equal(appConfig("hdg").ios.bundleIdentifier, "com.hdgexecutivesuites.clientportal");
  assert.equal(appConfig("the_worx").android.package, "com.theworxoffices.clientportal");
});

test("formato del maximo: importe con codigo de moneda", () => {
  assert.equal(formatConsentAmount(7500, "USD"), "$75.00 USD");
  assert.equal(formatConsentAmount(123456, "usd"), "$1,234.56 USD");
  assert.equal(formatConsentAmount(5000, "EUR"), "50.00 EUR");
  assert.equal(formatConsentAmount(null, "USD"), null);
  assert.equal(formatConsentAmount(5000, null), null);
});
