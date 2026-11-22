import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildShippingOptions,
  describeCompatibility,
  describeForwardingOptionsError,
  INSURANCE_REQUIRES_TRACKING_MESSAGE,
  insuranceAvailableFor,
  insuredServiceValueCents,
  insuredValueProblem,
  PACKAGE_INSURANCE_UNAVAILABLE_MESSAGE,
  parseInsuredValueCents,
  QUOTE_INVALID_CODES,
  rateExtras,
  rateMatchesOptions,
  readQuoteResponse,
  shippingOptionsProblem,
} from "../src/lib/forwarding-options.js";
import { forwardPaymentError, QUOTE_OPTIONS_INVALID_CODES } from "../src/lib/forward-payment.js";

/**
 * Add Tracking / Add Insurance con el filtrado estricto del backend 7de1ae9.
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

test("cartas: OFF/OFF, ON/OFF y ON/ON salen tal cual; OFF/ON no se puede pedir", () => {
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

  // Seguro sin seguimiento: bloqueado con el motivo, antes de tocar la red.
  const blocked = shippingOptionsProblem(letter(false, true, "250"));
  assert.equal(blocked.code, "INSURANCE_REQUIRES_TRACKED_SERVICE");
  assert.equal(blocked.message, INSURANCE_REQUIRES_TRACKING_MESSAGE);

  assert.equal(shippingOptionsProblem(letter(true, true, "250")), null);
  assert.deepEqual(buildShippingOptions(letter(true, true, "250")), { trackingRequested: true, insuranceRequested: true, insuredValueCents: 25000 });
  assert.equal(shippingOptionsProblem(letter(true, true, "50")).code, "INSURED_VALUE_INVALID");
  assert.equal(shippingOptionsProblem(letter(true, true, "")).code, "INSURED_VALUE_INVALID");
});

test("cartas: la hoja bloquea Insurance ON + Tracking OFF y manda exactamente lo elegido", () => {
  const source = sheet();
  assert.ok(source.includes("shippingOptionsProblem({ letterForward: true, trackingRequested, insuranceRequested, insuredValue })"));
  assert.ok(/destinationVerified && !optionsProblem && !pending/.test(source), "sin opciones validas no se puede pedir");
  assert.ok(source.includes("{!trackingRequested && optionsProblem ? ("), "explica por que");
  assert.ok(source.includes("shippingOptions: buildShippingOptions({ letterForward: true, trackingRequested, insuranceRequested, insuredValue })"));
  // Empiezan apagadas y solo cambian al pulsarlas.
  assert.ok(source.includes("const [trackingRequested, setTrackingRequested] = useState(false);"));
  assert.ok(source.includes("const [insuranceRequested, setInsuranceRequested] = useState(false);"));
  assert.equal((source.match(/setTrackingRequested\(/g) || []).length, 1, "solo el toque del cliente cambia el tracking");
  assert.ok(source.includes("describeForwardingOptionsError(error,"), "422/409 con su explicacion");
});

// ── Paquetes ─────────────────────────────────────────────────────────────────

test("paquetes: el seguro adicional no se pide nunca, y se dice por que", () => {
  assert.equal(insuranceAvailableFor("PACKAGE"), false);
  assert.equal(insuranceAvailableFor("LARGE_ENVELOPE"), true);
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
  assert.ok(/description=\{PACKAGE_INSURANCE_UNAVAILABLE_MESSAGE\}\s*value=\{false\}\s*disabled/.test(source));
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

test("paquetes y sobres: las cuatro combinaciones solo dejan elegir lo que se pidio", () => {
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

  assert.deepEqual(ids({ trackingRequested: false, insuranceRequested: false }), ["FCM"]); // A
  assert.deepEqual(ids({ trackingRequested: true, insuranceRequested: false }), ["PM"]); // B
  // C: seguro sin seguimiento -> ninguna, y se explica.
  const c = readQuoteResponse({ quoteId: "q1", rates: [rate("FCM")] }, { trackingRequested: false, insuranceRequested: true, insuredValueCents: 25000 });
  assert.deepEqual(c.rates, []);
  assert.equal(c.empty.kind, "no-compatible-rates");
  assert.deepEqual(ids({ trackingRequested: true, insuranceRequested: true, insuredValueCents: 25000 }), ["PM-INS"]); // D, mismo valor
});

test("una tarifa que no es lo pedido no se puede elegir (ni pagar)", () => {
  assert.equal(rateMatchesOptions(rate("PM", { tracked: true }), { trackingRequested: false }), false, "no cuela tracking no pedido");
  assert.equal(rateMatchesOptions(rate("FCM"), { trackingRequested: true }), false);
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

  const discarded = readQuoteResponse({ rates: [rate("PM", { tracked: true })] }, { trackingRequested: false, insuranceRequested: false });
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
  assert.deepEqual(
    describeForwardingOptionsError(axiosError(422, { code: "INSURANCE_NOT_AVAILABLE_FOR_PACKAGES", error: "x" })),
    { kind: "insurance-unavailable", message: PACKAGE_INSURANCE_UNAVAILABLE_MESSAGE }
  );
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
    const outcome = describeForwardingOptionsError(axiosError(409, { code, error: "stale" }));
    assert.equal(outcome.kind, "quote-invalid", code);
    assert.match(outcome.message, /Get new rates/);
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

test("pagos: con la tarifa desajustada no se paga", () => {
  assert.deepEqual(QUOTE_OPTIONS_INVALID_CODES, QUOTE_INVALID_CODES);
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
