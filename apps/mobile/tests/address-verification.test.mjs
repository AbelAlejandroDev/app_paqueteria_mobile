import test from "node:test";
import assert from "node:assert/strict";

import {
  addressErrorMessage,
  describeAddressVerification,
  forwardDestinationFields,
  isAddressUsableForForwarding,
  isVerifiedCheck,
  sameAddress,
  serverVerifiesAddresses,
  verifyPayload,
} from "../src/lib/address-verification.js";

const saved = (status, extra = {}) => ({
  id: "addr_1",
  recipient: "Ana",
  addressLine1: "1 Main St",
  city: "Orlando",
  state: "FL",
  zip: "32801",
  verification: status ? { status, verifiedAt: null, message: null } : null,
  ...extra,
});

test("solo una direccion VERIFIED sirve de destino", () => {
  assert.equal(isAddressUsableForForwarding(saved("VERIFIED")), true);
  assert.equal(isAddressUsableForForwarding(saved("UNVERIFIED")), false);
  assert.equal(isAddressUsableForForwarding(saved("INVALID")), false);
  // verification: null tambien es un servidor que verifica, sin estado.
  assert.equal(isAddressUsableForForwarding(saved(null)), false);
  assert.equal(isAddressUsableForForwarding(null), false);
});

test("un servidor sin verificacion (sin la clave verification) no bloquea", () => {
  const legacy = { id: "a", addressLine1: "1 Main St" };
  assert.equal(serverVerifiesAddresses(legacy), false);
  assert.equal(isAddressUsableForForwarding(legacy), true);
});

test("el estado se traduce a etiqueta y tono; uno desconocido cuenta como sin verificar", () => {
  assert.equal(describeAddressVerification({ status: "VERIFIED" }).label, "Verified address");
  assert.equal(describeAddressVerification({ status: "INVALID" }).tone, "error");
  assert.equal(describeAddressVerification({ status: "SOMETHING" }).status, "UNVERIFIED");
  assert.equal(describeAddressVerification(null).tone, "warning");
  assert.equal(describeAddressVerification({ status: "INVALID", message: "BAD_ZIP" }).message, "BAD_ZIP");
});

test("una guardada viaja por su id; campos sueltos solo sin verificacion o sin id", () => {
  assert.deepEqual(forwardDestinationFields(saved("VERIFIED")), { addressId: "addr_1" });

  const typed = forwardDestinationFields({
    recipient: "Ana",
    addressLine1: "1 Main St",
    addressLine2: " ",
    city: "Orlando",
    state: "FL",
    zip: "32801",
    phone: "+13055551234",
  });
  assert.equal(typed.addressId, undefined);
  assert.equal(typed.destinationName, "Ana");
  assert.equal(typed.address2, undefined);
  assert.equal(typed.country, "US");
});

test("los errores de direccion dicen lo que dijo el transportista", () => {
  const err = (data) => ({ response: { data } });

  assert.match(
    addressErrorMessage(err({ code: "ADDRESS_VERIFICATION_UNAVAILABLE", error: "x" })),
    /try again/i
  );
  assert.equal(
    addressErrorMessage(err({ code: "ADDRESS_NOT_DELIVERABLE", error: "Not deliverable", providerMessage: "Invalid ZIP" })),
    "Not deliverable (Invalid ZIP)"
  );
  assert.equal(
    addressErrorMessage(err({ code: "FORWARD_DESTINATION_NOT_VERIFIED", error: "Verify it first" })),
    "Verify it first"
  );
  assert.equal(addressErrorMessage(err({ error: "Other" }), "fallback"), "Other");
  assert.equal(addressErrorMessage({}, "fallback"), "fallback");
});

test("verified: true con estado de rechazo no cuenta (servidor anterior)", () => {
  assert.equal(isVerifiedCheck({ verified: true, status: "VERIFIED" }), true);
  assert.equal(isVerifiedCheck({ verified: true, status: "VALIDATION_FAILED" }), false);
  assert.equal(isVerifiedCheck({ verified: false, code: "ADDRESS_NOT_DELIVERABLE" }), false);
});

test("el cuerpo de verificacion recorta y omite los opcionales vacios", () => {
  assert.deepEqual(
    verifyPayload({ recipient: " Ana ", company: " ", addressLine1: "1 Main St ", addressLine2: "", city: "Orlando", state: "FL", zip: " 32801", phone: "" }),
    { recipient: "Ana", company: undefined, addressLine1: "1 Main St", addressLine2: undefined, city: "Orlando", state: "FL", zip: "32801", phone: undefined }
  );
});

test("la sugerencia del transportista solo se ofrece si cambia algo", () => {
  const typed = { addressLine1: "1 main st", city: "orlando", state: "FL", zip: "32801" };
  assert.equal(sameAddress(typed, { addressLine1: "1  MAIN ST", city: "ORLANDO", state: "fl", zip: "32801" }), true);
  assert.equal(sameAddress(typed, { addressLine1: "1 MAIN ST", city: "ORLANDO", state: "FL", zip: "32801-1234" }), false);
});
