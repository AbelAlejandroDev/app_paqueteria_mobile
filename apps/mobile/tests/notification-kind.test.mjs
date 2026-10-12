import test from "node:test";
import assert from "node:assert/strict";

import { isUpdateNotification, notificationKind } from "../src/lib/notification-kind.js";

test("cada familia de aviso tiene su tipo", () => {
  assert.equal(notificationKind({ type: "MAIL_ITEM_RECEIVED" }), "mail");
  assert.equal(notificationKind({ type: "SCAN_COMPLETED" }), "scan");
  assert.equal(notificationKind({ type: "SCAN_REQUEST_CREATED" }), "scan");
  assert.equal(notificationKind({ type: "FORWARD_DISPATCHED" }), "forward");
  assert.equal(notificationKind({ type: "FORWARD_LABEL_READY" }), "label");
  assert.equal(notificationKind({ type: "PICKUP_READY" }), "pickup");
  assert.equal(notificationKind({ type: "PACKAGE_STORAGE_FEE_WARNING" }), "storage");
  assert.equal(notificationKind({ type: "USPS_COMPLIANCE_APPROVED" }), "account");
  assert.equal(notificationKind({ type: "SERVICE_NOTICE" }), "notice");
});

test("un cobro fallido es de pago aunque sea de un escaneo o un reenvio", () => {
  assert.equal(notificationKind({ type: "SCAN_PAYMENT_FAILED" }), "payment");
  assert.equal(notificationKind({ type: "FORWARD_PAYMENT_FAILED" }), "payment");
  assert.equal(notificationKind({ type: "SUBSCRIPTION_PAST_DUE" }), "payment");
});

test("el cambio de estado de una solicitud va por su requestType", () => {
  const status = (requestType) => ({ type: "SERVICE_REQUEST_STATUS_UPDATED", data: { requestType } });
  assert.equal(notificationKind(status("SCAN")), "scan");
  assert.equal(notificationKind(status("discard")), "discard");
  assert.equal(notificationKind(status(undefined)), "general");
});

test("un tipo desconocido o sin tipo cae en la generica, sin romper", () => {
  assert.equal(notificationKind({ type: "SOMETHING_NEW" }), "general");
  assert.equal(notificationKind(null), "general");
});

test("Updates es todo menos el aviso de correo nuevo", () => {
  assert.equal(isUpdateNotification({ type: "MAIL_ITEM_RECEIVED" }), false);
  assert.equal(isUpdateNotification({ type: "SCAN_COMPLETED" }), true);
  assert.equal(isUpdateNotification({ type: "SERVICE_NOTICE" }), true);
});
