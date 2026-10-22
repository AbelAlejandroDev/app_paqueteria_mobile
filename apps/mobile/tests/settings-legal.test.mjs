import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("Settings: Terms & Conditions y Fee Schedule van justo debajo de Security", () => {
  const settings = read("src/app/(client)/settings/index.jsx");
  const labels = [...settings.matchAll(/\{ label: "([^"]+)", (?:href|action)/g)].map((m) => m[1]);
  const security = labels.indexOf("Security");
  assert.ok(security >= 0);
  assert.deepEqual(labels.slice(security, security + 3), ["Security", "Terms & Conditions", "Fee Schedule"]);
  assert.match(settings, /href: "\/settings\/terms"/);
  assert.match(settings, /href: "\/settings\/fee-schedule"/);
});

test("las dos rutas existen y tienen titulo en el Stack de Settings", () => {
  for (const file of ["terms.jsx", "fee-schedule.jsx"]) {
    assert.ok(fs.existsSync(path.join(root, "src/app/(client)/settings", file)), file);
  }
  const layout = read("src/app/(client)/settings/_layout.jsx");
  assert.match(layout, /name="terms" options=\{\{ title: "Terms & Conditions" \}\}/);
  assert.match(layout, /name="fee-schedule" options=\{\{ title: "Fee Schedule" \}\}/);
});

test("Terms usa la misma consulta que TermsGate y es solo lectura", () => {
  const screen = read("src/app/(client)/settings/terms.jsx");
  const gate = read("src/components/common/terms-gate.jsx");
  assert.match(screen, /queryKey: \["auth-terms-current"\]/);
  assert.match(gate, /const QUERY_KEY = \["auth-terms-current"\]/);
  assert.match(screen, /api\.get\("\/auth\/terms\/current"\)/);
  assert.doesNotMatch(screen, /accept"\)|api\.post/, "aceptar sigue siendo cosa de TermsGate");
});

test("Fee Schedule reutiliza el componente de Billing", () => {
  const screen = read("src/app/(client)/settings/fee-schedule.jsx");
  assert.match(screen, /import FeeScheduleView, \{ FEE_SCHEDULE_QUERY_KEY \} from "@\/components\/common\/fee-schedule"/);
  assert.match(screen, /<FeeScheduleView \/>/);
});
