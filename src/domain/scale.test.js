import assert from "node:assert/strict";
import test from "node:test";
import { calculateScale, formatScale } from "./scale.js";

test("calculates and formats drawing scale", () => {
  assert.equal(calculateScale(55, 1000), 0.055);
  assert.equal(formatScale(0.055), "1 px = 0.0550 m");
});

test("rejects invalid dimensions", () => {
  assert.equal(calculateScale(0, 1000), null);
  assert.equal(calculateScale(55, Number.NaN), null);
});
