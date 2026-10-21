import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describePickupGroup, findPickupRequest, pickupGroupItems, pickupStatusLabel } from "../src/lib/pickup-group.js";
import { availableActionsFor } from "../src/lib/mail-selection.js";
import { routeForNotification } from "../src/lib/notification-routing.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// Las cinco piezas del ejemplo, como las devuelve GET /client/mail-items/:id
// (feat/grouped-pickup 215dcc1): requestItems con itemOrder y mailItem.
const FIVE = [
  { id: "mi-1", itemCode: "00001", type: "LETTER" },
  { id: "mi-2", itemCode: "00002", type: "LETTER" },
  { id: "mi-3", itemCode: "00003", type: "PACKAGE" },
  { id: "mi-4", itemCode: "00004", type: "PACKAGE" },
  { id: "mi-5", itemCode: "00005", type: "LARGE_ENVELOPE" },
];

const groupedPickup = (status = "IN_PROGRESS", itemStatus = "READY_FOR_PICKUP") => ({
  id: "sr-1",
  type: "PICKUP",
  status,
  createdAt: "2026-10-21T10:00:00.000Z",
  // Llegan desordenadas a proposito: manda itemOrder.
  requestItems: [...FIVE].reverse().map((item) => ({
    itemOrder: FIVE.indexOf(item),
    mailItem: { ...item, status: itemStatus },
  })),
});

const asItem = (index, requests) => ({ ...FIVE[index], status: "READY_FOR_PICKUP", serviceRequests: requests });

test("1. recogida individual legacy: requestItems vacio, la pieza es la actual y no hay lista", () => {
  const legacy = { id: "sr-9", type: "PICKUP", status: "IN_PROGRESS", mailItemId: "mi-7", requestItems: [] };
  const item = { id: "mi-7", itemCode: "00007", type: "PACKAGE", status: "READY_FOR_PICKUP" };
  const group = describePickupGroup([legacy], item);
  assert.equal(group.statusLabel, "Ready for Pickup");
  assert.equal(group.grouped, false);
  assert.deepEqual(group.items.map((i) => i.id), ["mi-7"]);
});

test("2-3. cinco piezas abriendo la primera: las cinco en orden y la primera marcada", () => {
  const group = describePickupGroup([groupedPickup()], asItem(0));
  assert.equal(group.grouped, true);
  assert.deepEqual(group.items.map((i) => i.itemCode), ["00001", "00002", "00003", "00004", "00005"]);
  assert.deepEqual(group.items.map((i) => i.isCurrent), [true, false, false, false, false]);
  assert.deepEqual(group.items.map((i) => i.type), ["LETTER", "LETTER", "PACKAGE", "PACKAGE", "LARGE_ENVELOPE"]);
});

test("4-5. abriendo una pieza secundaria se ven las mismas cinco, con ella marcada", () => {
  // Por la via secundaria el backend manda una solicitud mas fina (sin
  // pickupDetails ni mailItemId), pero con requestItems.
  const thin = { ...groupedPickup(), mailItemId: undefined, pickupDetails: undefined };
  const group = describePickupGroup([thin], asItem(3));
  assert.equal(group.items.length, 5);
  assert.equal(group.items.find((i) => i.isCurrent).id, "mi-4");
});

test("6. sin duplicados aunque la pieza principal se repita en requestItems", () => {
  const request = groupedPickup();
  request.requestItems.push({ itemOrder: 0, mailItem: { ...FIVE[0], status: "READY_FOR_PICKUP" } });
  request.requestItems.push({ itemOrder: 9, mailItem: null });
  const items = pickupGroupItems(request, asItem(0));
  assert.equal(items.length, 5);
  assert.equal(new Set(items.map((i) => i.id)).size, 5);
});

test("7 y 10. backend anterior sin requestItems: fallback a la pieza actual, sin errores", () => {
  const old = { id: "sr-2", type: "PICKUP", status: "IN_PROGRESS", mailItemId: "mi-1" };
  const group = describePickupGroup([old], asItem(0));
  assert.equal(group.grouped, false);
  assert.deepEqual(group.items.map((i) => i.id), ["mi-1"]);
  // Respuestas raras tampoco rompen.
  assert.equal(describePickupGroup(undefined, asItem(0)), null);
  assert.equal(describePickupGroup([{ type: "PICKUP", status: "IN_PROGRESS", requestItems: "x" }], null).items.length, 0);
  assert.equal(describePickupGroup([{ type: "SCAN", status: "OPEN" }], asItem(0)), null);
});

test("9. estados: lista, entregada y cancelada", () => {
  assert.equal(pickupStatusLabel("IN_PROGRESS"), "Ready for Pickup");
  assert.equal(pickupStatusLabel("COMPLETED"), "Picked Up");
  assert.equal(pickupStatusLabel("CANCELLED"), "Cancelled");
  assert.equal(pickupStatusLabel("REJECTED"), "Cancelled");
  assert.equal(pickupStatusLabel("SOMETHING_NEW"), "Something New");

  const done = describePickupGroup([groupedPickup("COMPLETED", "PICKED_UP")], { ...asItem(2), status: "PICKED_UP" });
  assert.equal(done.statusLabel, "Picked Up");
  assert.equal(done.items.length, 5, "entregada: las filas siguen activas y la lista se ve");

  // Cancelada: el backend desactiva las filas y requestItems llega vacio.
  const cancelled = { ...groupedPickup("CANCELLED"), requestItems: [] };
  const group = describePickupGroup([cancelled], { ...asItem(0), status: "RECEIVED" });
  assert.equal(group.statusLabel, "Cancelled");
  assert.equal(group.grouped, false);
});

test("la recogida abierta manda sobre una anterior cancelada o entregada", () => {
  const old = { id: "sr-old", type: "PICKUP", status: "CANCELLED", createdAt: "2026-10-01T00:00:00Z", requestItems: [] };
  const open = { ...groupedPickup(), createdAt: "2026-09-01T00:00:00Z" };
  assert.equal(findPickupRequest([old, open]).id, "sr-1");
  const later = { id: "sr-late", type: "PICKUP", status: "COMPLETED", createdAt: "2026-10-20T00:00:00Z" };
  assert.equal(findPickupRequest([old, later]).id, "sr-late");
});

test("8. el push de una recogida agrupada sigue llevando a un detalle que la resuelve", () => {
  // Datos de PICKUP_READY en feat/grouped-pickup: mailItemId (la primera) y,
  // nuevos, mailItemIds / itemCodes / itemCount.
  const data = {
    type: "PICKUP_READY",
    notificationId: "n-1",
    serviceRequestId: "sr-1",
    mailItemId: "mi-1",
    mailItemIds: FIVE.map((i) => i.id),
    itemCodes: FIVE.map((i) => i.itemCode),
    itemCount: 5,
    requestType: "PICKUP",
  };
  assert.deepEqual(routeForNotification(data), { pathname: "/notifications/[id]", params: { id: "n-1" } });
  // Sin notificationId cae en la pieza principal, cuyo detalle trae el grupo.
  const { notificationId, ...withoutId } = data;
  assert.deepEqual(routeForNotification(withoutId), { pathname: "/mail-items/[id]", params: { id: "mi-1" } });
});

test("la pantalla usa la respuesta del detalle, no la cache del listado", () => {
  const screen = read("src/app/(client)/mail-items/[id].jsx");
  assert.match(screen, /describePickupGroup\(serviceRequests, item\)/);
  assert.match(screen, /Array\.isArray\(item\?\.serviceRequests\) \? item\.serviceRequests : \[\]/);
  assert.match(screen, /const item = query\.data\?\.item \|\| null;/);
  assert.match(screen, /\{pickupGroup \? <PickupRequestCard group=\{pickupGroup\} \/> : null\}/);
  // Cada pieza abre su propio detalle por la ruta normal (el backend vuelve a
  // comprobar que es del cliente).
  assert.match(screen, /router\.push\(\{ pathname: "\/mail-items\/\[id\]", params: \{ id: entry\.id \} \}\)/);
});

test("11. sin regresiones: una recogida agrupada no cambia lo que se puede pedir", () => {
  const item = { id: "mi-2", type: "LETTER", status: "READY_FOR_PICKUP", serviceRequests: [groupedPickup()] };
  const actions = availableActionsFor(item);
  assert.equal(actions.canRequestScan, true, "escanear sigue disponible durante la recogida");
  assert.equal(actions.canRequestForward, false);
  assert.equal(actions.canRequestDiscard, false);
});
