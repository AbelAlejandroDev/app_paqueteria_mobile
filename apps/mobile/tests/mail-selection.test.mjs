import test from "node:test";
import assert from "node:assert/strict";

import {
  availableActionsFor,
  bulkActionSummary,
  bulkRequestBody,
  canBulkRequest,
  isSelectable,
  selectedItemsFrom,
  toggleAll,
  toggleId,
} from "../src/lib/mail-selection.js";

const req = (type, status) => ({ id: type + status, type, status, createdAt: "2026-09-15T10:00:00Z" });
const item = (id, extra = {}) => ({ id, type: "LETTER", status: "RECEIVED", serviceRequests: [], ...extra });

test("las acciones siguen la misma regla que el backend", () => {
  assert.deepEqual(availableActionsFor(item("a")), {
    canRequestScan: true,
    canRequestForward: true,
    canRequestPickup: true,
    canRequestDiscard: true,
  });

  // Un escaneo en marcha no bloquea destinos, pero si descartar.
  const scanning = availableActionsFor(item("b", { status: "SCAN_REQUESTED", serviceRequests: [req("SCAN", "OPEN")] }));
  assert.equal(scanning.canRequestForward, true);
  assert.equal(scanning.canRequestScan, false);
  assert.equal(scanning.canRequestDiscard, false);

  // Un destino en marcha bloquea los demas destinos.
  const forwarding = availableActionsFor(item("c", { serviceRequests: [req("FORWARD", "PROCESSING")] }));
  assert.equal(forwarding.canRequestForward, false);
  assert.equal(forwarding.canRequestDiscard, false);

  // Un rechazo ya no cuenta como en marcha.
  assert.equal(availableActionsFor(item("d", { serviceRequests: [req("FORWARD", "REJECTED")] })).canRequestForward, true);

  for (const status of ["PICKED_UP", "FORWARDED", "DISCARDED", "ARCHIVED"]) {
    assert.equal(isSelectable(item("t", { status })), false, status);
  }
});

test("el reenvio en grupo es solo de cartas; un paquete no se escanea", () => {
  const pkg = item("p", { type: "PACKAGE" });
  assert.equal(canBulkRequest(pkg, "FORWARD"), false);
  assert.equal(canBulkRequest(pkg, "SCAN"), false);
  assert.equal(canBulkRequest(pkg, "DISCARD"), true);
  assert.equal(isSelectable(pkg), true, "se puede marcar para descartar");
  assert.equal(canBulkRequest(item("s", { status: "SCANNED" }), "SCAN"), false);
});

test("el resumen dice cuantas de las elegidas admite cada solicitud", () => {
  const selected = [
    item("a"),
    item("b", { status: "SCAN_REQUESTED", serviceRequests: [req("SCAN", "OPEN")] }),
    item("c", { type: "PACKAGE" }),
  ];
  const byAction = Object.fromEntries(bulkActionSummary(selected).map((s) => [s.action, s]));

  assert.deepEqual(byAction.FORWARD.eligible.map((i) => i.id), ["a", "b"]);
  assert.equal(byAction.FORWARD.skipped, 1);
  assert.deepEqual(byAction.SCAN.eligible.map((i) => i.id), ["a"]);
  assert.deepEqual(byAction.DISCARD.eligible.map((i) => i.id), ["a", "c"]);
});

test("marcar, marcar todas y desmarcar todas", () => {
  const items = [item("a"), item("b"), item("x", { status: "FORWARDED" })];

  assert.deepEqual(toggleId([], "a"), ["a"]);
  assert.deepEqual(toggleId(["a"], "a"), []);

  const all = toggleAll([], items);
  assert.deepEqual(all, ["a", "b"], "la que no se puede marcar se queda fuera");
  assert.deepEqual(toggleAll(all, items), []);
  assert.deepEqual(toggleAll(["a"], items), ["a", "b"]);
});

test("tras refrescar la lista solo cuentan las que siguen y siguen siendo seleccionables", () => {
  const items = [item("a"), item("b", { status: "DISCARDED" })];
  assert.deepEqual(selectedItemsFrom(["a", "b", "gone"], items).map((i) => i.id), ["a"]);
});

test("una sola solicitud con todas las piezas", () => {
  const items = [item("a"), item("b")];
  assert.deepEqual(bulkRequestBody("SCAN", items), {
    type: "SCAN",
    mailItemId: "a",
    mailItemIds: ["a", "b"],
    chargeConsent: true,
  });
  assert.deepEqual(bulkRequestBody("DISCARD", items), { type: "DISCARD", mailItemId: "a", mailItemIds: ["a", "b"] });
});
