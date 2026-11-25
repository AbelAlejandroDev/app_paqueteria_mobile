/**
 * Hoja de reenvio de cartas y sobres grandes: formulario compacto (sin
 * consentimiento), resultado del envio y layout de la hoja en iPhone.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVE_FORWARD_STATUSES,
  classifyForwardSubmitError,
  errorReference,
  findActiveForward,
  verifyForwardCreated,
} from "../src/lib/forward-submit.js";
import { sheetMaxHeight, SHEET_MIN_HEIGHT, SHEET_MIN_HEIGHT_WITH_KEYBOARD, SHEET_TOP_GAP } from "../src/lib/sheet-layout.js";
import { autoChargeConsentEnabled } from "../src/lib/auto-charge-consent.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const sheet = () => read("src/components/common/letter-forward-sheet.jsx");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const axiosError = (status, data) => ({ response: { status, data } });

// ── Formulario compacto ─────────────────────────────────────────────────────

test("formulario compacto: sin bloque de autorizacion, sin casilla y sin PUT del consentimiento", () => {
  const source = code(sheet());
  assert.ok(!source.includes("AutoChargeConsentOffer"), "el bloque grande no esta");
  assert.ok(!source.includes("auto-charge-consent-offer"));
  assert.ok(!/grant\.mutateAsync|revoke\.mutateAsync|grantConsentBody/.test(source), "el formulario no acepta ni retira nada");
  assert.ok(!/consentAcceptedKey|consentChecked|isOfferAccepted/.test(source));
  assert.ok(!/offer\.text|consent\.offer/.test(source), "no ensena el texto legal");
  // Lo que si: direccion, Check Address, opciones, resumen y Request forward.
  for (const piece of ["Check Address", "Add tracking", "Add insurance", "PendingPriceSummary", "Request forward"]) {
    assert.ok(source.includes(piece), piece);
  }
});

test("contexto breve: una linea con o sin autorizacion y el enlace a Settings", () => {
  const source = sheet();
  assert.ok(source.includes('"Automatic charges are on, up to " + consent.effectiveMaxLabel + " per shipment."'), "con autorizacion, su maximo de la API");
  assert.ok(source.includes("You'll approve and pay the total once your center prepares it."), "sin autorizacion, pago manual");
  assert.ok(source.includes("Automatic charges in Settings"));
  assert.ok(source.includes('router.push("/settings/forwarding-charges")'));
  assert.ok(source.includes("autoCharge.enabled && autoCharge.query.isSuccess ?"), "solo la marca que lo tiene (HDG)");
  // Salir a Settings con cambios pide confirmacion: no se pierde lo escrito sin querer.
  assert.ok(/if \(dirty\) confirmDiscard\(go/.test(source));
});

test("el consentimiento sigue entero en Settings: texto legal, casilla, alta y retirada", () => {
  const screen = read("src/app/(client)/settings/forwarding-charges.jsx");
  assert.ok(screen.includes("<AutoChargeConsentOffer"), "texto legal completo y casilla");
  assert.ok(screen.includes("grant.mutateAsync(offer)"));
  assert.ok(screen.includes("revoke.mutateAsync()"));
  assert.ok(screen.includes("const [acceptedKey, setAcceptedKey] = useState(null);"), "desmarcada al entrar");
  const offer = read("src/components/common/auto-charge-consent-offer.jsx");
  assert.ok(offer.includes("{offer.text}"));
  assert.ok(offer.includes('accessibilityRole="checkbox"'));
});

test("HDG y The Worx: el contexto solo sale en la marca con cobro automatico", () => {
  assert.equal(autoChargeConsentEnabled("hdg", { tenantSlug: "hdg", forwardingAutoCharge: true }), true);
  assert.equal(autoChargeConsentEnabled("the_worx", { tenantSlug: "the_worx", forwardingAutoCharge: false }), false);
  // La hoja solo lee (GET); en The Worx el hook no llama a nada.
  const hook = read("src/lib/use-auto-charge-consent.js");
  assert.ok(hook.includes("enabled: enabled && wanted"));
});

// ── Resultado del envio ─────────────────────────────────────────────────────

test("error de postage: no se creo, se dice el motivo del servidor con HTTP y codigo", () => {
  const error = axiosError(409, {
    code: "PITNEY_POSTAGE_BALANCE_LOW",
    error: "The postage balance is too low to buy this label ($1.00 available, $9.43 needed), so nothing was charged. An admin has to refill postage first.",
    charged: false,
  });
  const result = classifyForwardSubmitError(error);
  assert.equal(result.outcome, "not-created");
  assert.match(result.message, /postage balance is too low/);
  assert.equal(result.reference, "HTTP 409 · PITNEY_POSTAGE_BALANCE_LOW");
});

test("respuestas del servidor (4xx/500): no se creo, se puede corregir y volver a pedir", () => {
  for (const [status, data] of [
    [422, { code: "FORWARD_DESTINATION_NOT_VERIFIED", error: "Address not verified" }],
    [422, { code: "INSURANCE_NOT_AVAILABLE_FOR_PACKAGES", error: "No insurance" }],
    [409, { code: "MULTI_FORWARD_LETTERS_ONLY", error: "Conflict", reason: "Only letters can travel together" }],
    [400, { error: "Invalid body" }],
    [500, { error: "Internal Server Error" }],
  ]) {
    const result = classifyForwardSubmitError(axiosError(status, data));
    assert.equal(result.outcome, "not-created", String(status));
    assert.ok(result.reference.startsWith("HTTP " + status));
  }
  // El 409 generico ("Conflict") usa el `reason`, no "Conflict".
  assert.equal(classifyForwardSubmitError(axiosError(409, { error: "Conflict", reason: "Only letters can travel together" })).message, "Only letters can travel together");
  assert.equal(classifyForwardSubmitError(axiosError(400, {}), "Fallback").message, "Fallback");
});

test("estado incierto: sin respuesta (timeout, sin red) o 502/503/504 -> comprobar antes de dejar pedirlo otra vez", () => {
  assert.equal(classifyForwardSubmitError(new Error("timeout of 30000ms exceeded")).outcome, "uncertain");
  assert.equal(classifyForwardSubmitError({ code: "ECONNABORTED" }).outcome, "uncertain");
  for (const status of [502, 503, 504]) assert.equal(classifyForwardSubmitError(axiosError(status, {})).outcome, "uncertain", String(status));
  assert.equal(errorReference(new Error("Network Error")), null);
});

test("ya habia un reenvio activo (409 ACTIVE_FORWARD_REQUEST_EXISTS): no es un fallo, se ensena como pedido", () => {
  const result = classifyForwardSubmitError(axiosError(409, { error: "Conflict", reason: "Already being forwarded: #A-0012", code: "ACTIVE_FORWARD_REQUEST_EXISTS" }));
  assert.equal(result.outcome, "already-requested");
  assert.equal(result.message, "Already being forwarded: #A-0012");
  assert.equal(classifyForwardSubmitError(axiosError(409, { error: "This mail item already has an active forwarding request.", code: "ACTIVE_FORWARD_REQUEST_EXISTS" })).outcome, "already-requested");
});

test("solicitud creada: la verificacion encuentra el reenvio activo de la pieza (solo GET)", async () => {
  const calls = [];
  const fetchMailItem = async (id) => {
    calls.push(id);
    return { item: { id, serviceRequests: [{ type: "SCAN", status: "OPEN" }, { type: "FORWARD", status: "OPEN", id: "sr-1" }] } };
  };
  const result = await verifyForwardCreated({ fetchMailItem, mailItemIds: ["m1", "m2"] });
  assert.equal(result.created, true);
  assert.equal(result.request.id, "sr-1");
  assert.deepEqual(calls, ["m1"], "una lectura: las demas van en la misma solicitud");

  for (const status of ACTIVE_FORWARD_STATUSES) assert.ok(findActiveForward({ item: { serviceRequests: [{ type: "FORWARD", status }] } }));
  for (const status of ["COMPLETED", "CANCELLED", "REJECTED"]) {
    assert.equal(findActiveForward({ item: { serviceRequests: [{ type: "FORWARD", status }] } }), null, status);
  }
  assert.equal((await verifyForwardCreated({ fetchMailItem: async () => ({ item: { serviceRequests: [] } }), mailItemIds: ["m1"] })).created, false);
  await assert.rejects(verifyForwardCreated({ fetchMailItem: async () => { throw new Error("offline"); }, mailItemIds: ["m1"] }));
});

test("la hoja: creado cierra y avisa; incierto comprueba; sin poder comprobar, no deja reenviar", () => {
  const source = sheet();
  assert.ok(source.includes("onSuccess: () => finishCreated(),"));
  assert.ok(/result\.outcome === "already-requested"\) \{\s*\/\/[\s\S]*?finishCreated\(/.test(source));
  assert.ok(/result\.outcome === "uncertain"\) \{[\s\S]*?checkIfCreated\(\);/.test(source));
  assert.ok(/if \(created\) \{\s*finishCreated\(\);/.test(source));
  assert.ok(source.includes('} catch {\n      setSubmitIssue({ kind: "uncertain" });'), "si no se puede leer, sigue bloqueado");
  assert.ok(source.includes("<SubmitIssue issue={submitIssue} onCheckAgain={checkIfCreated} />"), "dentro del formulario");
  assert.ok(!source.includes('Alert.alert("Could not request forward"'), "el error ya no es una alerta que tapa el formulario");
  // La alerta de exito sale tras cerrar la hoja (en iOS se perdia sobre un Modal cerrandose).
  assert.ok(/onClose\(\);[\s\S]*?setTimeout\(\(\) => Alert\.alert\(title, message\), 350\);/.test(source));
});

test("sin solicitudes duplicadas: candado, boton bloqueado sin resultado y la direccion nueva no se guarda dos veces", () => {
  const source = sheet();
  assert.ok(source.includes("const [submitLock] = useState(createSingleFlight);"));
  assert.ok(/const submit = \(\) =>\s*submitLock\.run\(\(\) => \{\s*if \(submitIssue\?\.kind === "uncertain" \|\| submitIssue\?\.kind === "checking"\) return null;/.test(source));
  assert.ok(source.includes("disabled={!canSubmit || unresolved} onPress={submit}"));
  assert.ok(source.includes("if (saveForLater && savedDestination) {\n          destination = savedDestination;"));
  assert.ok(source.includes("if (destination?.id) setSavedDestination(destination);"));
  // Cambiar la direccion invalida la guardada.
  assert.ok(/setAddressCheck\(null\);\s*setSavedDestination\(null\);/.test(source));
});

test("se conservan direccion y opciones tras un error: nada se reinicia en onError", () => {
  const source = sheet();
  const onError = source.slice(source.indexOf("onError: (error) => {\n      // Si la direccion"), source.indexOf("/** Creado (201"));
  assert.ok(onError.length > 100);
  assert.ok(!/setDraft\(|setTrackingRequested\(|setInsuranceRequested\(|setInsuredValue\(|setSelectedAddressId\(|setStep\(/.test(onError));
});

// ── Layout en iPhone ────────────────────────────────────────────────────────

test("iPhone: con el teclado abierto la hoja + teclado caben bajo la isla dinamica", () => {
  // iPhone 15 Pro (852 pt, inset 59) e iPhone SE (667 pt, inset 20), con teclados reales.
  for (const { windowHeight, topInset, keyboardHeight } of [
    { windowHeight: 852, topInset: 59, keyboardHeight: 336 },
    { windowHeight: 852, topInset: 59, keyboardHeight: 291 },
    { windowHeight: 667, topInset: 20, keyboardHeight: 260 },
  ]) {
    const height = sheetMaxHeight({ windowHeight, topInset, keyboardHeight });
    assert.ok(height + keyboardHeight <= windowHeight - topInset - SHEET_TOP_GAP, JSON.stringify({ windowHeight, keyboardHeight, height }));
  }
  // Sin teclado, igual que antes.
  assert.equal(sheetMaxHeight({ windowHeight: 852, topInset: 59 }), 852 - 59 - SHEET_TOP_GAP);
  assert.equal(sheetMaxHeight({ windowHeight: 852, topInset: 59, keyboardHeight: 0 }), 852 - 59 - SHEET_TOP_GAP);
  // Ventana minima: nunca menos que el minimo correspondiente.
  assert.equal(sheetMaxHeight({ windowHeight: 400, topInset: 20, keyboardHeight: 300 }), SHEET_MIN_HEIGHT_WITH_KEYBOARD);
  assert.equal(sheetMaxHeight({ windowHeight: 300, topInset: 20 }), SHEET_MIN_HEIGHT);
});

test("la hoja escucha el teclado solo en iOS y solo abierta; el pie respeta la zona segura", () => {
  const modal = read("src/components/ui/modal.jsx");
  assert.ok(modal.includes('if (Platform.OS !== "ios" || !active) return undefined;'));
  assert.ok(modal.includes('Keyboard.addListener("keyboardWillShow"'));
  assert.ok(modal.includes("sheetMaxHeight({ windowHeight, topInset: insets.top, keyboardHeight })"));
  assert.ok(modal.includes("const bottomPadding = SHEET_PADDING + insets.bottom;"));
  assert.ok(modal.includes('keyboardShouldPersistTaps="handled"'));
});
