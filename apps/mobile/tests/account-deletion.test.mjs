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
  assert.match(describeMembershipEffect({ active: true }), /Requesting deletion does not cancel your membership/);
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
  assert.match(screen, /describeNoticeRule\(data\?\.membership\?\.cancellation\?\.noticePeriodDays \?\? data\?\.membership\?\.plan\?\.noticePeriodDays\)/);
  // La regla solo se enseña cuando el borrado abre la baja (The Worx).
  assert.match(screen, /membership\.startsCancellation && noticeRule/);
});

test("los estados del procesamiento tienen texto para el cliente", () => {
  assert.match(deletionStatusCopy("PROCESSING").body, /can no longer be withdrawn/);
  assert.match(deletionStatusCopy("LEGAL_REVIEW_REQUIRED").body, /kept apart/);
  assert.match(deletionStatusCopy("FAILED_RETRYABLE").body, /retried automatically/);
  // Retirar o pedir otra lo decide el servidor (canWithdraw, canRequest).
  const screen = read("src/app/(client)/settings/delete-account.jsx");
  assert.match(screen, /request\?\.canWithdraw/);
  assert.match(screen, /data\?\.canRequest/);
});

// ── HDG 3a17a0e: pedir el borrado NO cancela la membresia ─────────────────────

const HDG_MEMBERSHIP_TEXT =
  "Requesting deletion does not cancel your membership. If it is still active, HDG Executive Suites has to cancel it separately under your membership terms before your account can be deleted. Your deletion request stays pending until then; staff will contact you if anything is needed.";

test("HDG: con la membresia activa se dice que el borrado NO la cancela, con el texto del backend", async () => {
  const { membershipNotice, MEMBERSHIP_NOT_CANCELLED } = await import("../src/lib/account-deletion.js");
  const hdg = {
    canRequest: true,
    membership: { active: true, cancellation: null, plan: null, handledByCenter: true },
    retention: { membership: HDG_MEMBERSHIP_TEXT },
  };
  const notice = membershipNotice(hdg);
  assert.equal(notice.headline, "Requesting deletion does not cancel your membership.");
  assert.equal(notice.body, HDG_MEMBERSHIP_TEXT);
  assert.equal(notice.startsCancellation, false);
  // Sin texto del backend, el propio: tampoco promete cancelar nada.
  const fallback = membershipNotice({ ...hdg, retention: {} });
  assert.equal(fallback.body, MEMBERSHIP_NOT_CANCELLED);
  assert.doesNotMatch(fallback.body + fallback.headline, /We'll request its cancellation|also starts the cancellation|will end it/);
  // Membresia ya terminada: nada que avisar.
  assert.equal(membershipNotice({ membership: { active: false } }), null);
});

test("The Worx no cambia: con plan, el borrado abre la baja con su preaviso", async () => {
  const { membershipNotice } = await import("../src/lib/account-deletion.js");
  const worx = membershipNotice({
    membership: { active: true, plan: { willBeChargedAgain: false, noticePeriodDays: 15, display: { effectiveAt: "Jan 20" } } },
    retention: { membership: "If your membership is still active, it has to end first. We open the cancellation for you..." },
  });
  assert.equal(worx.headline, "Deleting your account also starts the cancellation of your membership.");
  assert.match(worx.body, /We'll request its cancellation: it ends on Jan 20/);
  assert.equal(worx.startsCancellation, true);
  const inProgress = membershipNotice({ membership: { active: true, cancellation: { display: { effectiveAt: "Jan 20" } } } });
  assert.match(inProgress.body, /already in progress and ends on Jan 20/);
  assert.equal(inProgress.startsCancellation, false);
});

test("el plazo de revision lo dice el backend y la pantalla lo enseña", async () => {
  const { processingNote } = await import("../src/lib/account-deletion.js");
  assert.equal(processingNote({ retention: { processing: { days: null, message: "HDG Executive Suites reviews each request manually." } } }), "HDG Executive Suites reviews each request manually.");
  assert.equal(processingNote({ retention: {} }), null);
  assert.equal(processingNote(null), null);
  const screen = read("src/app/(client)/settings/delete-account.jsx");
  assert.ok(screen.includes("const membership = membershipNotice(data);"));
  assert.ok(screen.includes("{membership.headline}"));
  assert.ok(screen.includes("const processing = processingNote(data);"));
  assert.ok(!screen.includes("describeMembershipEffect"), "el texto de la membresia pasa por membershipNotice");
});

test("Delete Account ofrece tambien la pagina web de borrado (Google Play)", async () => {
  const { accountDeletionLinkFor } = await import("../src/lib/legal-links.js");
  const hdg = { tenantSlug: "hdg", accountDeletion: { name: "Request account deletion on the web", url: "https://members.hdgexecutivesuites.com/account-deletion" } };
  assert.equal(accountDeletionLinkFor("hdg", hdg, null).url, "https://members.hdgexecutivesuites.com/account-deletion");
  assert.equal(accountDeletionLinkFor("hdg", hdg, { accountDeletionUrl: null }).url, "https://members.hdgexecutivesuites.com/account-deletion");
  assert.equal(accountDeletionLinkFor("hdg", hdg, { accountDeletionUrl: "https://members.hdgexecutivesuites.com/delete" }).url, "https://members.hdgexecutivesuites.com/delete");
  assert.equal(accountDeletionLinkFor("the_worx", hdg, null), null, "nunca la de otra organizacion");
  assert.equal(accountDeletionLinkFor("the_worx", { tenantSlug: "the_worx" }, null), null, "The Worx no tiene una configurada");
  const screen = read("src/app/(client)/settings/delete-account.jsx");
  assert.ok(screen.includes("accountDeletionLinkFor(user?.tenant?.slug, brand, capabilities.legal)"));
  assert.ok(screen.includes("You can also request deletion on the web"));
});

test("los errores del backend se explican y nada se borra al pulsar", () => {
  const screen = read("src/app/(client)/settings/delete-account.jsx");
  assert.ok(screen.includes('formatErrorMessage(error, "Try again later.")'));
  assert.ok(screen.includes('error?.response?.data?.code === "ACCOUNT_DELETION_ALREADY_REQUESTED"'));
  assert.ok(screen.includes("Nothing is deleted right now."));
  assert.ok(screen.includes("except the records the law requires to keep"));
});
