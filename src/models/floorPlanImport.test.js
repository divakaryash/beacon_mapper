import test from "node:test";
import assert from "node:assert/strict";
import { isPdf, rasterSize, floorPlanFingerprint, matchingFloorReference } from "./floorPlanImport.js";

test("PDF detection and bounded, aspect-preserving raster dimensions", () => {
  assert.ok(isPdf({ name: "GROUND FLOOR.PDF", type: "" }));
  assert.ok(isPdf({ type: "application/pdf" }));
  assert.ok(!isPdf({ name: "floor.png", type: "image/png" }));
  assert.deepEqual(rasterSize(1000, 500), { width: 2000, height: 1000, scale: 2 });
  assert.deepEqual(rasterSize(10000, 5000), { width: 4096, height: 2048, scale: .4096 });
  assert.throws(() => rasterSize(Infinity, 500));
  assert.throws(() => rasterSize(0, 500));
});

test('reference selection uses the exact PDF fingerprint, never the filename alone',async()=>{
  assert.equal(await floorPlanFingerprint(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const {default:reference}=await import('../samples/dlfGroundReference.js');
  const file={name:'GROUND FLOOR (L-01) Model (1).pdf',type:'application/pdf'};
  assert.equal((await matchingFloorReference({file,sourceSha256:reference.pdfSha256})).name,reference.name);
  assert.equal(await matchingFloorReference({file,sourceSha256:'wrong-floor'}),null);
  assert.equal(await matchingFloorReference({file:{name:'other.svg',type:'image/svg+xml'},sourceSha256:reference.pdfSha256}),null);
});

test('L00 selects its basement reference and never reuses the ground-floor geometry',async()=>{
  const {default:reference}=await import('../samples/dlfBasementReference.js');
  const result=await matchingFloorReference({file:{name:'L00 FLOOR PLAN (REVISED) Model (1).pdf',type:'application/pdf'},sourceSha256:reference.pdfSha256});
  assert.equal(result.floor,-1);
  assert.notEqual(result.pdfSha256,(await matchingFloorReference({file:{type:'application/pdf'},sourceSha256:(await import('../samples/dlfGroundReference.js')).default.pdfSha256})).pdfSha256);
});
