import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canPayZohoInvoice,
  isSecurePageUrl,
  isValidZohoInvoiceId,
  sortZohoInvoices,
  ZOHO_ADD_PAYMENT_METHOD_PATH,
  ZOHO_UPDATE_CARD_PATH,
  zohoBillingErrorMessage,
  zohoInvoiceKindLabel,
  zohoInvoicePayPath,
  zohoInvoiceStatus,
  zohoPageUrl,
} from "../src/lib/zoho-billing.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const ACTIONS = { payInvoices: true };
// serializeInvoice (backend src/lib/zohoCustomerBilling.js), ids ficticios.
const invoice = (over = {}) => ({
  invoiceId: "1234567000000012345",
  number: "INV-000010",
  date: "2026-11-05",
  dueDate: "2026-11-05",
  status: "overdue",
  totalCents: 4900,
  balanceCents: 4900,
  currency: "USD",
  kind: "MEMBERSHIP",
  payable: true,
  ...over,
});

test("rutas reales de las paginas seguras de Zoho", () => {
  assert.equal(ZOHO_UPDATE_CARD_PATH, "/client/billing/zoho/update-card");
  assert.equal(ZOHO_ADD_PAYMENT_METHOD_PATH, "/client/billing/zoho/add-payment-method");
  assert.equal(zohoInvoicePayPath("1234567000000012345"), "/client/billing/zoho/invoices/1234567000000012345/pay");
});

test("el id de factura se valida como el backend (^\\d{1,30}$) antes de componer la ruta", () => {
  assert.equal(isValidZohoInvoiceId("1234567000000012345"), true);
  for (const bad of ["", "abc", "12/../34", "1".repeat(31), null, undefined]) {
    assert.equal(isValidZohoInvoiceId(bad), false, String(bad));
  }
  assert.throws(() => zohoInvoicePayPath("../x"), /Invalid invoice id/);
});

test("la URL de la pagina: `url` (tarjeta, metodo) o `paymentUrl` (factura), solo https sin credenciales", () => {
  assert.equal(zohoPageUrl({ provider: "ZOHO", url: "https://billing.zoho.example/hp/1", expiresAt: null }), "https://billing.zoho.example/hp/1");
  assert.equal(zohoPageUrl({ provider: "ZOHO", paymentUrl: "https://billing.zoho.example/pay/2" }), "https://billing.zoho.example/pay/2");
  assert.equal(zohoPageUrl({ url: "http://billing.zoho.example/hp/1" }), null);
  assert.equal(zohoPageUrl({ url: "javascript:alert(1)" }), null);
  assert.equal(zohoPageUrl({ url: "https://user:pw@billing.zoho.example/" }), null);
  assert.equal(zohoPageUrl({}), null);
  assert.equal(isSecurePageUrl("hdgclient://billing"), false, "un deep link no es una pagina de pago");
});

test("estados de factura de Zoho", () => {
  assert.equal(zohoInvoiceStatus("paid").label, "Paid");
  assert.equal(zohoInvoiceStatus("overdue").label, "Overdue");
  assert.equal(zohoInvoiceStatus("partially_paid").label, "Partially paid");
  assert.equal(zohoInvoiceStatus("sent").label, "Due");
  assert.equal(zohoInvoiceStatus("void").label, "Void");
  assert.equal(zohoInvoiceStatus("pending_approval").label, "Pending approval", "uno nuevo se enseña tal cual");
  assert.equal(zohoInvoiceStatus(null).label, "Unknown");
  assert.notDeepEqual(zohoInvoiceStatus("paid").tone, zohoInvoiceStatus("overdue").tone);
});

test("tipos de factura", () => {
  assert.equal(zohoInvoiceKindLabel("MEMBERSHIP"), "Membership");
  assert.equal(zohoInvoiceKindLabel("SCAN"), "Scan");
  assert.equal(zohoInvoiceKindLabel("STORAGE"), "Storage");
  assert.equal(zohoInvoiceKindLabel("FORWARDING"), "Forwarding");
  assert.equal(zohoInvoiceKindLabel("X"), "Invoice");
});

test("Pay solo en facturas pagables, no de reenvio, y si el centro deja pagar", () => {
  assert.equal(canPayZohoInvoice(invoice(), ACTIONS), true);
  assert.equal(canPayZohoInvoice(invoice({ kind: "SCAN" }), ACTIONS), true);
  assert.equal(canPayZohoInvoice(invoice({ payable: false, status: "paid", balanceCents: 0 }), ACTIONS), false);
  assert.equal(canPayZohoInvoice(invoice({ kind: "FORWARDING" }), ACTIONS), false, "se pagan desde la pieza");
  assert.equal(canPayZohoInvoice(invoice(), { payInvoices: false }), false);
  assert.equal(canPayZohoInvoice(invoice({ invoiceId: "bad" }), ACTIONS), false);
});

test("orden: primero las que se pueden pagar, luego por fecha", () => {
  const sorted = sortZohoInvoices([
    invoice({ invoiceId: "1", payable: false, date: "2026-11-01" }),
    invoice({ invoiceId: "2", payable: true, date: "2026-09-01" }),
    invoice({ invoiceId: "3", payable: false, date: "2026-12-01" }),
  ]);
  assert.deepEqual(sorted.map((i) => i.invoiceId), ["2", "3", "1"]);
  assert.deepEqual(sortZohoInvoices(undefined), []);
});

test("errores de Zoho con mensajes para el cliente, nunca el texto tecnico", () => {
  const err = (status, data) => ({ response: { status, data } });
  assert.match(zohoBillingErrorMessage(err(502, { error: "Zoho 500 upstream", code: "ZOHO_PAYMENT_PAGE_UNAVAILABLE" })), /not available right now/);
  assert.match(zohoBillingErrorMessage(err(409, { error: "x", code: "INVOICE_NOT_PAYABLE" })), /can no longer be paid/);
  assert.match(zohoBillingErrorMessage(err(409, { error: "x", code: "PAY_FORWARDING_FROM_MAIL_ITEM" })), /from the mail item/);
  assert.match(zohoBillingErrorMessage(err(409, { error: "x", code: "ZOHO_SUBSCRIPTION_INACTIVE" })), /isn't active/);
  assert.match(zohoBillingErrorMessage(err(400, { error: "Invalid invoice id" })), /can't be paid from the app/);
  assert.match(zohoBillingErrorMessage({ message: "Network Error" }), /couldn't reach the server/);
  assert.doesNotMatch(zohoBillingErrorMessage(err(500, { error: "Zoho stack trace" })), /stack/);
});

test("Facturacion de Zoho: datos de billing/payment, acciones de las capacidades, navegador del sistema", () => {
  const billing = read("src/app/(client)/billing.jsx");
  const tab = billing.slice(billing.indexOf("function ZohoPaymentTab("), billing.indexOf("function PaymentTab("));
  assert.match(tab, /const actions = zohoBillingActions\(capabilities\);/);
  assert.match(tab, /actions\.updateCard && cards\.length/);
  assert.match(tab, /actions\.addPaymentMethod/);
  assert.match(tab, /canPay=\{canPayZohoInvoice\(invoice, actions\)\}/);
  assert.match(billing, /const url = zohoPageUrl\(\(await api\.post\(path\)\)\.data\);/);
  assert.match(billing, /await WebBrowser\.openBrowserAsync\(url\);/);
  assert.doesNotMatch(tab, /WebView/);
  // Al volver se relee lo de Zoho (la vuelta no confirma nada).
  assert.match(billing, /onSettled: \(\) => \{\s*\/\/[^\n]*\n\s*queryClient\.invalidateQueries\(\{ queryKey: \[BILLING_PAYMENT_QUERY_KEY\] \}\);/);
});
