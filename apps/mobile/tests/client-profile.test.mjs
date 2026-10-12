import test from "node:test";
import assert from "node:assert/strict";

import { formatCenterAddress, getMailboxCode } from "../src/lib/client-profile.js";

test("la direccion del panel es la del centro, en una linea", () => {
  const user = {
    center: { addressLine1: "7380 Sand Lake Rd", addressLine2: "Suite 500", city: "Orlando", state: "FL", zip: "32819" },
    clientProfile: { addressLine1: "1 Client St", city: "Miami", state: "FL", zip: "33101" },
  };
  assert.equal(formatCenterAddress(user), "7380 Sand Lake Rd, Suite 500, Orlando, FL 32819");
});

test("sin direccion del centro no se cae a la del cliente", () => {
  const user = { center: { displayName: "Sandlake Orlando" }, clientProfile: { addressLine1: "1 Client St", city: "Miami" } };
  assert.equal(formatCenterAddress(user), "");
  assert.equal(formatCenterAddress(null), "");
});

test("el VO es el codigo del buzon, o el numero si no hay codigo", () => {
  assert.equal(getMailboxCode({ clientContext: { mailboxCode: "VO-7", mailboxNumber: 7 } }), "VO-7");
  assert.equal(getMailboxCode({ clientContext: { mailboxCode: null, mailboxNumber: 7 } }), "7");
  assert.equal(getMailboxCode({ clientContext: {} }), "");
  assert.equal(getMailboxCode(null), "");
});
