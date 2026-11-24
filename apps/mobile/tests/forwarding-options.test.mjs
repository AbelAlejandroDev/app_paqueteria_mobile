import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildShippingOptions,
  describeCompatibility,
  describeForwardingOptionsError,
  insuranceAvailableFor,
  insuredServiceValueCents,
  insuranceUnavailableMessage,
  insuredValueProblem,
  LARGE_ENVELOPE_INSURANCE_UNAVAILABLE_MESSAGE,
  PACKAGE_INSURANCE_UNAVAILABLE_MESSAGE,
  parseInsuredValueCents,
  QUOTE_INVALID_CODES,
  QUOTE_STALE_CODES,
  QUOTE_STALE_MESSAGE,
  rateExtras,
  rateMatchesOptions,
  readQuoteResponse,
  shippingOptionsProblem,
} from "../src/lib/forwarding-options.js";
import { forwardPaymentError, isQuoteBlocked, paymentRateKey, QUOTE_INVALID_PAYMENT_MESSAGE, QUOTE_OPTIONS_INVALID_CODES } from "../src/lib/forward-payment.js";

/**
 * Add Tracking / Add Insurance con la regla TRACKING_INSURANCE_V2 del backend (ba3b11b).
 * Solo mocks: respuestas de POST /client/forwarding/quotes y errores 422/409
 * con la forma que describe el contrato (error, code, compatibility).
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const detail = () => read("../src/app/(client)/mail-items/[id].jsx");
const sheet = () => read("../src/components/common/letter-forward-sheet.jsx");
const money = (cents) => "$" + (cents / 100).toFixed(2);

const axiosError = (status, data) => ({ response: { status, data } });
const ins = (value) => ({ specialServiceId: "Ins", inputParameters: [{ name: "INPUT_VALUE", value }] });
const rate = (optionId, { tracked = false, insured = null, ...rest } = {}) => ({
  optionId,
  carrier: "USPS",
  serviceId: optionId,
  trackingIncluded: tracked,
  specialServices: insured ? [ins(insured)] : [],
  // Contrato real 7de1ae9: entero, 0 sin seguro; los estimados pueden ser null.
  insuredValueCents: insured ? Math.round(Number(insured) * 100) : 0,
  estimatedDeliveryDays: null,
  estimatedDeliveryDate: null,
  rateType: null,
  totalAmount: { amount: 1000, currency: "USD" },
  ...rest,
});

// ── Valor declarado ──────────────────────────────────────────────────────────

test("valor declarado: de $100 a $5,000, en dolares con dos decimales como mucho", () => {
  assert.equal(parseInsuredValueCents("100"), 10000);
  assert.equal(parseInsuredValueCents("$1,250.50"), 125050);
  assert.equal(parseInsuredValueCents("12.345"), null, "no redondea a algo distinto de lo escrito");
  assert.equal(parseInsuredValueCents("abc"), null);
  assert.equal(parseInsuredValueCents(""), null);

  assert.equal(insuredValueProblem("100"), null);
  assert.equal(insuredValueProblem("5000"), null);
  assert.equal(insuredValueProblem("5,000.00"), null);
  assert.match(insuredValueProblem("99.99"), /between \$100 and \$5,000/);
  assert.match(insuredValueProblem("5000.01"), /between \$100 and \$5,000/);
  assert.match(insuredValueProblem("-100"), /between/);
  assert.match(insuredValueProblem(""), /Enter the declared value/);
});

// ── Cartas: las cuatro combinaciones ─────────────────────────────────────────

test("V2 cartas: las cuatro combinaciones se piden tal cual (seguro sin tracking incluido)", () => {
  const letter = (trackingRequested, insuranceRequested, insuredValue = "") => ({
    letterForward: true,
    trackingRequested,
    insuranceRequested,
    insuredValue,
  });

  assert.equal(shippingOptionsProblem(letter(false, false)), null);
  assert.deepEqual(buildShippingOptions(letter(false, false)), { trackingRequested: false, insuranceRequested: false });

  assert.equal(shippingOptionsProblem(letter(true, false)), null);
  assert.deepEqual(buildShippingOptions(letter(true, false)), { trackingRequested: true, insuranceRequested: false });

  // V2: seguro sin seguimiento es valido; sale con lo elegido, sin encender Tracking.
  assert.equal(shippingOptionsProblem(letter(false, true, "250")), null);
  assert.deepEqual(buildShippingOptions(letter(false, true, "250")), { trackingRequested: false, insuranceRequested: true, insuredValueCents: 25000 });

  assert.equal(shippingOptionsProblem(letter(true, true, "250")), null);
  assert.deepEqual(buildShippingOptions(letter(true, true, "250")), { trackingRequested: true, insuranceRequested: true, insuredValueCents: 25000 });
  // El valor declarado se sigue exigiendo, con o sin Tracking.
  assert.equal(shippingOptionsProblem(letter(true, true, "50")).code, "INSURED_VALUE_INVALID");
  assert.equal(shippingOptionsProblem(letter(false, true, "50")).code, "INSURED_VALUE_INVALID");
  assert.equal(shippingOptionsProblem(letter(false, true, "")).code, "INSURED_VALUE_INVALID");
});

test("V2 cartas: la hoja deja pedir Insurance ON + Tracking OFF y manda exactamente lo elegido", () => {
  const source = sheet();
  // Cartas: su formulario tal cual (letterForward); sobre grande: por su tipo y sin seguro.
  assert.ok(source.includes("? { letterForward: true, trackingRequested, insuranceRequested, insuredValue }"));
  assert.ok(source.includes("shippingOptionsProblem(currentOptionsInput())"));
  assert.ok(source.includes("shippingOptions: buildShippingOptions(currentOptionsInput())"));
  assert.ok(/destinationVerified && !optionsProblem && !pending/.test(source), "sin opciones validas no se puede pedir");
  // Ni el aviso ni el texto de "Requires Add Tracking" de V1.
  assert.ok(!source.includes("{!trackingRequested && optionsProblem ? ("));
  assert.ok(!source.includes("Requires Add Tracking"));
  // El error del valor declarado se ve tambien sin Tracking.
  assert.ok(source.includes("const showValueProblem = insuranceRequested && String(insuredValue).trim() !== \"\" && insuredValueProblem(insuredValue);"));
  // Empiezan apagadas y solo cambian al pulsarlas.
  assert.ok(source.includes("const [trackingRequested, setTrackingRequested] = useState(false);"));
  assert.ok(source.includes("const [insuranceRequested, setInsuranceRequested] = useState(false);"));
  assert.equal((source.match(/setTrackingRequested\(/g) || []).length, 1, "solo el toque del cliente cambia el tracking");
  assert.ok(source.includes("describeForwardingOptionsError(error,"), "422/409 con su explicacion");
});

// ── Paquetes ─────────────────────────────────────────────────────────────────

test("paquetes: el seguro adicional no se pide nunca, y se dice por que", () => {
  assert.equal(insuranceAvailableFor("PACKAGE"), false);
  assert.equal(insuranceAvailableFor("LARGE_ENVELOPE"), false);
  assert.equal(insuranceAvailableFor("LETTER"), true);

  const problem = shippingOptionsProblem({ itemType: "PACKAGE", trackingRequested: true, insuranceRequested: true, insuredValue: "300" });
  assert.equal(problem.code, "INSURANCE_NOT_AVAILABLE_FOR_PACKAGES");
  assert.equal(problem.message, "Additional insurance is not available for packages yet.");
  // Aunque llegara encendido, viaja apagado y sin valor.
  assert.deepEqual(
    buildShippingOptions({ itemType: "PACKAGE", trackingRequested: true, insuranceRequested: true, insuredValue: "300" }),
    { trackingRequested: true, insuranceRequested: false }
  );

  const source = detail();
  assert.ok(source.includes("const insuranceAllowed = insuranceAvailableFor(item?.type);"));
  assert.ok(/description=\{insuranceUnavailableMessage\(item\?\.type\)\}\s*value=\{false\}\s*disabled/.test(source));
  assert.equal(PACKAGE_INSURANCE_UNAVAILABLE_MESSAGE, "Additional insurance is not available for packages yet.");
});

test("paquetes: Tracking OFF -> 422 sin tarifas, estado vacio y 'Turn on Add Tracking'", () => {
  const outcome = describeForwardingOptionsError(
    axiosError(422, {
      error: "All available package services include tracking. Turn on Add Tracking to see rates.",
      code: "FORWARDING_NO_COMPATIBLE_RATES",
      compatibility: {
        reason: "TRACKING_INCLUDED_IN_AVAILABLE_SERVICES",
        canEnableTracking: true,
        trackingRequested: false,
        insuranceRequested: false,
        excludedServices: [{ carrier: "USPS", serviceId: "PM" }, { carrier: "UPS", serviceId: "GND" }],
      },
    })
  );
  assert.equal(outcome.kind, "no-compatible-rates");
  assert.equal(outcome.reason, "TRACKING_INCLUDED_IN_AVAILABLE_SERVICES");
  assert.equal(outcome.canEnableTracking, true);
  assert.equal(outcome.excludedServices.length, 2);
  assert.equal(outcome.message, "All available package services include tracking. Turn on Add Tracking to see rates.", "la explicacion del backend");

  // Si el backend no dice que se puede, no se ofrece; y nunca con tracking ya pedido.
  assert.equal(describeCompatibility({ reason: "NO_SERVICE_MATCHES_OPTIONS" }).canEnableTracking, false);
  assert.equal(describeCompatibility({ reason: "TRACKING_INCLUDED_IN_AVAILABLE_SERVICES", canEnableTracking: true, trackingRequested: true }).canEnableTracking, false);
});

test("paquetes: el boton solo enciende la casilla al pulsarlo, y no cotiza solo", () => {
  const source = detail();
  assert.ok(source.includes('const enableTracking = () => onQuoteField("trackingRequested", true);'));
  assert.ok(/quoteEmpty\.canEnableTracking && !forwardForm\.trackingRequested \? \(\s*<Button[^>]*onPress=\{enableTracking\}>\s*Turn on Add Tracking/.test(source));
  // Nadie mas pone trackingRequested a true.
  assert.equal((source.match(/onQuoteField\("trackingRequested", true\)/g) || []).length, 1);
  assert.ok(!/setForwardForm\([^)]*trackingRequested: true/.test(source));
  assert.ok(source.includes("trackingRequested: false,\n  insuranceRequested: false,"), "empiezan apagadas");
  // El 422 de compatibilidad es un estado vacio, no un Alert de error.
  assert.ok(/outcome\.kind === "no-compatible-rates" \|\| outcome\.kind === "insurance-unavailable"\) \{\s*setQuoteEmpty\(outcome\);\s*return;/.test(source));
});

test("V2: las cuatro combinaciones dejan elegir lo que el backend ofrece y cumple lo pedido", () => {
  const response = {
    quoteId: "q1",
    environment: "production",
    rates: [
      rate("FCM"), // sin tracking ni seguro
      rate("PM", { tracked: true }),
      rate("PM-INS", { tracked: true, insured: "250.00" }),
      rate("PM-INS-OTRO", { tracked: true, insured: "100.00" }),
    ],
  };
  const ids = (options) => readQuoteResponse(response, options).rates.map((r) => r.optionId);

  // A: Tracking OFF no descarta las que traen seguimiento incluido; las aseguradas no (seguro no pedido).
  assert.deepEqual(ids({ trackingRequested: false, insuranceRequested: false }), ["FCM", "PM"]);
  // B: Tracking ON, solo las que lo traen.
  assert.deepEqual(ids({ trackingRequested: true, insuranceRequested: false }), ["PM"]);
  // C: carta con seguro y sin Tracking: los servicios asegurados (con seguimiento) por ese valor.
  assert.deepEqual(ids({ trackingRequested: false, insuranceRequested: true, insuredValueCents: 25000 }), ["PM-INS"]);
  // D: seguro y Tracking: lo mismo.
  assert.deepEqual(ids({ trackingRequested: true, insuranceRequested: true, insuredValueCents: 25000 }), ["PM-INS"]);
});

test("V2 carta con seguro y sin tracking: la cotizacion del backend se ensena y se puede elegir", () => {
  // Respuesta V2: los servicios que admiten el seguro (traen seguimiento incluido).
  const options = buildShippingOptions({ itemType: "LETTER", trackingRequested: false, insuranceRequested: true, insuredValue: "300" });
  assert.deepEqual(options, { trackingRequested: false, insuranceRequested: true, insuredValueCents: 30000 });
  const result = readQuoteResponse(
    { quoteId: "q-ins", rates: [rate("GA-INS", { tracked: true, insured: "300.00" }), rate("PM-INS", { tracked: true, insured: "300.00" })] },
    options
  );
  assert.deepEqual(result.rates.map((r) => r.optionId), ["GA-INS", "PM-INS"]);
  assert.equal(result.empty, null);
  assert.deepEqual(rateExtras(result.rates[0], money), ["Tracking included", "Insured for $300.00 (additional insurance)"]);
  // Pero nunca una tarifa sin el seguro pedido, ni por otro valor (no se paga un extra que no va).
  assert.equal(rateMatchesOptions(rate("GA", { tracked: true }), options), false);
  assert.equal(rateMatchesOptions(rate("GA-INS", { tracked: true, insured: "100.00" }), options), false);
});

test("V2 carta con seguro y tracking: solo los servicios asegurados con seguimiento", () => {
  const options = buildShippingOptions({ itemType: "LETTER", trackingRequested: true, insuranceRequested: true, insuredValue: "300" });
  const result = readQuoteResponse(
    { quoteId: "q-ins", rates: [rate("PM-INS", { tracked: true, insured: "300.00" }), rate("X-INS", { tracked: false, insured: "300.00" })] },
    options
  );
  assert.deepEqual(result.rates.map((r) => r.optionId), ["PM-INS"], "Tracking ON exige trackingIncluded");
});

test("una tarifa que no es lo pedido no se puede elegir (ni pagar)", () => {
  // V2: Tracking OFF no es una exclusion; una tarifa con seguimiento incluido vale.
  assert.equal(rateMatchesOptions(rate("PM", { tracked: true }), { trackingRequested: false }), true, "tracking incluido sin pedirlo, valido en V2");
  assert.equal(rateMatchesOptions(rate("FCM"), { trackingRequested: true }), false, "tracking pedido y no incluido");
  assert.equal(rateMatchesOptions(rate("PM", { tracked: true, insured: "250.00" }), { trackingRequested: true }), false, "no cuela seguro no pedido");
  assert.equal(rateMatchesOptions(rate("PM", { tracked: true }), { trackingRequested: true, insuranceRequested: true, insuredValueCents: 25000 }), false);
  assert.equal(rateMatchesOptions(rate("PM", { tracked: true, insured: "250.00" }), { trackingRequested: true, insuranceRequested: true, insuredValueCents: 25000 }), true);
  // insuranceRequested en la tarifa sin el servicio Ins no es un seguro.
  assert.equal(rateMatchesOptions({ ...rate("PM", { tracked: true }), insuranceRequested: true, insuredValueCents: 25000 }, { trackingRequested: true, insuranceRequested: true, insuredValueCents: 25000 }), false);
  assert.equal(rateMatchesOptions(undefined, { trackingRequested: false }), false);
});

test("200 sin tarifas (o todas descartadas) tambien es un estado vacio", () => {
  const empty = readQuoteResponse(
    { rates: [], compatibility: { reason: "INSURANCE_NOT_AVAILABLE_FOR_SERVICES", canEnableTracking: false } },
    { trackingRequested: true, insuranceRequested: true, insuredValueCents: 25000 }
  );
  assert.equal(empty.empty.reason, "INSURANCE_NOT_AVAILABLE_FOR_SERVICES");
  assert.match(empty.empty.message, /Turn off Add Insurance/);

  // Descartada: tracking pedido y la tarifa no lo trae.
  const discarded = readQuoteResponse({ rates: [rate("FCM")] }, { trackingRequested: true, insuranceRequested: false });
  assert.equal(discarded.discarded, 1);
  assert.equal(discarded.empty.reason, "NO_SERVICE_MATCHES_OPTIONS");
});

// ── Errores 422 y 409 ────────────────────────────────────────────────────────

test("422: cada motivo con su texto si el backend no manda mensaje", () => {
  for (const [reason, pattern] of [
    ["TRACKING_INCLUDED_IN_AVAILABLE_SERVICES", /includes tracking/],
    ["INSURANCE_REQUIRES_TRACKED_SERVICE", /tracked service/],
    ["INSURANCE_NOT_AVAILABLE_FOR_SERVICES", /can add insurance/],
    ["NO_SERVICE_MATCHES_OPTIONS", /No shipping service matches/],
  ]) {
    const outcome = describeForwardingOptionsError(axiosError(422, { code: "FORWARDING_NO_COMPATIBLE_RATES", compatibility: { reason } }));
    assert.equal(outcome.kind, "no-compatible-rates", reason);
    assert.match(outcome.message, pattern, reason);
  }
  // INSURANCE_NOT_AVAILABLE_FOR_PACKAGES: sin mensaje del backend, el de la pieza.
  assert.deepEqual(
    describeForwardingOptionsError(axiosError(422, { code: "INSURANCE_NOT_AVAILABLE_FOR_PACKAGES" }), undefined, { itemType: "PACKAGE" }),
    { kind: "insurance-unavailable", message: PACKAGE_INSURANCE_UNAVAILABLE_MESSAGE }
  );
  assert.equal(
    describeForwardingOptionsError(axiosError(422, { code: "INSURANCE_NOT_AVAILABLE_FOR_PACKAGES" }), undefined, { itemType: "LARGE_ENVELOPE" }).message,
    LARGE_ENVELOPE_INSURANCE_UNAVAILABLE_MESSAGE
  );
});

test("V2 paquete y sobre grande con seguro: el 422 ensena el texto del backend", () => {
  // Textos reales de ba3b11b (forwardingQuotes INSURANCE_UNAVAILABLE_MESSAGES).
  const pkg = "Additional insurance is not available for packages yet. Remove insurance to see the rates for this item.";
  const flat = "Additional insurance is not available for large envelopes yet. Remove insurance to see the rates for this item.";
  for (const [itemType, error] of [["PACKAGE", pkg], ["LARGE_ENVELOPE", flat], [undefined, pkg]]) {
    const outcome = describeForwardingOptionsError(axiosError(422, { code: "INSURANCE_NOT_AVAILABLE_FOR_PACKAGES", error }), undefined, { itemType });
    assert.deepEqual(outcome, { kind: "insurance-unavailable", message: error }, String(itemType));
  }
  // Es un estado vacio que se corrige quitando el seguro (no un Alert): el mismo camino que los 422 de compatibilidad.
  assert.ok(/outcome\.kind === "no-compatible-rates" \|\| outcome\.kind === "insurance-unavailable"\) \{\s*setQuoteEmpty\(outcome\);\s*return;/.test(detail()));
});

test("V2 paquete con Tracking OFF: sin exclusion por seguimiento", () => {
  const options = buildShippingOptions({ itemType: "PACKAGE", trackingRequested: false });
  assert.deepEqual(options, { trackingRequested: false, insuranceRequested: false });
  const result = readQuoteResponse({ quoteId: "q-pkg", rates: [rate("PM", { tracked: true }), rate("GA", { tracked: true }), rate("UPS-GND", { tracked: true })] }, options);
  assert.deepEqual(result.rates.map((r) => r.optionId), ["PM", "GA", "UPS-GND"]);
  assert.equal(result.empty, null, "no es un estado vacio");
});

test("V2: la tarifa elegida se conserva hasta que cambian las opciones", () => {
  const source = detail();
  // Elegir no borra: la seleccion solo se limpia en clearRates (que llama onQuoteField al cambiar una opcion).
  assert.ok(source.includes("setSelectedRateId(result.rates[0]?.optionId || \"\");"), "tras cotizar, la primera valida");
  const outsideClear = source.replace(/const clearRates = \(\) => \{[\s\S]*?\n  \};/, "");
  assert.equal((outsideClear.match(/setSelectedRateId\(""\)/g) || []).length, 1, "solo el onError de la cotizacion vacia la seleccion fuera de clearRates");
  // Lo que se elige es exactamente lo cotizado con estas opciones.
  assert.ok(source.includes("setQuotedOptions(result.rates.length ? shippingOptions : null);"));
  // Con tarifas V2 (seguimiento incluido sin pedirlo) la comprobacion de antes de elegir deja seguir.
  const options = { trackingRequested: false, insuranceRequested: false };
  assert.equal(rateMatchesOptions(rate("PM", { tracked: true }), options), true);
});

test("409: una cotizacion o tarifa obsoleta obliga a volver a cotizar", () => {
  assert.deepEqual(QUOTE_INVALID_CODES, [
    "FORWARDING_QUOTE_OUTDATED",
    "FORWARDING_RATE_OPTIONS_MISMATCH",
    "FORWARDING_QUOTE_OPTIONS_MISMATCH",
    "FORWARD_TRACKING_MISMATCH",
    "FORWARD_INSURANCE_MISMATCH",
  ]);
  for (const code of QUOTE_INVALID_CODES) {
    // Con el texto del backend (al elegir son para el cliente), ese; sin el, el de la app.
    const withText = describeForwardingOptionsError(axiosError(409, { code, error: "This quote is out of date. Get new rates." }));
    assert.equal(withText.kind, "quote-invalid", code);
    assert.equal(withText.message, "This quote is out of date. Get new rates.", code);
    assert.match(describeForwardingOptionsError(axiosError(409, { code })).message, /Get new rates/, code);
  }
  // Otros 409 no se confunden con estos.
  assert.equal(describeForwardingOptionsError(axiosError(409, { code: "FORWARD_ALREADY_REQUESTED", error: "Already" })).kind, "error");
  assert.equal(describeForwardingOptionsError({}).kind, "error", "sin respuesta");

  const source = detail();
  // Al elegir: el 409 borra las tarifas para que no se siga con ellas.
  assert.ok(/outcome\.kind === "quote-invalid"[^\n]*\) \{\s*clearRates\(\);/.test(source));
  // Antes de elegir: la tarifa tiene que ser de estas mismas opciones.
  assert.ok(source.includes("JSON.stringify(quotedOptions) !== JSON.stringify(options) || !rateMatchesOptions(rate, options)"));
});

test("409 al elegir con la cotizacion caducada o invalidada: se borran las tarifas y se vuelve a cotizar", () => {
  assert.deepEqual(QUOTE_STALE_CODES, ["FORWARDING_QUOTE_EXPIRED", "FORWARDING_QUOTE_UNAVAILABLE", "FORWARDING_QUOTE_INVALIDATED"]);
  for (const code of QUOTE_STALE_CODES) {
    const outcome = describeForwardingOptionsError(axiosError(409, { code, error: "Forwarding quote expired." }));
    assert.equal(outcome.kind, "quote-invalid", code);
    assert.equal(outcome.message, "Forwarding quote expired.", "el texto del backend");
    // Sin texto, el de la app, que no habla de Tracking/Insurance: no es ese el problema.
    const fallback = describeForwardingOptionsError(axiosError(409, { code }));
    assert.equal(fallback.message, QUOTE_STALE_MESSAGE, code);
    assert.doesNotMatch(fallback.message, /options you chose|tracking|insurance/i, code);
  }
  // El mensaje del Alert sale del resultado, no de una constante fija.
  assert.ok(detail().includes('Alert.alert("Get new rates", outcome.message);'));
});

test("pagos: la guarda de 3a17a0e (FORWARDING_QUOTE_INVALIDATED) bloquea el pago como los demas", () => {
  // Los de las casillas, mas el de la guarda de antes de cobrar (backend forwardChargeGuard GUARD_CODES).
  assert.deepEqual(QUOTE_OPTIONS_INVALID_CODES, [...QUOTE_INVALID_CODES, "FORWARDING_QUOTE_INVALIDATED"]);
  const guard = forwardPaymentError(axiosError(409, {
    code: "FORWARDING_QUOTE_INVALIDATED",
    error: "No payment was started: the quote of the selected rate is no longer valid for this request. Review this forwarding request.",
    charged: false,
    retryable: false,
  }));
  assert.equal(guard.kind, "quote-invalid");
  assert.equal(guard.retryable, false, "sin volver a ofrecer el boton");
  assert.equal(guard.charged, false);
  // El texto interno del backend ("Review this forwarding request") es para el centro, no para el cliente.
  assert.equal(guard.message, QUOTE_INVALID_PAYMENT_MESSAGE);
  assert.doesNotMatch(guard.message, /Review this forwarding request/);
});

test("pagos: con la tarifa desajustada no se paga", () => {
  for (const code of QUOTE_OPTIONS_INVALID_CODES) {
    const outcome = forwardPaymentError(axiosError(409, { code, charged: false }));
    assert.equal(outcome.kind, "quote-invalid", code);
    assert.equal(outcome.retryable, false, code);
    assert.equal(outcome.charged, false);
  }
});

// ── Invalidacion y respuestas tardias ────────────────────────────────────────

test("cambiar tracking, seguro o valor borra tarifas, seleccion y cotizacion, y no toca las opciones", () => {
  const source = detail();
  const clear = source.match(/const clearRates = \(\) => \{[\s\S]*?\n  \};/)[0];
  for (const reset of ["quoteGeneration.current += 1", 'setForwardQuoteId("")', "setForwardRates([])", 'setSelectedRateId("")', "setQuoteEmpty(null)", "setQuotedOptions(null)"]) {
    assert.ok(clear.includes(reset), reset);
  }
  assert.ok(!/setForwardForm/.test(clear), "las opciones del cliente se quedan");
  for (const field of ["trackingRequested", "insuranceRequested", "insuredValue"]) {
    assert.ok(source.includes('onQuoteField("' + field + '", value)'), field);
  }
  assert.ok(/const onQuoteField = \(field, value\) => \{\s*clearRates\(\);/.test(source));
});

test("una respuesta antigua no pisa la nueva, y se cotiza con las opciones del momento", () => {
  const source = detail();
  assert.ok(/onSuccess: \(data, \{ generation, shippingOptions \}\) => \{\s*if \(generation !== quoteGeneration\.current\) return;/.test(source));
  assert.ok(/onError: \(error, \{ generation \}\) => \{\s*if \(generation !== quoteGeneration\.current\) return;/.test(source));
  assert.ok(source.includes("quoteRates.mutate({ generation: quoteGeneration.current, shippingOptions: currentShippingOptions() });"));
  assert.ok(source.includes("mailItemId,\n        shippingOptions,\n        destinationAddress"), "manda las opciones congeladas al pedir");
  // Mientras se elige tarifa no se cambian las opciones.
  assert.equal((source.match(/disabled=\{selectRate\.isPending\}/g) || []).length, 2);
});

// ── Textos ───────────────────────────────────────────────────────────────────

test("fuera los textos que prometian lo que no hay", () => {
  for (const source of [detail(), sheet()]) {
    assert.ok(!source.includes("First-Class adds Certified Mail"));
    assert.ok(!source.includes("already included in every rate"));
    assert.ok(!source.includes('"Insured " +'));
    assert.ok(!/Covers the declared value/.test(source));
  }
  // El aviso de sandbox sigue el entorno que dice la cotizacion, no es fijo.
  assert.ok(detail().includes('ratesEnvironment === "sandbox"'));
});

test("'Tracking included' e 'Insured' solo si la tarifa lo trae", () => {
  assert.deepEqual(rateExtras(rate("FCM"), money), []);
  assert.deepEqual(rateExtras(rate("PM", { tracked: true }), money), ["Tracking included"]);
  assert.deepEqual(rateExtras(rate("PM", { tracked: true, insured: "250.00" }), money), ["Tracking included", "Insured for $250.00 (additional insurance)"]);
  // insuranceRequested / insuredValueCents sueltos no son un seguro contratado.
  assert.deepEqual(rateExtras({ ...rate("PM", { tracked: true }), insuranceRequested: true, insuredValueCents: 25000 }, money), ["Tracking included"]);
  assert.equal(insuredServiceValueCents({ specialServices: [{ specialServiceId: "DelCon" }] }), null);
  assert.equal(insuredServiceValueCents({ specialServices: [ins("0.00")] }), null);
  assert.ok(detail().includes("rateExtras(rate, formatMoneyFromCents)"));
});

// ── Aislamiento ──────────────────────────────────────────────────────────────

test("la logica de opciones no lleva ni APIs ni marcas: vale igual en Sandbox y Production", () => {
  const lib = read("../src/lib/forwarding-options.js");
  assert.doesNotMatch(lib, /https?:\/\//);
  assert.doesNotMatch(lib, /hdgexecutivesuites|theworx|sandbox-core/i);
  assert.doesNotMatch(lib, /(from\s+["']|require\(\s*["'])(\.\.\/)+brands/);
});

test("V2 es la misma regla en HDG y The Worx: ninguna marca la configura ni la cambia", () => {
  // La regla vive en el backend (igual en todos los centros); la app no tiene un ajuste por marca.
  const brands = read("../brands/index.js");
  assert.doesNotMatch(brands, /tracking|insurance|filterPolicy/i);
  const config = read("../app.config.js");
  assert.doesNotMatch(config, /tracking|insurance|filterPolicy/i);
  // Las pantallas que cotizan no preguntan por la marca.
  for (const source of [detail(), sheet()]) {
    assert.doesNotMatch(source, /brand\.(id|tenantSlug)\s*===|APP_BRAND/);
  }
});

// ── Contrato real 7de1ae9: LARGE_ENVELOPE, campos opcionales, pago tras 409 ──

test("LARGE_ENVELOPE OFF/OFF (V2): First-Class Flat y los servicios con seguimiento incluido se pueden elegir", () => {
  const response = {
    quoteId: "q-flat",
    rates: [
      rate("FCM-FLAT", { serviceName: "First-Class Mail Flat" }),
      rate("PM-FLAT", { tracked: true, specialServices: [{ specialServiceId: "DelCon", inputParameters: [] }] }),
    ],
  };
  const options = buildShippingOptions({ itemType: "LARGE_ENVELOPE", trackingRequested: false, insuranceRequested: false });
  assert.deepEqual(options, { trackingRequested: false, insuranceRequested: false });
  const result = readQuoteResponse(response, options);
  assert.deepEqual(result.rates.map((r) => r.optionId), ["FCM-FLAT", "PM-FLAT"], "Tracking OFF no excluye");
  assert.equal(result.empty, null, "no es un estado vacio");
  assert.deepEqual(rateExtras(result.rates[0], money), [], "ni 'Tracking included' ni 'Insured'");
});

test("LARGE_ENVELOPE Tracking ON: solo servicios con seguimiento (DelCon no es seguro)", () => {
  const response = {
    quoteId: "q-flat",
    rates: [rate("FCM-FLAT"), rate("PM-FLAT", { tracked: true, specialServices: [{ specialServiceId: "DelCon", inputParameters: [] }] })],
  };
  const result = readQuoteResponse(response, buildShippingOptions({ itemType: "LARGE_ENVELOPE", trackingRequested: true }));
  assert.deepEqual(result.rates.map((r) => r.optionId), ["PM-FLAT"]);
  assert.deepEqual(rateExtras(result.rates[0], money), ["Tracking included"]);
});

test("LARGE_ENVELOPE Insurance ON: la interfaz no deja pedirlo y nunca viaja", () => {
  assert.equal(insuranceAvailableFor("LARGE_ENVELOPE"), false);
  assert.equal(insuranceUnavailableMessage("LARGE_ENVELOPE"), "Additional insurance is not available for large envelopes yet.");
  assert.equal(insuranceUnavailableMessage("PACKAGE"), PACKAGE_INSURANCE_UNAVAILABLE_MESSAGE);
  const problem = shippingOptionsProblem({ itemType: "LARGE_ENVELOPE", trackingRequested: true, insuranceRequested: true, insuredValue: "150" });
  assert.equal(problem.code, "INSURANCE_NOT_AVAILABLE_FOR_PACKAGES");
  assert.equal(problem.message, LARGE_ENVELOPE_INSURANCE_UNAVAILABLE_MESSAGE);
  for (const itemType of ["LARGE_ENVELOPE", "PACKAGE", "large_envelope"]) {
    const options = buildShippingOptions({ itemType, trackingRequested: true, insuranceRequested: true, insuredValue: "150" });
    assert.equal(options.insuranceRequested, false, itemType);
    assert.equal("insuredValueCents" in options, false, itemType);
  }
  // Las cartas siguen pudiendo, por su formulario.
  assert.equal(buildShippingOptions({ letterForward: true, trackingRequested: true, insuranceRequested: true, insuredValue: "150" }).insuredValueCents, 15000);
});

test("paquete (V2): Tracking OFF y ON ensenan los servicios con seguimiento incluido", () => {
  const all = { quoteId: "q-pkg", rates: [rate("PM", { tracked: true }), rate("GA", { tracked: true })] };
  const off = readQuoteResponse(all, buildShippingOptions({ itemType: "PACKAGE", trackingRequested: false }));
  assert.deepEqual(off.rates.map((r) => r.optionId), ["PM", "GA"]);
  assert.equal(off.empty, null);
  const on = readQuoteResponse(all, buildShippingOptions({ itemType: "PACKAGE", trackingRequested: true }));
  assert.deepEqual(on.rates.map((r) => r.optionId), ["PM", "GA"]);
});

test("contrato real: nulls y campos opcionales no rompen nada", () => {
  const plain = rate("FCM"); // estimados null, specialServices [], insuredValueCents 0
  assert.equal(rateMatchesOptions(plain, { trackingRequested: false, insuranceRequested: false }), true);
  assert.equal(rateMatchesOptions({ ...plain, insuredValueCents: null }, { trackingRequested: false }), true);
  const withoutField = { ...plain };
  delete withoutField.insuredValueCents;
  assert.equal(rateMatchesOptions(withoutField, { trackingRequested: false }), true);
  assert.equal(rateMatchesOptions({ ...plain, insuredValueCents: 15000 }, { trackingRequested: false }), false, "seguro no pedido");
  const insured = rate("PM-INS", { tracked: true, insured: "150.00" });
  assert.equal(insured.insuredValueCents, 15000);
  assert.equal(rateMatchesOptions(insured, { trackingRequested: true, insuranceRequested: true, insuredValueCents: 15000 }), true);
  assert.equal(
    rateMatchesOptions({ ...insured, insuredValueCents: 10000 }, { trackingRequested: true, insuranceRequested: true, insuredValueCents: 15000 }),
    false
  );

  // 422 al crear la solicitud de una carta: sin failedCarriers.
  const letter = describeForwardingOptionsError(
    axiosError(422, {
      error: "Insurance needs tracking",
      code: "FORWARDING_NO_COMPATIBLE_RATES",
      compatibility: { reason: "INSURANCE_REQUIRES_TRACKED_SERVICE", trackingRequested: false, insuranceRequested: true, canEnableTracking: true, excludedServices: [] },
    })
  );
  assert.equal(letter.kind, "no-compatible-rates");
  assert.deepEqual(letter.failedCarriers, []);
  assert.equal(letter.message, "Insurance needs tracking");
  // Cotizacion: failedCarriers en la raiz.
  const quote = describeForwardingOptionsError(
    axiosError(422, { error: "e", code: "FORWARDING_NO_COMPATIBLE_RATES", compatibility: { reason: "NO_SERVICE_MATCHES_OPTIONS" }, failedCarriers: ["UPS"] })
  );
  assert.deepEqual(quote.failedCarriers, ["UPS"]);
  assert.equal(describeForwardingOptionsError(axiosError(422, { error: "e", code: "FORWARDING_NO_COMPATIBLE_RATES" })).reason, "NO_SERVICE_MATCHES_OPTIONS");
  // 400 de validacion: error y details, sin code.
  const bad = describeForwardingOptionsError(axiosError(400, { error: "Invalid body", details: [{ path: "shippingOptions.insuredValueCents" }] }));
  assert.deepEqual([bad.kind, bad.code, bad.message], ["error", null, "Invalid body"]);
  assert.equal(describeForwardingOptionsError(axiosError(400, undefined), "fallback").message, "fallback");
});

test("Insured solo con Ins y su valor; insuredValueCents solo no lo es", () => {
  assert.deepEqual(rateExtras(rate("PM-INS", { tracked: true, insured: "150.00" }), money), [
    "Tracking included",
    "Insured for $150.00 (additional insurance)",
  ]);
  assert.deepEqual(rateExtras({ ...rate("PM", { tracked: true }), insuredValueCents: 15000 }, money), ["Tracking included"]);
  assert.deepEqual(rateExtras({ ...rate("PM"), specialServices: [{ specialServiceId: "Ins", inputParameters: [] }] }, money), []);
});

test("409 al pagar: tarifa descartada y sin boton de pago hasta que llegue otra", () => {
  const request = {
    id: "sr-1",
    forwardDetails: { quotedCarrier: "USPS", quotedService: "PM", quotedAmountCents: 1200, quotedAt: "2026-11-20T10:00:00Z", paymentStatus: "NOT_STARTED" },
  };
  for (const code of QUOTE_OPTIONS_INVALID_CODES) {
    const outcome = forwardPaymentError(axiosError(409, { error: "stale", code }));
    assert.equal(outcome.kind, "quote-invalid", code);
    assert.equal(outcome.retryable, false, code);
    assert.equal(outcome.message, QUOTE_INVALID_PAYMENT_MESSAGE);
  }
  assert.match(QUOTE_INVALID_PAYMENT_MESSAGE, /New rates are needed/);

  const blockedKey = paymentRateKey(request);
  assert.equal(isQuoteBlocked(blockedKey, request), true);
  // Solo cambia el estado del pago: sigue bloqueado (es la misma tarifa).
  assert.equal(isQuoteBlocked(blockedKey, { ...request, forwardDetails: { ...request.forwardDetails, paymentStatus: "FAILED" }, updatedAt: "x" }), true);
  // Cotizacion nueva: se puede pagar con normalidad.
  assert.equal(isQuoteBlocked(blockedKey, { ...request, forwardDetails: { ...request.forwardDetails, quotedAmountCents: 1500, quotedAt: "2026-11-21T10:00:00Z" } }), false);
  assert.equal(isQuoteBlocked(null, request), false, "sin 409, nada bloqueado");
  // Otra solicitud nunca hereda el bloqueo.
  assert.equal(isQuoteBlocked(blockedKey, { ...request, id: "sr-2" }), false);

  // Las dos pantallas de pago lo aplican, sin reintento.
  for (const file of ["../src/components/common/stripe-forward-payment.jsx", "../src/components/common/zoho-forward-payment-card.jsx"]) {
    const source = read(file);
    assert.ok(source.includes("const quoteBlocked = isQuoteBlocked(invalidQuoteKey, request);"), file);
    assert.ok(/outcome\.kind === "quote-invalid"\) \{\s*\/\/[^\n]*\n\s*setInvalidQuoteKey\(paymentRateKey\(request\)\);/.test(source), file);
    assert.ok(source.includes("{quoteBlocked ? <Notice tone=\"amber\">{QUOTE_INVALID_PAYMENT_MESSAGE}</Notice> : null}"), file);
  }
  const stripe = read("../src/components/common/stripe-forward-payment.jsx");
  assert.ok(stripe.includes("const canOffer = decision.action !== ACTION_NONE && !status.waiting && !quoteBlocked;"));
  assert.ok(/lock\.run\(async \(\) => \{\s*if \(quoteBlocked\) return;/.test(stripe), "ni una pulsacion pendiente paga");
  const zoho = read("../src/components/common/zoho-forward-payment-card.jsx");
  assert.ok(zoho.includes('const blocked = quoteBlocked || ["review", "cancelled", "refunded"].includes(reading?.state);'));
  assert.ok(zoho.includes("lock.run(() => (quoteBlocked ? Promise.resolve() : mutation.mutateAsync(variables).catch(() => {})));"));
  assert.ok(/setInvalidQuoteKey\(paymentRateKey\(request\)\);\s*setInvoice\(null\);/.test(zoho), "la factura revisada se descarta");
});

test("LARGE_ENVELOPE en pantalla: casilla de seguro deshabilitada con su texto, tracking opcional", () => {
  const source = detail();
  assert.ok(source.includes("description={insuranceUnavailableMessage(item?.type)}"));
  assert.ok(source.includes('describeForwardingOptionsError(error, undefined, { itemType: item?.type })'));
  assert.ok(!source.includes("PACKAGE_INSURANCE_UNAVAILABLE_MESSAGE"), "el texto depende del tipo");
  assert.ok(source.includes('onValueChange={(value) => onQuoteField("trackingRequested", value)}'));
});
