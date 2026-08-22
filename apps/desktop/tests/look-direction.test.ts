import assert from "node:assert/strict";
import test from "node:test";

import { computeLookDirectionIndex, getLookDirectionCell } from "../src/look-direction.js";

test("maps the four screen-space cardinals to the v2 clockwise direction order", () => {
  const origin = { x: 100, y: 100 };
  assert.equal(computeLookDirectionIndex(origin, { x: 100, y: 0 }), 0);
  assert.equal(computeLookDirectionIndex(origin, { x: 200, y: 100 }), 4);
  assert.equal(computeLookDirectionIndex(origin, { x: 100, y: 200 }), 8);
  assert.equal(computeLookDirectionIndex(origin, { x: 0, y: 100 }), 12);
});

test("maps all sixteen look directions onto v2 rows 9 and 10", () => {
  assert.deepEqual(getLookDirectionCell(0), { index: 0, column: 0, row: 9 });
  assert.deepEqual(getLookDirectionCell(7), { index: 7, column: 7, row: 9 });
  assert.deepEqual(getLookDirectionCell(8), { index: 8, column: 0, row: 10 });
  assert.deepEqual(getLookDirectionCell(15), { index: 15, column: 7, row: 10 });
});
