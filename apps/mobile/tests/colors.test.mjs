import test from "node:test";
import assert from "node:assert/strict";

import { overWhite } from "../src/lib/colors.js";

test("mezcla con blanco y devuelve un hex opaco", () => {
  assert.equal(overWhite("#A5E5D9", 0.14), "#f2fbfa");
  assert.equal(overWhite("#000000", 1), "#000000");
  assert.equal(overWhite("#000000", 0), "#ffffff");
  assert.equal(overWhite("2D2A26", 0.07), "#f0f0f0");
});
