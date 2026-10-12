import test from "node:test";
import assert from "node:assert/strict";

import { formatEventTime } from "../src/lib/mail-item-detail.js";

// Fechas locales: la funcion compara dias del calendario del telefono.
const now = new Date(2026, 9, 11, 15, 0);

test("un evento de hoy dice Today con la hora", () => {
  assert.equal(formatEventTime(new Date(2026, 9, 11, 10, 42), now), "Today, 10:42 AM");
});

test("uno de ayer dice Yesterday aunque hayan pasado menos de 24 horas", () => {
  assert.equal(formatEventTime(new Date(2026, 9, 10, 23, 5), now), "Yesterday, 11:05 PM");
});

test("los anteriores llevan el dia, y el año solo si no es el actual", () => {
  assert.equal(formatEventTime(new Date(2026, 2, 4, 9, 15), now), "Mar 4, 9:15 AM");
  assert.equal(formatEventTime(new Date(2025, 11, 30, 9, 15), now), "Dec 30, 2025, 9:15 AM");
});

test("sin fecha o con una invalida no pinta nada", () => {
  assert.equal(formatEventTime(null, now), "");
  assert.equal(formatEventTime("no es fecha", now), "");
});
