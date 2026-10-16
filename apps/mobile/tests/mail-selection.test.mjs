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
    canRejectAssignment: true,
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

test("Not mine: cualquier pieza sin un destino en marcha", async () => {
  const { canBulkRequest: can } = await import("../src/lib/mail-selection.js");
  assert.equal(can(item("a"), "NOT_MINE"), true);
  assert.equal(can(item("s", { status: "SCAN_REQUESTED", serviceRequests: [req("SCAN", "OPEN")] }), "NOT_MINE"), true);
  assert.equal(can(item("f", { serviceRequests: [req("PICKUP", "OPEN")] }), "NOT_MINE"), false);
  assert.equal(can(item("t", { status: "PICKED_UP" }), "NOT_MINE"), false);
});

test("una opcion no disponible dice por que", async () => {
  const { bulkActionSummary: summary, bulkBlockReasons } = await import("../src/lib/mail-selection.js");
  const pkg = item("p", { type: "PACKAGE" });

  const scan = summary([pkg]).find((s) => s.action === "SCAN");
  assert.equal(scan.eligible.length, 0);
  assert.deepEqual(scan.reasons.map((r) => r.text), ["Packages can't be scanned."]);

  const mixed = [
    item("p1", { type: "PACKAGE" }),
    item("p2", { type: "PACKAGE" }),
    item("s1", { status: "SCANNED" }),
    item("r1", { status: "SCAN_REQUESTED", serviceRequests: [req("SCAN", "OPEN")] }),
  ];
  assert.deepEqual(bulkBlockReasons(mixed, "SCAN").map((r) => r.text), [
    "2 are packages, and packages can't be scanned.",
    "1 item is already scanned.",
    "1 item has a scan in progress.",
  ]);

  assert.deepEqual(bulkBlockReasons([pkg], "FORWARD").map((r) => r.code), ["NOT_A_LETTER"]);
  assert.deepEqual(bulkBlockReasons([item("d", { serviceRequests: [req("SCAN", "OPEN")] })], "DISCARD").map((r) => r.code), ["SCAN_IN_PROGRESS"]);
  assert.deepEqual(bulkBlockReasons([item("ok")], "SCAN"), []);
});

test("las availableActions del servidor mandan sobre el calculo local", async () => {
  const { availableActionsFor: actions, canBulkRequest: can } = await import("../src/lib/mail-selection.js");
  const fromServer = item("srv", {
    // Sin solicitudes en la lista, el calculo local diria que se puede escanear.
    availableActions: {
      canRequestScan: false,
      canRequestForward: true,
      canRequestPickup: true,
      canRequestDiscard: false,
      hasActiveDisposition: false,
    },
  });
  assert.equal(actions(fromServer).canRequestScan, false);
  assert.equal(can(fromServer, "DISCARD"), false);
  assert.equal(can(fromServer, "NOT_MINE"), true);
  assert.equal(
    can(item("d", { availableActions: { canRequestForward: false, hasActiveDisposition: true } }), "NOT_MINE"),
    false
  );
});

// --- Fase 3C: escanear durante una recogida --------------------------------

const ready = (extra = {}) => item("ready", { status: "READY_FOR_PICKUP", serviceRequests: [req("PICKUP", "IN_PROGRESS")], ...extra });

test("3C-9 a 12. con la recogida en marcha: se puede escanear; no reenviar, ni descartar, ni otra recogida", async () => {
  const { bulkBlockReason } = await import("../src/lib/mail-selection.js");
  const actions = availableActionsFor(ready());
  assert.equal(actions.canRequestScan, true, "el escaneo no saca la pieza del centro");
  assert.equal(actions.canRequestForward, false);
  assert.equal(actions.canRequestDiscard, false);
  assert.equal(actions.canRequestPickup, false);

  assert.equal(canBulkRequest(ready(), "SCAN"), true);
  assert.equal(canBulkRequest(ready(), "FORWARD"), false);
  assert.equal(canBulkRequest(ready(), "DISCARD"), false);
  assert.equal(bulkBlockReason(ready(), "FORWARD"), "REQUEST_IN_PROGRESS");
  assert.equal(bulkBlockReason(ready(), "DISCARD"), "REQUEST_IN_PROGRESS");
  assert.equal(isSelectable(ready()), true, "se puede marcar para escanear");
});

test("3C-13. no se ofrece un segundo escaneo: en marcha o ya hecho durante la recogida", async () => {
  const { bulkBlockReason } = await import("../src/lib/mail-selection.js");
  const scanning = ready({ serviceRequests: [req("PICKUP", "IN_PROGRESS"), req("SCAN", "OPEN")] });
  assert.equal(canBulkRequest(scanning, "SCAN"), false);
  assert.equal(bulkBlockReason(scanning, "SCAN"), "SCAN_IN_PROGRESS");

  // Escaneada mientras esperaba en el mostrador: sigue READY_FOR_PICKUP.
  const scanned = ready({ serviceRequests: [req("PICKUP", "IN_PROGRESS"), req("SCAN", "COMPLETED")] });
  assert.equal(canBulkRequest(scanned, "SCAN"), false);
  assert.equal(bulkBlockReason(scanned, "SCAN"), "ALREADY_SCANNED");

  // Un reenvio o un descarte en marcha si lo siguen impidiendo.
  assert.equal(availableActionsFor(item("f", { serviceRequests: [req("FORWARD", "OPEN")] })).canRequestScan, false);
  assert.equal(availableActionsFor(item("d", { serviceRequests: [req("DISCARD", "OPEN")] })).canRequestScan, false);
});

test("3C-16. en grupo: las que esperan recogida entran en el escaneo y quedan fuera de reenvio y descarte", () => {
  const items = [item("a"), ready(), item("p", { type: "PACKAGE" })];
  const summary = Object.fromEntries(bulkActionSummary(items).map((row) => [row.action, row]));
  assert.deepEqual(summary.SCAN.eligible.map((i) => i.id), ["a", "ready"]);
  assert.deepEqual(summary.FORWARD.eligible.map((i) => i.id), ["a"]);
  assert.deepEqual(summary.DISCARD.eligible.map((i) => i.id), ["a", "p"]);
  assert.match(summary.DISCARD.reasons[0].text, /pickup, forward or discard in progress/);
  // Y la peticion es la de siempre: el servidor vuelve a comprobarlo todo.
  assert.deepEqual(bulkRequestBody("SCAN", summary.SCAN.eligible), { type: "SCAN", mailItemId: "a", mailItemIds: ["a", "ready"], chargeConsent: true });
});

test("3C-16. con las availableActions del servidor, se usan tal cual (pieza suelta o en grupo)", () => {
  const fromServer = ready({ availableActions: { canRequestScan: true, canRequestForward: false, canRequestPickup: false, canRequestDiscard: false, hasActiveDisposition: true } });
  assert.equal(canBulkRequest(fromServer, "SCAN"), true);
  assert.equal(canBulkRequest(fromServer, "DISCARD"), false);
});
