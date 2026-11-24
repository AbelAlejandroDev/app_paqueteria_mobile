import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AxiosError } from "axios";

import { AVAILABILITY_OFFLINE, configureStorage, createApiClient, setAuthUser, setTokens } from "@paqueteria/core";
import { attachAppInterceptors } from "../src/lib/api-interceptors.js";
import {
  confirmServiceDown,
  getServiceStatus,
  reportServiceRecovered,
  resetServiceStatusForTests,
  SERVICE_OK,
} from "../src/lib/service-status.js";
import { sheetMaxHeight, SHEET_MIN_HEIGHT, SHEET_TOP_GAP } from "../src/lib/sheet-layout.js";
import {
  applySuggestedToForwardForm,
  hasForwardFormChanges,
  invalidatesAddressCheck,
  invalidatesQuote,
  verifyDraftFromForwardForm,
} from "../src/lib/forward-form.js";
import {
  chargeFromForwardDetails,
  chargeFromRate,
  chargeFromZohoPayment,
  chargeRows,
  customerCharge,
  MAIL_FORWARDING_FEE_LABEL,
  SHIPPING_AND_HANDLING_LABEL,
  TOTAL_LABEL,
} from "../src/lib/price-display.js";
import { describeForwardStage, labelStatusText, latestForwardRequest } from "../src/lib/forward-stage.js";
import { paymentBreakdown } from "../src/lib/zoho-forward-payment.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const detail = () => read("src/app/(client)/mail-items/[id].jsx");
const sheet = () => read("src/components/common/letter-forward-sheet.jsx");

function memoryStore() {
  const data = new Map();
  const backend = {
    getItem: async (key) => (data.has(key) ? data.get(key) : null),
    setItem: async (key, value) => void data.set(key, value),
    removeItem: async (key) => void data.delete(key),
  };
  return { ...backend, secure: backend };
}

// ── 1. Pantalla falsa de "No internet connection" ──────────────────────────

test("arranque: un fallo de red suelto no ensena la pantalla si la sonda responde (sin esperas artificiales)", async () => {
  resetServiceStatusForTests();
  configureStorage(memoryStore());
  await setTokens({ accessToken: "a", refreshToken: "r" });
  await setAuthUser({ id: "u1", tenantId: "hdg", role: "CLIENT" });
  let first = true;
  const api = attachAppInterceptors(
    createApiClient({
      baseURL: "https://api.example.test/api/v1",
      onUnauthorized: () => assert.fail("no cierra la sesion"),
      adapter: (config) => {
        if (first) {
          first = false;
          return Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config, {}));
        }
        return Promise.resolve({ data: { ok: true }, status: 200, statusText: "OK", headers: {}, config });
      },
    })
  );
  // iOS tira la primera peticion al abrir: el estado pasa a "offline"...
  await assert.rejects(api.get("/client/mail-items"));
  assert.equal(getServiceStatus().status, AVAILABILITY_OFFLINE);
  // ...pero la confirmacion (sonda inmediata) responde: vuelve a ok, sin pantalla.
  let probes = 0;
  const result = await confirmServiceDown({ probe: async () => (probes += 1) > 0 });
  assert.equal(result, "recovered");
  assert.equal(probes, 1, "una sola sonda, en el momento");
  assert.equal(getServiceStatus().status, SERVICE_OK);
});

test("sin Internet de verdad: la sonda tambien falla y entonces si se ensena la pantalla", async () => {
  resetServiceStatusForTests();
  assert.equal(await confirmServiceDown({ probe: async () => false, onRecovered: () => assert.fail("no se recupera") }), "down");
  assert.equal(await confirmServiceDown({ probe: async () => { throw new Error("offline"); }, onRecovered: () => assert.fail() }), "down");
  reportServiceRecovered();
});

test("la pantalla solo aparece con la caida confirmada; en segundo plano espera a volver a primer plano", () => {
  const screen = read("src/components/common/service-unavailable.jsx");
  assert.match(screen, /const down = failing && confirmed;/);
  assert.match(screen, /const confirmed = failing && confirmedSince !== null && confirmedSince === service.since;/, "cada caida nueva se confirma de nuevo");
  assert.match(screen, /confirmServiceDown\(\{ probe: probeApi \}\)/);
  assert.match(screen, /if \(AppState\.currentState === "active"\) \{\s*confirm\(\);/);
  assert.match(screen, /if \(appState === "active"\) \{\s*subscription\.remove\(\);\s*confirm\(\);/);
  assert.doesNotMatch(screen, /setTimeout\(/, "sin retardos artificiales");
});

test("restaurar la sesion: sin red se sigue con el usuario guardado, no se manda al login", () => {
  const auth = read("src/context/AuthContext.jsx");
  assert.match(auth, /if \(cachedUser\) \{\s*applyUser\(cachedUser\);\s*setSessionUnavailable\(false\);/);
  assert.match(auth, /if \(classifySessionError\(error\) === SESSION_INVALID\) \{\s*await endLocalSession\(\);/);
});

// ── 2. Modales: safe areas, scroll y cierres accidentales ──────────────────

test("alto de la hoja en pixeles, sin pasar la zona segura de arriba", () => {
  // iPhone 15 Pro: 852 de alto, 59 de isla dinamica.
  assert.equal(sheetMaxHeight({ windowHeight: 852, topInset: 59 }), 852 - 59 - SHEET_TOP_GAP);
  // iPhone SE: 667 y 20.
  assert.equal(sheetMaxHeight({ windowHeight: 667, topInset: 20 }), 667 - 20 - SHEET_TOP_GAP);
  assert.equal(sheetMaxHeight({ windowHeight: 300, topInset: 20 }), SHEET_MIN_HEIGHT, "nunca por debajo del minimo");
  assert.equal(sheetMaxHeight({}), SHEET_MIN_HEIGHT);
});

test("el modal: alto numerico, cuerpo desplazable, pie siempre visible y cierre con confirmacion", () => {
  const modal = read("src/components/ui/modal.jsx");
  assert.doesNotMatch(modal, /max-h-\[80%\]/, "un % dentro de KeyboardAvoidingView no limita nada");
  assert.match(modal, /style=\{\{ maxHeight \}\}/);
  assert.match(modal, /style=\{\{ flexGrow: 0, flexShrink: 1 \}\}/);
  // Fondo, X y atras de Android pasan por requestClose.
  assert.match(modal, /onRequestClose=\{requestClose\}/);
  assert.match(modal, /<Pressable\s+style=\{StyleSheet\.absoluteFill\}\s+onPress=\{requestClose\}/);
  assert.match(modal, /if \(busy\) return;\s*if \(dirty\) confirmDiscard\(onClose\);\s*else onClose\?\.\(\);/);
  assert.match(modal, /\{ text: "Keep editing", style: "cancel" \}/);
});

test("las hojas de reenvio pasan dirty y busy al modal", () => {
  assert.match(sheet(), /dirty=\{dirty\}\s*busy=\{pending\}/);
  assert.match(detail(), /dirty=\{forwardDirty\}\s*busy=\{quoteRates\.isPending \|\| selectRate\.isPending\}/);
});

// ── 3. Botones de direccion ────────────────────────────────────────────────

test("sin direccion guardada: 'Set Address' y el formulario abierto; con guardadas: 'Change Address'", async () => {
  const { addressOptionLabel } = await import("../src/components/common/letter-forward-sheet.jsx").catch(() => ({}));
  // El componente importa React Native: se comprueba la funcion por su codigo.
  const source = sheet();
  assert.match(source, /return Number\(savedCount\) > 0 \? "Change Address" : "Set Address";/);
  assert.match(source, /const noSavedAddresses = previewQuery\.isSuccess && addresses\.length === 0;/);
  assert.match(source, /const addingNew = addingAddress \|\| noSavedAddresses;/);
  assert.doesNotMatch(source, /Send to another address|Set Another Address/);
  assert.equal(addressOptionLabel, undefined);
  // Paquetes y sobres: elegir otra guardada, o Set Address si no hay.
  assert.match(detail(), /<Field label="Select Another Address">/);
  assert.match(detail(), /Set Address: you have no saved forwarding address yet/);
});

// ── 4. Check Address en los dos recorridos ─────────────────────────────────

test("Check Address en Forward Letter (nueva y guardada) y en Request Forwarding, con la validacion del backend", () => {
  const letter = sheet();
  assert.equal((letter.match(/>\s*Check Address\s*</g) || []).length, 2, "direccion nueva y guardada");
  assert.match(letter, /api\.post\("\/client\/forwarding-addresses\/verify", verifyPayload\(draft\)\)/);
  assert.match(letter, /api\.post\("\/client\/addresses\/" \+ address\.id \+ "\/verify"\)/);
  assert.match(letter, /Validating address…/);
  assert.match(letter, /Address validated/);

  const item = detail();
  assert.match(item, />\s*Check Address\s*</);
  assert.match(item, /api\.post\("\/client\/forwarding-addresses\/verify", verifyPayload\(verifyDraftFromForwardForm\(forwardForm\)\)\)/);
  assert.match(item, /Validating address…/);
  assert.match(item, /Address validated/);
  assert.match(item, /The carrier suggests/);
  assert.match(item, /Use suggested address/);
});

// ── 5. No perder lo escrito ────────────────────────────────────────────────

test("conservacion: Check Address y la correccion sugerida no tocan tracking, seguro, valor ni telefono", () => {
  const form = {
    recipient: "Ana",
    address1: "1 main st",
    address2: "",
    city: "miami",
    state: "FL",
    zip: "33101",
    phone: "3055550100",
    trackingRequested: true,
    insuranceRequested: false,
    insuredValue: "",
  };
  const next = applySuggestedToForwardForm(form, { addressLine1: "1 MAIN ST", city: "MIAMI", state: "FL", zip: "33101-1234" });
  assert.equal(next.address1, "1 MAIN ST");
  assert.equal(next.zip, "33101-1234");
  assert.equal(next.trackingRequested, true);
  assert.equal(next.phone, "3055550100");
  assert.equal(next.recipient, "Ana", "sin destinatario sugerido se queda el escrito");
  assert.deepEqual(verifyDraftFromForwardForm(form), {
    recipient: "Ana", company: "", addressLine1: "1 main st", addressLine2: "", city: "miami", state: "FL", zip: "33101", phone: "3055550100",
  });
});

test("que invalida la cotizacion y que invalida el Check Address", () => {
  for (const field of ["address1", "zip", "trackingRequested", "insuranceRequested", "insuredValue"]) assert.equal(invalidatesQuote(field), true, field);
  assert.equal(invalidatesAddressCheck("zip"), true);
  assert.equal(invalidatesAddressCheck("trackingRequested"), false, "cambiar tracking no invalida la direccion");
  assert.equal(invalidatesAddressCheck("phone"), false);
  // En la pantalla: cambiar un campo de direccion borra el resultado del transportista.
  assert.match(detail(), /if \(invalidatesAddressCheck\(field\)\) setAddressCheck\(null\);/);
});

test("formulario con cambios: cerrar pregunta; sin cambios, se cierra sin preguntar", () => {
  assert.equal(hasForwardFormChanges({}), false);
  assert.equal(hasForwardFormChanges({ draft: { recipient: "", zip: "" }, emptyDraft: { recipient: "", zip: "" } }), false);
  assert.equal(hasForwardFormChanges({ draft: { recipient: "Ana" }, emptyDraft: { recipient: "" } }), true);
  assert.equal(hasForwardFormChanges({ trackingRequested: true }), true);
  assert.equal(hasForwardFormChanges({ insuredValue: "150" }), true);
  assert.equal(hasForwardFormChanges({ pickedAddress: true }), true);
  // "Discard" vacia el formulario; Cancel con cambios tambien pregunta.
  assert.match(detail(), /const discardForward = \(\) => \{\s*clearRates\(\);\s*setAddressCheck\(null\);\s*setForwardForm\(EMPTY_FORWARD\);/);
  assert.match(detail(), /forwardDirty \? confirmDiscard\(discardForward\) : setForwardOpen\(false\)/);
});

// ── 6. Cartas: lo prepara el centro ────────────────────────────────────────

test("LETTER: se pide sin tarifa ni pago; el centro pesa y prepara ('Waiting for staff preparation')", () => {
  const letter = sheet();
  assert.match(letter, /The final price is calculated when staff weighs and prepares your shipment/);
  assert.match(letter, /Waiting for staff preparation/);
  assert.doesNotMatch(letter, /forwarding\/quotes|prepare-payment|Review & Pay|Pay now/);
  // Sin importe cotizado no hay tarjeta de pago (la pieza la pinta solo con quotedAmountCents > 0).
  assert.match(detail(), /&& amount > 0/);
  const stage = describeForwardStage({ type: "FORWARD", status: "OPEN", forwardDetails: { paymentStatus: "NOT_STARTED" } });
  assert.equal(stage.key, "staff-preparation");
  assert.equal(stage.title, "Waiting for staff preparation");
  assert.equal(stage.action, null, "nada que pagar todavia");
});

test("PACKAGE y LARGE_ENVELOPE siguen con la cotizacion: el backend f7c677a exige quote fuera de cartas", () => {
  const item = detail();
  assert.match(item, /const openForward = \(\) => \{\s*if \(isLetter\) \{/);
  assert.match(item, /api\.post\("\/client\/forwarding\/quotes"/);
});

test("estados del reenvio, con pago del cliente o iniciado por el centro (mismos campos)", () => {
  const fwd = (status, forwardDetails) => describeForwardStage({ type: "FORWARD", status, forwardDetails });
  const quoted = { quotedAmountCents: 943 };
  assert.equal(fwd("OPEN", { ...quoted, paymentStatus: "NOT_STARTED" }).key, "payment-pending");
  assert.equal(fwd("OPEN", { ...quoted, paymentStatus: "NOT_STARTED" }).action, "pay");
  assert.equal(fwd("PROCESSING", { ...quoted, paymentStatus: "PAYMENT_PENDING" }).key, "payment-processing");
  assert.equal(fwd("PROCESSING", { ...quoted, paymentStatus: "PAYMENT_PENDING" }).action, null, "procesandose: no se ofrece pagar otra vez");
  const declined = fwd("OPEN", { ...quoted, paymentStatus: "FAILED" });
  assert.equal(declined.key, "payment-declined");
  assert.equal(declined.action, "update-payment");
  assert.equal(fwd("OPEN", { ...quoted, paymentStatus: "AUTHENTICATION_REQUIRED" }).title, "Pending your authorization");
  assert.equal(fwd("PROCESSING", { ...quoted, paymentStatus: "PAID", shipmentStatus: "PENDING_FULFILLMENT" }).key, "label-in-preparation");
  assert.equal(fwd("READY_TO_SHIP", { ...quoted, paymentStatus: "PAID", shipmentStatus: "LABEL_PURCHASED", trackingNumber: "9400" }).key, "label-purchased");
  assert.equal(fwd("COMPLETED", { ...quoted, paymentStatus: "PAID", shipmentStatus: "SHIPPED" }).key, "shipped");
  assert.equal(fwd("PROCESSING", { ...quoted, paymentStatus: "PAID", shipmentStatus: "EXCEPTION" }).key, "review");
  assert.equal(fwd("CANCELLED", {}).key, "closed");
  // Un estado que la app no conoce no se interpreta.
  assert.deepEqual(fwd("OPEN", { ...quoted, paymentStatus: "SOMETHING_NEW" }).title, "Something new");
  assert.equal(describeForwardStage({ type: "SCAN" }), null);
});

test("pago rechazado: accion clara para revisar el metodo de pago", () => {
  assert.match(detail(), /stage\.action === "update-payment" \? \(\s*<Button variant="outline" className="mt-2" onPress=\{\(\) => router\.push\("\/billing"\)\}>\s*Review payment method/);
});

// ── 7. Precios: $2 dentro de Shipping & Handling ───────────────────────────

test("ejemplo validado en Sandbox: $7.43 + $2.00 (dentro) + $5.00 = $14.43", () => {
  // La tarifa ya trae la gestion: 743 + 200 = 943.
  const fromRate = chargeFromRate({ optionId: "o1", totalAmount: { amount: 943 } }, 500);
  assert.deepEqual(chargeRows(fromRate), [
    { label: SHIPPING_AND_HANDLING_LABEL, cents: 943 },
    { label: MAIL_FORWARDING_FEE_LABEL, cents: 500 },
    { label: TOTAL_LABEL, cents: 1443, strong: true },
  ]);
  // Zoho: postageAmount ya incluye postageFeeAmount; el total es amount.
  const zoho = { amount: 1443, postageAmount: 943, postageFeeAmount: 200, adminFeeAmount: 500, currency: "USD" };
  assert.deepEqual(chargeRows(chargeFromZohoPayment(zoho)).map((r) => [r.label, r.cents]), [
    ["Shipping & Handling", 943],
    ["Mail Forwarding Fee", 500],
    ["Total", 1443],
  ]);
  const breakdown = paymentBreakdown(zoho);
  assert.equal(breakdown.shippingAndHandling, 943);
  assert.ok(!Object.values(breakdown).includes(200), "el $2 nunca es una linea");
});

test("ninguna pantalla ensena la gestion interna como linea propia", () => {
  for (const file of [
    "src/components/common/letter-forward-sheet.jsx",
    "src/components/common/zoho-forward-payment-card.jsx",
    "src/app/(client)/mail-items/[id].jsx",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /label="Handling"|"Handling"|handling fee\.|includes " \+ formatMoneyFromCents\(postageHandlingCents\)/, file);
    assert.doesNotMatch(source, /Immediate forwarding fee|Immediate forward fee/, file);
  }
});

test("precio pendiente: sin una parte, el total no se da por bueno (nunca un subtotal enganoso)", () => {
  const partial = customerCharge({ shippingAndHandling: 943 });
  assert.equal(partial.total, null);
  assert.equal(partial.complete, false);
  assert.equal(chargeRows(partial).at(-1).cents, null);
  assert.deepEqual(chargeRows(customerCharge({ shippingAndHandling: 943, mailForwardingFee: 0 })).map((r) => r.label), ["Shipping & Handling", "Total"]);
  // Las cartas antes de preparar: S&H "Calculated by staff" y Total "Pending preparation".
  assert.match(sheet(), /Calculated by staff/);
  assert.match(sheet(), /Pending preparation/);
});

test("el resumen de la tarifa elegida sale siempre (no solo con recargo)", () => {
  assert.match(detail(), /\{selectedRate \? \(\s*<View className="gap-1 rounded-lg border border-border bg-card p-3" accessibilityLabel="Price summary">/);
  assert.match(detail(), /chargeRows\(chargeFromRate\(selectedRate, immediateFeeCents\)\)/);
});

// ── 8. Loading ─────────────────────────────────────────────────────────────

test("estados de carga: botones bloqueados mientras hay una operacion en curso", () => {
  const letter = sheet();
  assert.match(letter, /disabled=\{previewQuery\.isError \|\| previewQuery\.isLoading\}/);
  assert.match(letter, /disabled=\{!draftIsComplete \|\| verifyAddress\.isPending \|\| pending\}/);
  assert.match(letter, /<Skeleton className="h-36 w-full" \/>/);
  const item = detail();
  assert.match(item, /disabled=\{!forwardFieldsFilled \|\| checkAddress\.isPending \|\| anyPending\}/);
  assert.match(item, /addressesQuery\.isLoading \? \(\s*<Skeleton/);
});

// ── 9. Historial ───────────────────────────────────────────────────────────

test("historial: lo que da la API; el total es lo cobrado, no el franqueo", () => {
  const d = { quotedAmountCents: 943, acceptedRepricedAmount: 980, paymentAmount: 1480, paymentStatus: "PAID", shipmentStatus: "LABEL_PURCHASED", trackingNumber: "9400" };
  const charge = chargeFromForwardDetails(d);
  assert.deepEqual(charge, { quoted: 943, reconfirmed: 980, shippingAndHandling: 980, total: 1480 });
  assert.equal(chargeFromForwardDetails({ quotedAmountCents: 943 }).total, null, "sin pago, sin total");
  assert.equal(labelStatusText(d), "Purchased");
  assert.equal(labelStatusText({ shipmentStatus: "CREATING" }), "In preparation");
  assert.equal(labelStatusText({}), null);

  const item = detail();
  assert.match(item, /function paidAmountLabel\(details\) \{\s*const total = chargeFromForwardDetails\(details\)\.total;/);
  assert.doesNotMatch(item, /label="Paid" value=\{formatMoneyFromCents\([^)]*forwardDetails\.quotedAmountCents\)\}/, "Paid no es el franqueo cotizado");
  // El cargo de reenvio y la fecha de despacho no estan en forwardDetails: no se inventan.
  const card = item.match(/function ForwardSummaryCard[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(card, /MAIL_FORWARDING_FEE_LABEL|shippedAt|dispatch/i);
});

test("historial: la solicitud de reenvio mas reciente", () => {
  const list = [
    { type: "FORWARD", id: "a", createdAt: "2026-11-01T00:00:00Z" },
    { type: "SCAN", id: "s", createdAt: "2026-11-20T00:00:00Z" },
    { type: "FORWARD", id: "b", createdAt: "2026-11-10T00:00:00Z" },
  ];
  assert.equal(latestForwardRequest(list).id, "b");
  assert.equal(latestForwardRequest([]), null);
});

// ── 10 y 11. Legal ─────────────────────────────────────────────────────────

test("Help tiene Privacy Policy con la misma fuente que Settings, sin URLs repetidas", () => {
  const help = read("src/app/(client)/help/index.jsx");
  assert.match(help, /const privacyPolicy = usePrivacyPolicy\(\);/);
  assert.match(help, /label="Privacy Policy"/);
  assert.match(help, /onPress=\{\(\) => WebBrowser\.openBrowserAsync\(privacyPolicy\.url\)\}/);
  for (const file of ["src/app/(client)/help/index.jsx", "src/app/(client)/settings/index.jsx", "src/lib/use-privacy-policy.js"]) {
    assert.doesNotMatch(read(file), /hdgexecutivesuites|theworxoffices|privacy-policy\//, file);
  }
});

// ── 12. Aislamiento ────────────────────────────────────────────────────────

test("lo nuevo no lleva marcas, APIs ni secretos: vale igual para HDG y The Worx", () => {
  for (const file of ["src/lib/price-display.js", "src/lib/forward-stage.js", "src/lib/forward-form.js", "src/lib/sheet-layout.js", "src/lib/use-privacy-policy.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /https?:\/\//, file);
    assert.doesNotMatch(source, /hdgexecutivesuites|theworx|sandbox-core|APP_BRAND/i, file);
    assert.doesNotMatch(source, /(from\s+["']|require\(\s*["'])(\.\.\/)+brands/, file);
  }
});

test("Sandbox y modo demo: prepare-payment simulado tiene la misma forma y se ve igual", () => {
  const demo = { provider: "ZOHO", demo: true, paymentProvider: "APP_REVIEW_DEMO", amount: 1443, postageAmount: 943, postageFeeAmount: 200, adminFeeAmount: 500, invoiceNumber: "DEMO-00000001" };
  assert.deepEqual(paymentBreakdown(demo), { shippingAndHandling: 943, mailForwardingFee: 500, total: 1443, currency: "USD", invoiceNumber: "DEMO-00000001" });
});
