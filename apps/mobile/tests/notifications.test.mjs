import test from "node:test";
import assert from "node:assert/strict";

import { isSafeUrl, planLabel, toBlocks, toSegments } from "../src/lib/notification-content.js";
import {
  loadNotificationDetail,
  navigationKeyFor,
  notificationDetailPath,
  routeForNotification,
} from "../src/lib/notification-routing.js";

test("6. el detalle se pide por su id", async () => {
  const calls = [];
  const api = { get: async (path) => (calls.push(path), { data: { notification: { id: "abc" } } }) };

  const notification = await loadNotificationDetail(api, "abc");

  assert.equal(notification.id, "abc");
  // Una sola peticion, y ninguna a la lista.
  assert.equal(calls.length, 1);
  assert.equal(calls.some((path) => path === "/client/notifications"), false);
});

test("7. el detalle consume GET /client/notifications/:id", async () => {
  const calls = [];
  const api = { get: async (path) => (calls.push(path), { data: { notification: null } }) };

  await loadNotificationDetail(api, "cmf123");
  assert.deepEqual(calls, ["/client/notifications/cmf123"]);
  assert.equal(notificationDetailPath("a/b"), "/client/notifications/a%2Fb");
});

test("8. push con notificationId y screen abre exactamente ese detalle", () => {
  const data = {
    type: "USPS_COMPLIANCE_APPROVED",
    notificationId: "n42",
    form1583ApprovalEventId: "e7",
    screen: "notification-detail",
  };
  assert.deepEqual(routeForNotification(data), { pathname: "/notifications/[id]", params: { id: "n42" } });
});

test("8b. con notificationId nunca se usa la busqueda legacy por tipo", () => {
  const route = routeForNotification({ type: "USPS_COMPLIANCE_APPROVED", notificationId: "n1" });
  assert.equal(route.params.openType, undefined);
});

test("8c. push legacy sin id: la busqueda por tipo queda solo como compatibilidad", () => {
  assert.deepEqual(routeForNotification({ type: "USPS_COMPLIANCE_APPROVED" }), {
    pathname: "/notifications",
    params: { openType: "USPS_COMPLIANCE_APPROVED" },
  });
});

test("8d. la clave de navegacion se ata al id de la notificacion", () => {
  assert.equal(navigationKeyFor({ notificationId: "n1" }, "req-1"), "notification:n1");
  assert.equal(navigationKeyFor({}, "req-1"), "req-1");
});

test("24. una URL https valida es un enlace que se abre", () => {
  assert.equal(isSafeUrl("https://forms.gle/VqitJx5nmMXZswaj6"), true);
  assert.equal(isSafeUrl("http://example.com"), true);
  assert.deepEqual(toSegments("https://forms.gle/VqitJx5nmMXZswaj6")[0], {
    kind: "link",
    url: "https://forms.gle/VqitJx5nmMXZswaj6",
  });
});

for (const [n, url] of [
  [25, "javascript:alert(1)"],
  [26, "intent://scan/#Intent;scheme=zxing;end"],
  [27, "file:///etc/passwd"],
  [28, "data:text/html,<script>alert(1)</script>"],
]) {
  test(`${n}. ${url.split(":")[0]}: no se abre`, () => {
    assert.equal(isSafeUrl(url), false);
    assert.equal(toSegments(`Open ${url} now`).some((segment) => segment.kind === "link"), false);
  });
}

// El cuerpo real de la bienvenida del backend (src/config/form1583Messages.js).
const WELCOME = [
  "Dear Ana,",
  "",
  "We are pleased to inform you that your Virtual Office is now active and fully set up.",
  "",
  "✔ Your Virtual Office Includes",
  "",
  "• Professional business address",
  "• Scan All Mail",
  "",
  "⭐ Optional Add-On Available",
  "",
  "We also offer a Directory Listing service.",
  "",
  "💬 We Value Your Feedback",
  "",
  "Please take a moment to complete our short survey:",
  "",
  "https://forms.gle/VqitJx5nmMXZswaj6",
  "",
  "Warm regards,",
  "The Worx Offices",
].join("\n");

test("mensaje: las secciones del backend se reconocen como titulos", () => {
  const headings = toBlocks(WELCOME).filter((b) => b.kind === "heading").map((b) => b.text);
  assert.deepEqual(headings, [
    "✔ Your Virtual Office Includes",
    "⭐ Optional Add-On Available",
    "💬 We Value Your Feedback",
  ]);
});

test("mensaje: el saludo y la firma no son titulos, y se respeta el salto de linea", () => {
  const blocks = toBlocks(WELCOME);
  assert.equal(blocks[0].kind, "paragraph");
  assert.equal(blocks.at(-1).text, "Warm regards,\nThe Worx Offices");
});

test("mensaje: los beneficios son viñetas tal como llegan, sin añadir ninguno", () => {
  const bullets = toBlocks(WELCOME).find((b) => b.kind === "bullets");
  assert.deepEqual(bullets.items, ["Professional business address", "Scan All Mail"]);
});

test("mensaje: la encuesta aparece una sola vez, desde el propio texto", () => {
  const links = toBlocks(WELCOME)
    .filter((b) => b.kind === "paragraph")
    .flatMap((b) => toSegments(b.text))
    .filter((s) => s.kind === "link");
  assert.deepEqual(links.map((l) => l.url), ["https://forms.gle/VqitJx5nmMXZswaj6"]);
});

test("mensaje: el plan se muestra solo si viene en los datos", () => {
  assert.equal(planLabel({ planCode: "PREMIUM" }), "Premium");
  assert.equal(planLabel({}), null);
});
