import test from "node:test";
import assert from "node:assert/strict";

import { feeScheduleBlocks } from "../src/lib/fee-schedule-format.js";

test("filas alineadas con espacios pasan a dos columnas", () => {
  const blocks = feeScheduleBlocks(
    [
      "The Worx Offices Virtual Office Fee Schedule",
      "",
      "",
      "1. Monthly Membership Fees",
      "",
      "Service                                  Fee",
      "Basic Virtual Office Membership          $59.00 / month",
      "Mail Scanning\t$5 + $.50 per page",
      "• One (1) scheduled mail forwarding per calendar month.",
      "Effective Date: September 2026.",
      "",
    ].join("\n")
  );

  assert.deepEqual(blocks, [
    { kind: "text", text: "The Worx Offices Virtual Office Fee Schedule" },
    { kind: "space" },
    { kind: "heading", text: "1. Monthly Membership Fees" },
    { kind: "space" },
    { kind: "columnsHeader", left: "Service", right: "Fee" },
    { kind: "row", left: "Basic Virtual Office Membership", right: "$59.00 / month" },
    { kind: "row", left: "Mail Scanning", right: "$5 + $.50 per page" },
    { kind: "bullet", text: "One (1) scheduled mail forwarding per calendar month." },
    { kind: "text", text: "Effective Date: September 2026." },
  ]);
});

test("una frase normal no se parte ni se toma por titulo", () => {
  assert.deepEqual(feeScheduleBlocks("Packages must be collected within three (3) business days following notification."), [
    { kind: "text", text: "Packages must be collected within three (3) business days following notification." },
  ]);
  // "$ 40.00" lleva un solo espacio: sigue siendo texto.
  assert.equal(feeScheduleBlocks("A reactivation fee of $ 40.00 may apply.")[0].kind, "text");
  assert.deepEqual(feeScheduleBlocks(null), []);
});
