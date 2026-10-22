import test from "node:test";
import assert from "node:assert/strict";

import { cardPlacement, highlightRect } from "../src/lib/tour-layout.js";

const phone = { width: 390, height: 844 };
const small = { width: 320, height: 568 };
const insets = { top: 47, bottom: 34 };

const overlaps = (card, cardHeight, hole) => card.top < hole.y + hole.height && card.top + cardHeight > hole.y;

test("el resaltado añade margen y no se sale de la pantalla", () => {
  assert.deepEqual(highlightRect({ x: 2, y: 100, width: 50, height: 40 }, phone), { x: 0, y: 92, width: 60, height: 56 });
  assert.equal(highlightRect(null, phone), null);
});

test("un elemento arriba lleva la tarjeta debajo, sin taparlo", () => {
  const hole = highlightRect({ x: 16, y: 180, width: 358, height: 160 }, phone);
  const card = cardPlacement({ highlight: hole, window: phone, insets, cardHeight: 200 });
  assert.equal(card.placement, "below");
  assert.equal(overlaps(card, 200, hole), false);
});

test("una pestaña de la barra inferior lleva la tarjeta encima", () => {
  const hole = highlightRect({ x: 80, y: 780, width: 78, height: 56 }, phone);
  const card = cardPlacement({ highlight: hole, window: phone, insets, cardHeight: 200 });
  assert.equal(card.placement, "above");
  assert.equal(overlaps(card, 200, hole), false);
});

test("en un telefono pequeño tambien respeta las zonas seguras", () => {
  const hole = highlightRect({ x: 10, y: 120, width: 300, height: 330 }, small);
  const card = cardPlacement({ highlight: hole, window: small, insets, cardHeight: 220 });
  assert.ok(card.top >= insets.top);
  assert.ok(card.top + 220 <= small.height - insets.bottom);
});

test("sin elemento que resaltar la tarjeta va centrada", () => {
  const card = cardPlacement({ highlight: null, window: phone, insets, cardHeight: 300 });
  assert.equal(card.placement, "center");
  assert.equal(card.top, (844 - 300) / 2);
});
