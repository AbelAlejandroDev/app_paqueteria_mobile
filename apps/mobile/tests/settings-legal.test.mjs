import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("Settings → Legal: Privacy Policy, Terms & Conditions y Fee Schedule, juntos", () => {
  const settings = read("src/app/(client)/settings/index.jsx");
  const legal = settings.match(/const LEGAL_SECTIONS = \[[\s\S]*?\];/)[0];
  const labels = [...legal.matchAll(/\{ label: "([^"]+)", href/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Terms & Conditions", "Fee Schedule"]);
  assert.match(legal, /href: "\/settings\/terms"/);
  assert.match(legal, /href: "\/settings\/fee-schedule"/);
  // Ya no van en la lista general (no se repiten).
  const general = settings.match(/const SECTIONS = \[[\s\S]*?\];/)[0];
  assert.doesNotMatch(general, /Terms & Conditions|Fee Schedule/);
  // En la seccion Legal, Privacy Policy arriba y los dos documentos debajo.
  const section = settings.slice(settings.indexOf(">Legal<"));
  assert.ok(section.indexOf('label="Privacy Policy"') < section.indexOf("LEGAL_SECTIONS.map"));
  // Sin URLs inventadas: Terms y Fee Schedule son pantallas de la app con los documentos del centro.
  assert.doesNotMatch(legal, /https?:\/\//);
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

test("Help tiene un recuadro con Terms & Conditions y Fee Schedule que vuelve a Help", () => {
  const help = read("src/app/(client)/help/index.jsx");
  assert.match(help, /href="\/help\/terms"/);
  assert.match(help, /href="\/help\/fee-schedule"/);
  assert.ok(help.indexOf('"/help/terms"') < help.indexOf('"/help/fee-schedule"'), "Terms primero, Fee Schedule debajo");

  // Las mismas pantallas que Settings, sin copiar codigo.
  assert.match(read("src/app/(client)/help/terms.jsx"), /export \{ default \} from "\.\.\/settings\/terms";/);
  assert.match(read("src/app/(client)/help/fee-schedule.jsx"), /export \{ default \} from "\.\.\/settings\/fee-schedule";/);

  // Stack propio: la flecha de vuelta regresa a Help.
  const layout = read("src/app/(client)/help/_layout.jsx");
  assert.match(layout, /name="terms" options=\{\{ title: "Terms & Conditions" \}\}/);
  assert.match(layout, /name="fee-schedule" options=\{\{ title: "Fee Schedule" \}\}/);
  assert.equal(fs.existsSync(path.join(root, "src/app/(client)/help.jsx")), false);
});
