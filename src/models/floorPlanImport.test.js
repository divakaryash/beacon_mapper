import test from "node:test";
import assert from "node:assert/strict";
import { isPdf, rasterSize } from "./floorPlanImport.js";

test("PDF detection and bounded, aspect-preserving raster dimensions", () => {
  assert.ok(isPdf({ name: "GROUND FLOOR.PDF", type: "" }));
  assert.ok(isPdf({ type: "application/pdf" }));
  assert.ok(!isPdf({ name: "floor.png", type: "image/png" }));
  assert.deepEqual(rasterSize(1000, 500), { width: 2000, height: 1000, scale: 2 });
  assert.deepEqual(rasterSize(10000, 5000), { width: 4096, height: 2048, scale: .4096 });
  assert.throws(() => rasterSize(Infinity, 500));
  assert.throws(() => rasterSize(0, 500));
});
