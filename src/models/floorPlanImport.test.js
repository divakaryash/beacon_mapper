import test from "node:test";
import assert from "node:assert/strict";
import { isPdf, rasterSize, floorPlanFingerprint, matchingFloorReference, geometryOperationsFilter } from "./floorPlanImport.js";

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

test('PDF detection suppresses annotation paths and page-edge frames while retaining structural lines and columns',()=>{
  const ops={showText:1,showSpacedText:2,nextLineShowText:3,nextLineSetSpacingShowText:4,constructPath:5,stroke:6,closeStroke:7,fill:8};
  const filter=geometryOperationsFilter(ops,{getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0})},{width:512,height:512});
  const path=(paint,bounds,data=[])=>({fnArray:[5],argsArray:[[paint,[data],bounds]]});
  assert.equal(filter(0,{fnArray:[1],argsArray:[[]]}),false);
  assert.equal(filter(0,path(6,[0,0,1,2])),false);
  assert.equal(filter(0,path(6,[100,100,100,200])),true);
  assert.equal(filter(0,path(6,[5,0,5,500])),false);
  assert.equal(filter(0,path(8,[100,100,102,102],[0,100,100,1,102,100,1,102,102,1,100,102,4])),true);
});

test('CAD word strokes are suppressed together while walls and columns remain',()=>{
  const ops={constructPath:5,stroke:6,closeStroke:7,fill:8};
  const filter=geometryOperationsFilter(ops,{getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0})},{width:512,height:512});
  const list={fnArray:[5,5,5,5],argsArray:[
    [6,[Array(25).fill(1)],[10,10,14,17]],
    [6,[Array(25).fill(1)],[16,10,20,17]],
    [6,[Array(25).fill(1)],[22,10,26,17]],
    [6,[[0,40,10,1,40,100]],[40,10,40,100]]
  ]};
  list.fnArray.forEach((_,i)=>filter(i,list));assert.equal(filter.excludePrintedWords(),true);
  for(let i=0;i<3;i++)assert.equal(filter(i,list),false);
  assert.equal(filter(3,list),true);
});

test('recognized text boxes suppress contained glyph paths without deleting a wall crossing the label',()=>{
  const ops={constructPath:5,stroke:6,closeStroke:7,fill:8};
  const filter=geometryOperationsFilter(ops,{getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0})},{width:512,height:512});
  const list={fnArray:[5,5],argsArray:[[6,[Array(11).fill(1)],[10,10,15,17]],[6,[[0,0,14,1,100,14]],[0,14,100,14]]]};
  filter(0,list);filter(1,list);filter.excludePrintedWords([{x:9,y:18,width:8,height:9}]);
  assert.equal(filter(0,list),false);assert.equal(filter(1,list),true);
});
