/**
 * Comprobaciones sobre el codigo fuente de dos pantallas.
 *
 * No son pruebas de render: el proyecto no tiene un renderizador de React
 * Native para tests y no se ha añadido ninguna dependencia para esto. Lo que
 * aseguran es que el codigo que produce el comportamiento esta ahi y no
 * vuelve por descuido. Lo visual hay que verlo en dispositivo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("22. Keep me logged in ya no aparece en Security", () => {
  const source = read("../src/app/(client)/settings/security.jsx");
  assert.equal(/Keep me logged in/i.test(source), false);
  assert.equal(source.includes("keepLoggedIn"), false);
});

test("23. las pestanas de Billing no permiten varias lineas", () => {
  const source = read("../src/components/ui/segmented-control.jsx");
  assert.ok(source.includes("numberOfLines={1}"), "la etiqueta queda en una linea");
  assert.ok(/flexShrink:\s*0/.test(source), "la pestana nunca encoge por debajo de su texto");
  assert.ok(source.includes("horizontal"), "si no caben, se desplaza en horizontal");
  // No se resuelve bajando la letra.
  assert.equal(/text-(xs|\[\d+px\])/.test(source), false);
});
