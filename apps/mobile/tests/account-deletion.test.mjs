import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cancellationRequestBody,
  deletionRequestBody,
  deletionStatusCopy,
  describeMembershipEffect,
} from "../src/lib/account-deletion.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// ---------------------------------------------------------------------------
// Settings → Membership & Account
// ---------------------------------------------------------------------------

test("Settings tiene Membership & Account con Cancel Membership y Delete Account", () => {
  const settings = read("src/app/(client)/settings/index.jsx");
  assert.match(settings, /Membership & Account/);
  assert.match(settings, /\{ label: "Cancel Membership", href: "\/settings\/membership"/);
  assert.match(settings, /\{ label: "Delete Account", href: "\/settings\/delete-account", icon: Trash2, danger: true \}/);
  const layout = read("src/app/(client)/settings/_layout.jsx");
  assert.match(layout, /name="membership" options=\{\{ title: "Cancel Membership" \}\}/);
  assert.match(layout, /name="delete-account" options=\{\{ title: "Delete Account" \}\}/);
  for (const file of ["membership.jsx", "delete-account.jsx"]) {
    assert.ok(fs.existsSync(path.join(root, "src/app/(client)/settings", file)), file);
  }
});

test("Cancel Membership sigue en Billing → Payment y Settings usa el mismo componente", () => {
  const billing = read("src/app/(client)/billing.jsx");
  assert.match(billing, /tab === "payment" \? <MembershipCancellation \/> : null/);
  const screen = read("src/app/(client)/settings/membership.jsx");
  assert.match(screen, /import MembershipCancellation from "@\/components\/common\/membership-cancellation"/);
  assert.match(screen, /<MembershipCancellation \/>/);
});

test("la baja manda el motivo opcional, como el portal web; ninguna fecha se calcula en la app", () => {
  const component = read("src/components/common/membership-cancellation.jsx");
  assert.match(component, /api\.post\("\/client\/membership\/cancellation", cancellationRequestBody\(reason\)\)/);
  assert.match(component, /Reason \(optional\)/);
  assert.deepEqual(cancellationRequestBody(""), {});
  assert.deepEqual(cancellationRequestBody("   "), {});
  assert.deepEqual(cancellationRequestBody("  Me mudo  "), { reason: "Me mudo" });
  assert.equal(cancellationRequestBody("x".repeat(600)).reason.length, 500);
});

// ---------------------------------------------------------------------------
// Delete Account
// ---------------------------------------------------------------------------

test("la pantalla usa el mismo backend que el portal y nunca manda un id de cliente", () => {
  const screen = read("src/app/(client)/settings/delete-account.jsx");
  assert.match(screen, /api\.get\("\/client\/account-deletion"\)/);
  assert.match(screen, /api\.post\("\/client\/account-deletion", body\)/);
  assert.match(screen, /\/client\/account-deletion\/\$\{encodeURIComponent\(id\)\}\/withdraw/);
  assert.match(screen, /secureTextEntry/, "la contraseña no se ve");
  assert.doesNotMatch(screen, /api\.delete\(|clientUserId|userId:/, "ni borra ni elige cuenta");
});

test("sin confirmar o sin contraseña no se manda; el cuerpo solo lleva lo necesario", () => {
  assert.equal(deletionRequestBody({ password: "x", acknowledged: false }).ok, false);
  assert.equal(deletionRequestBody({ password: "", acknowledged: true }).ok, false);
  assert.deepEqual(deletionRequestBody({ password: "secreta", acknowledged: true, reason: "  " }), {
    ok: true,
    body: { password: "secreta", acknowledge: true },
  });
  assert.deepEqual(deletionRequestBody({ password: "secreta", acknowledged: true, reason: " Ya no lo uso " }).body, {
    password: "secreta",
    acknowledge: true,
    reason: "Ya no lo uso",
  });
});

test("lo que se dice de la membresia y de cada estado", () => {
  assert.equal(describeMembershipEffect({ active: false }), null);
  assert.match(describeMembershipEffect({ active: true, plan: { willBeChargedAgain: true, noticePeriodDays: 15, display: { nextChargeAt: "Dec 20", effectiveAt: "Jan 20" } } }), /15-day notice: one more renewal on Dec 20 will still be charged, and it ends on Jan 20/);
  assert.match(describeMembershipEffect({ active: true, cancellation: { display: { effectiveAt: "Jan 20" } } }), /already in progress and ends on Jan 20/);
  assert.match(describeMembershipEffect({ active: true }), /Your center will end it/);
  assert.match(deletionStatusCopy("WAITING_MEMBERSHIP_CANCELLATION").body, /don't need to send it again/);
  assert.match(deletionStatusCopy("APPROVED").body, /except the records the law requires/);
  assert.equal(deletionStatusCopy("DESCONOCIDO"), deletionStatusCopy("PENDING"));
});

test("la pantalla explica la regla de los 15 dias con los dias que manda el servidor", async () => {
  const { describeNoticeRule } = await import("../src/lib/account-deletion.js");
  const rule = describeNoticeRule(15);
  assert.match(rule, /15 days' notice/);
  assert.match(rule, /With 15 days or more, the membership ends when the current period ends and the next renewal is not charged/);
  assert.match(rule, /With less than 15 days, one last renewal is charged/);
  assert.equal(describeNoticeRule(null), null, "sin dato (HDG) no se promete ninguna regla");
  const screen = read("src/app/(client)/settings/delete-account.jsx");
  assert.match(screen, /Deleting your account also starts the cancellation of your membership/);
  assert.match(screen, /describeNoticeRule\(data\?\.membership\?\.cancellation\?\.noticePeriodDays \?\? data\?\.membership\?\.plan\?\.noticePeriodDays\)/);
});
