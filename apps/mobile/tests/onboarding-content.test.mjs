import test from "node:test";
import assert from "node:assert/strict";

import { buildTourSteps, buildWelcomeSlides, goodToKnowCards, planOf } from "../src/lib/onboarding-content.js";

const allText = (items) =>
  JSON.stringify(items, (key, value) => (key === "illustration" || key === "anchor" ? undefined : value));

test("el plan sale del usuario; sin dato, Basic", () => {
  assert.equal(planOf({ clientContext: { servicePlan: "PREMIUM" } }), "PREMIUM");
  assert.equal(planOf({ clientContext: { servicePlan: "basic" } }), "BASIC");
  assert.equal(planOf({}), "BASIC");
});

test("Basic: escaneo y reenvio son de pago, sin cifras discutidas", () => {
  const cards = goodToKnowCards("BASIC");
  const scan = cards.find((card) => card.key === "scan");
  const forward = cards.find((card) => card.key === "forward");
  assert.match(scan.body, /paid service/);
  assert.match(forward.body, /Postage and handling/);
  assert.doesNotMatch(allText(cards), /\$\d/);
});

test("Premium: escaneo automatico y reenvio mensual, sin prometer envio gratis", () => {
  const cards = goodToKnowCards("PREMIUM");
  assert.match(cards.find((card) => card.key === "scan").body, /scanned automatically/);
  const forward = cards.find((card) => card.key === "forward").body;
  assert.match(forward, /once a month/);
  assert.match(forward, /Postage and handling still apply/);
});

test("nada promete servicios gratis ni festivos excluidos", () => {
  for (const plan of ["BASIC", "PREMIUM"]) {
    const text = allText([buildWelcomeSlides({ plan, brandName: "The Worx" }), buildTourSteps({ plan })]);
    assert.doesNotMatch(text, /free (scan|forward|shipping|postage)/i);
    assert.doesNotMatch(text, /holiday/i);
    assert.doesNotMatch(text, /complimentary/i);
  }
});

test("el almacenaje de paquetes: 3 dias habiles y un cargo que puede aplicarse", () => {
  const storage = buildTourSteps({ plan: "BASIC" }).find((step) => step.key === "storage");
  assert.match(storage.description, /3 business days/);
  assert.match(storage.description, /may apply/);
  assert.equal(goodToKnowCards("PREMIUM").find((card) => card.key === "storage").tone, "warning");
});

test("la bienvenida usa la marca del cliente y termina en Explore the App", () => {
  const slides = buildWelcomeSlides({ plan: "BASIC", brandName: "HDG" });
  assert.equal(slides[0].title, "Welcome to HDG");
  assert.equal(slides.at(-1).cta, "Explore the App");
});

test("el paso del item no navega a ninguna pieza", () => {
  const item = buildTourSteps({ plan: "BASIC" }).find((step) => step.key === "item");
  assert.equal(item.anchor, null);
});
