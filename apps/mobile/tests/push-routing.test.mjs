import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { navigationKeyFor, routeForNotification } from "../src/lib/notification-routing.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(root, "src", "app");

/**
 * El fichero de expo-router que atiende una ruta, buscando tambien dentro de
 * los grupos "(client)". null si la pantalla no existe.
 */
function screenFor(route) {
  const pathname = typeof route === "string" ? route : route.pathname;
  const segments = pathname.split("/").filter(Boolean);
  const candidates = (dir, rest) => {
    if (!fs.existsSync(dir)) return null;
    if (rest.length === 0) {
      for (const name of ["index.jsx", "index.js"]) if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
    } else if (rest.length === 1) {
      for (const ext of [".jsx", ".js"]) if (fs.existsSync(path.join(dir, rest[0] + ext))) return path.join(dir, rest[0] + ext);
    }
    if (rest.length && fs.existsSync(path.join(dir, rest[0]))) {
      const found = candidates(path.join(dir, rest[0]), rest.slice(1));
      if (found) return found;
    }
    for (const entry of fs.readdirSync(dir)) {
      if (/^\(.+\)$/.test(entry)) {
        const found = candidates(path.join(dir, entry), rest);
        if (found) return found;
      }
    }
    return null;
  };
  return candidates(APP_DIR, segments);
}

/**
 * Lo que manda el backend (b9cfe1c, lib/notifications.sendStoredNotificationPush):
 * el data del aviso + type + notificationId.
 */
const push = (type, data) => ({ ...data, type, notificationId: "n-" + type });

test("PICKUP_READY y PICKUP_COMPLETED abren el detalle del aviso, que existe", () => {
  for (const type of ["PICKUP_READY", "PICKUP_COMPLETED"]) {
    const route = routeForNotification(push(type, { serviceRequestId: "sr-1", mailItemId: "mi-1", itemCode: "00012", requestType: "PICKUP" }));
    assert.deepEqual(route, { pathname: "/notifications/[id]", params: { id: "n-" + type } }, type);
    assert.ok(screenFor(route), "falta la pantalla de " + route.pathname);
  }
});

test("FORWARD_PAYMENT_REQUIRED abre la pieza donde se paga", () => {
  const route = routeForNotification(push("FORWARD_PAYMENT_REQUIRED", { serviceRequestId: "sr-9", mailItemId: "mi-12" }));
  assert.deepEqual(route, { pathname: "/mail-items/[id]", params: { id: "mi-12" } });
  assert.ok(screenFor(route));
});

test("todos los destinos posibles de un push son pantallas que existen", () => {
  const payloads = [
    push("MAIL_ITEM_RECEIVED", { mailItemId: "mi-1", mailItemIds: ["mi-1"], count: 1 }),
    push("MAIL_ITEM_RECEIVED", { mailItemIds: ["mi-1", "mi-2"], count: 2 }),
    push("FORWARD_LABEL_READY", { mailItemId: "mi-3" }),
    push("FORWARD_DELIVERED", { mailItemId: "mi-3" }),
    push("FORWARD_PAYMENT_FAILED", { serviceRequestId: "sr-3" }),
    push("PAST_DUE_NEW_MAIL", {}),
    { type: "USPS_COMPLIANCE_APPROVED" }, // push antiguo sin id
    { type: "SCAN_COMPLETED", mailItemId: "mi-4" }, // sin id, con pieza
    { type: "ANYTHING_ELSE" },
  ];
  for (const data of payloads) {
    const route = routeForNotification(data);
    assert.ok(screenFor(route), `${data.type} -> ${JSON.stringify(route)} no existe`);
  }
});

test("el mismo push no navega dos veces aunque llegue por el listener y al arrancar", () => {
  const data = push("PICKUP_READY", { mailItemId: "mi-1" });
  assert.equal(navigationKeyFor(data, "req-a"), navigationKeyFor(data, "req-b"));
});

test("el toque se captura con la app abierta, en segundo plano y cerrada", () => {
  const capture = fs.readFileSync(path.join(root, "src/components/common/push-intent-capture.jsx"), "utf8");
  assert.match(capture, /takeInitialNotificationTap\(\)/, "app cerrada");
  assert.match(capture, /addNotificationTapListener\(capture\)/, "abierta o en segundo plano");
  const lib = fs.readFileSync(path.join(root, "src/lib/push-notifications.js"), "utf8");
  assert.match(lib, /setNotificationHandler/, "con la app delante se muestra el aviso");
});
