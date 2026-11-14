import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { findDefaultAddress, forwardFieldsFromAddress, FORWARDING_ADDRESSES_KEY } from "../src/lib/forwarding-addresses.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const detail = () => read("../src/app/(client)/mail-items/[id].jsx");

test("la predeterminada es la que marca el backend, no la primera", () => {
  const first = { id: "a", isDefault: false };
  const marked = { id: "b", isDefault: true };
  assert.equal(findDefaultAddress([first, marked]), marked);
});

test("sin marca no hay predeterminada", () => {
  assert.equal(findDefaultAddress([{ id: "a", isDefault: false }, { id: "b" }]), null);
  assert.equal(findDefaultAddress([]), null);
  assert.equal(findDefaultAddress(undefined), null);
});

test("rellena con los campos de la direccion guardada", () => {
  assert.deepEqual(
    forwardFieldsFromAddress({ name: "Ana", addressLine1: "1 Main", addressLine2: null, city: "Orlando", state: "FL", zip: "32801", phone: "+14075550100", isDefault: true }),
    { recipient: "Ana", address1: "1 Main", address2: "", city: "Orlando", state: "FL", zip: "32801", phone: "+14075550100" },
  );
});

test("sin telefono deja el campo vacio, para que la validacion lo pida", () => {
  assert.equal(forwardFieldsFromAddress({ name: "Ana", phone: null }).phone, "");
});

test("el boton ya no lee el perfil del cliente", () => {
  const source = detail();
  assert.equal(/user\?\.clientProfile/.test(source), false);
  assert.equal(/defaultAddress\.fullName/.test(source), false);
  assert.ok(source.includes("findDefaultAddress(addressesQuery.data)"));
  assert.ok(source.includes("forwardFieldsFromAddress(defaultAddress)"));
});

test("usar la predeterminada invalida las tarifas", () => {
  const handler = detail().match(/const useDefaultAddress = [\s\S]*?\n  };/)[0];
  assert.ok(handler.includes("clearRates()"));
});

test("una cotizacion que llega tarde no repone tarifas de otro destino", () => {
  const source = detail();
  assert.ok(source.includes("quoteGeneration.current += 1"));
  assert.ok(/if \(generation !== quoteGeneration\.current\) return;/.test(source));
});

test("el telefono es obligatorio para cotizar", () => {
  assert.ok(/forwardForm\.zip && forwardForm\.phone/.test(detail()));
});

test("Settings y el reenvio comparten la clave", () => {
  assert.deepEqual(FORWARDING_ADDRESSES_KEY, ["client-forwarding-addresses"]);
  assert.ok(read("../src/app/(client)/settings/forwarding-addresses.jsx").includes("FORWARDING_ADDRESSES_KEY"));
});

test("la cache se vacia al cambiar de usuario", () => {
  assert.ok(/previousUserId\.current !== currentUserId\) queryClient\.clear\(\)/.test(read("../src/context/AuthContext.jsx")));
});

test("cartas: una guardada sin telefono lo pide y lo manda con la peticion", () => {
  const sheet = read("../src/components/common/letter-forward-sheet.jsx");
  assert.ok(/selectedNeedsPhone = !addingAddress && Boolean\(selectedAddress\) && !String\(selectedAddress\.phone/.test(sheet));
  assert.ok(sheet.includes("(!selectedNeedsPhone || destinationPhone.trim())"));
  assert.ok(sheet.includes("...(selectedNeedsPhone ? { phone: destinationPhone.trim() } : {})"));
  assert.ok(!sheet.includes('api.patch'), "no toca la direccion guardada");
});

test("el aviso de sandbox sigue al entorno real de la cotizacion", () => {
  const source = detail();
  assert.equal(source.includes("Labels are not purchased yet"), false);
  assert.ok(source.includes('setRatesEnvironment(data?.environment || "")'));
  assert.ok(source.includes('ratesEnvironment === "sandbox"'));
});
