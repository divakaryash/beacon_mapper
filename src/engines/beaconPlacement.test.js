import test from "node:test";
import assert from "node:assert/strict";
import { planBeacons as generate, BEACON_PROFILES, snapBeaconToGraph } from "./beaconPlacement.js";
const box=(x,y,width,height)=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
// Historical seed-spacing tests explicitly exercise the centerline baseline, not the new default.
function planBeacons(input){const nodes=input.graph.nodes;const maxX=nodes.reduce((m,n)=>Math.max(m,n.worldX),0),maxY=nodes.reduce((m,n)=>Math.max(m,n.worldY),0);return generate({...input,configuration:{...input.configuration,placementStrategy:'centerline'},floorGeometry:{floors:[...new Set(nodes.map(n=>n.floorId))].map(floorId=>({floorId,boundaries:[box(-20,-20,maxX+40,maxY+40)],walkableAreas:[box(-20,-20,maxX+40,maxY+40)]}))}});}
const n=(id,x,y=0,type="Corridor")=>({id,floorId:"G",x:x*10,y:y*10,worldX:x,worldY:y,type,metadata:{}});
const line={nodes:[n("a",0,0,"Entrance"),n("b",22,0,"Exit")],edges:[{id:"ab",source:"a",target:"b",distance:22}]};
test("places and optimizes 5.5 m spacing with endpoint anchors",()=>{const r=planBeacons({graph:line});assert.equal(r.beacons.length,5);assert.equal(r.statistics.navigationBeacons,r.beacons.length);assert.equal(r.statistics.averageSpacing,5.5);assert.equal(r.coverage.estimatedPercent,100);assert.equal(r.warnings.length,0);});
test("intermediate graph nodes do not inflate placement",()=>{const graph={nodes:Array.from({length:9},(_,i)=>n(String(i),i*2.75)),edges:Array.from({length:8},(_,i)=>({id:String(i),source:String(i),target:String(i+1),distance:2.75}))};const r=planBeacons({graph});assert.equal(r.beacons.length,5);assert.equal(r.statistics.averageSpacing,5.5);});
test("junction is anchored once across branches",()=>{const graph={nodes:[n("j",0),n("a",11),n("b",0,11),n("c",-11)],edges:["a","b","c"].map(id=>({id,source:"j",target:id,distance:11}))};const r=planBeacons({graph});assert.equal(r.beacons.filter(b=>b.nodeId==="j").length,1);assert.equal(r.beacons.find(b=>b.nodeId==="j").type,"Navigation");});
test("three adjacent lifts use one central visible beacon",()=>{const graph={nodes:[n('a',0,0,'Lift'),n('b',3,0,'Lift'),n('c',6,0,'Lift')],edges:[{id:'ab',source:'a',target:'b',distance:3},{id:'bc',source:'b',target:'c',distance:3}]};const r=planBeacons({graph});assert.equal(r.beacons.length,1);assert.equal(r.beacons[0].nodeId,'b');assert.ok(!r.warnings.some(w=>w.code==='missing-anchor'));});
test("a junction and lift retain stations when merging would shorten path coverage",()=>{const graph={nodes:[n('j',0),n('left',-5),n('north',0,5),n('lift',1.5,0,'Lift'),n('right',6.5)],edges:[{id:'left',source:'j',target:'left',distance:5},{id:'north',source:'j',target:'north',distance:5},{id:'lift',source:'j',target:'lift',distance:1.5},{id:'right',source:'lift',target:'right',distance:5}]};const r=planBeacons({graph,placementRules:{minimumSpacing:5,maximumSpacing:9},configuration:{spacing:7}});assert.equal(r.beacons.filter(b=>Math.hypot(b.worldX,b.worldY)<2).length,2);assert.ok(r.beacons.some(b=>b.nodeId==='j'));assert.equal(r.beacons[0].nodeId,'lift');assert.ok(!r.warnings.some(w=>w.code==='missing-anchor'));});
test("a bend on one path shares a nearby junction beacon",()=>{const graph={nodes:[n('j',0),n('left',-8),n('north',0,-8),n('turn',4),n('end',4,10)],edges:[{id:'left',source:'j',target:'left',distance:8},{id:'north',source:'j',target:'north',distance:8},{id:'turn',source:'j',target:'turn',distance:4},{id:'end',source:'turn',target:'end',distance:10}]};const r=planBeacons({graph,placementRules:{minimumSpacing:5,maximumSpacing:9},configuration:{spacing:7}});assert.ok(r.beacons.some(b=>b.nodeId==='j'));assert.ok(!r.beacons.some(b=>b.nodeId==='turn'));assert.ok(!r.warnings.some(w=>w.code==='missing-anchor'&&w.nodeId==='turn'));});
test("an isolated single-path bend keeps a beacon",()=>{const graph={nodes:[n('start',0),n('turn',6),n('end',6,6)],edges:[{id:'first',source:'start',target:'turn',distance:6},{id:'second',source:'turn',target:'end',distance:6}]};const r=planBeacons({graph,placementRules:{minimumSpacing:5,maximumSpacing:9},configuration:{spacing:7}});assert.ok(r.beacons.some(b=>b.nodeId==='turn'));});
test("a short route end shares a nearby junction beacon",()=>{const graph={nodes:[n('j',0),n('short',2),n('north',0,12),n('west',-12)],edges:[{id:'short',source:'j',target:'short',distance:2},{id:'north',source:'j',target:'north',distance:12},{id:'west',source:'j',target:'west',distance:12}]};const r=planBeacons({graph,configuration:{requireRouteEnds:true,spacing:7},placementRules:{minimumSpacing:5,maximumSpacing:9}});assert.ok(r.beacons.some(b=>b.nodeId==='j'));assert.ok(!r.beacons.some(b=>b.nodeId==='short'));assert.ok(r.beacons.some(b=>b.anchorNodeIds?.includes('short')));});
test("route ends share a beacon within 5 m and keep one when farther away",()=>{const graph={nodes:[n('j',0),n('near',5),n('far',0,12),n('west',-12)],edges:[{id:'near',source:'j',target:'near',distance:5},{id:'far',source:'j',target:'far',distance:12},{id:'west',source:'j',target:'west',distance:12}]};const r=planBeacons({graph,configuration:{requireRouteEnds:true,spacing:7},placementRules:{minimumSpacing:5,maximumSpacing:9}});assert.ok(!r.beacons.some(b=>b.nodeId==='near'));assert.ok(r.beacons.some(b=>b.nodeId==='far'));assert.ok(r.beacons.some(b=>b.anchorNodeIds?.includes('near')));});
test("manual edits detect missing anchors, duplicates and uncovered edges",()=>{const r=planBeacons({graph:line,configuration:{mode:"manual",beacons:[]}});assert.ok(r.warnings.some(w=>w.code==="missing-anchor"));assert.ok(r.warnings.some(w=>w.code==="uncovered-edge"));const original=planBeacons({graph:line});const edited=planBeacons({graph:line,configuration:{mode:"hybrid",beacons:[...original.beacons,{...original.beacons[0],id:"dup"}]}});assert.ok(edited.warnings.some(w=>w.code==="duplicate-beacons"));});
test("snaps manual beacon to a graph edge",()=>{const b=snapBeaconToGraph({floorId:"G",worldX:5,worldY:1},line,2);assert.equal(b.worldY,0);assert.equal(b.edgeId,"ab");});
test("disabled beacons are excluded and configured spacing survives recalculation",()=>{const original=planBeacons({graph:line,configuration:{spacing:6}});const beacons=original.beacons.map(b=>b.nodeId==="a"?{...b,enabled:false}:b);const r=planBeacons({graph:line,configuration:{...original.configuration,beacons}});assert.equal(r.configuration.spacing,6);assert.equal(r.statistics.disabledBeacons,1);assert.ok(r.warnings.some(w=>w.code==="missing-anchor"));});
test("floor transition endpoints become anchors without placing inside the connector",()=>{const graph={nodes:[n("a",0),{...n("b",0),floorId:"L1"}],edges:[{id:"lift",source:"a",target:"b",distance:4}]};const r=planBeacons({graph});assert.equal(r.beacons.length,2);assert.equal(r.statistics.navigationBeacons,r.beacons.length);assert.equal(r.coverage.totalLength,0);});
test("nearby entrance and exit share a station without losing their assignments",()=>{const r=planBeacons({graph:{nodes:[n("a",0,0,"Entrance"),n("b",3,0,"Exit")],edges:[{...line.edges[0],distance:3}]}});assert.equal(r.beacons.length,1);assert.ok(!r.warnings.some(w=>w.code==="missing-anchor"));});
test("missing geometry fails closed instead of generating unsafe beacons",()=>{const r=generate({graph:line});assert.equal(r.beacons.length,0);assert.ok(r.warnings.some(w=>w.code==="geometry-rejected"));assert.equal(r.quality.overallScore,0);});
test("geometry-conflicting beacon moves to nearest valid edge point",()=>{const region=box(-1,-1,24,2),r=generate({graph:line,floorGeometry:{floors:[{floorId:"G",boundaries:[region],walkableAreas:[region],restrictedAreas:[box(5,-1,1,2)]}]}});assert.equal(r.geometryValidation.relocated,1);assert.ok(r.beacons.every(b=>b.worldX<5||b.worldX>6));assert.ok(r.beacons.every(b=>b.installationType==="Ceiling"&&b.mountingHeight===3&&b.installationStatus==="Planned"));});
test("optimization chooses a feasible spacing rather than blindly rounding",()=>{const r=planBeacons({graph:{nodes:[n("a",0,0,"Entrance"),n("b",31,0,"Exit")],edges:[{id:"ab",source:"a",target:"b",distance:31}]},configuration:{spacing:6}});assert.ok(r.statistics.minimumSpacing>=5);assert.ok(r.statistics.maximumSpacing<=6);assert.equal(r.warnings.length,0);});
test("recalculation repairs stale edge references and applies a changed radius",()=>{const original=planBeacons({graph:line});const moved={...original.beacons[2],worldX:11,x:110,edgeOffset:0};const r=planBeacons({graph:line,profile:{...BEACON_PROFILES[0],coverageRadius:8},configuration:{beacons:[moved]}});assert.equal(r.beacons[0].edgeOffset,11);assert.equal(r.beacons[0].coverageRadius,8);});
test("a graph crossing a wall is warned, never scored as fully covered",()=>{const region=box(-1,-1,24,2),r=generate({graph:line,floorGeometry:{floors:[{floorId:"G",boundaries:[region],walkableAreas:[region],walls:[{points:[{x:11,y:-1},{x:11,y:1}],width:.2}]}]}});assert.ok(r.coverage.estimatedPercent<100);assert.ok(r.warnings.some(w=>w.code==="graph-geometry-conflict"));});
test("duplicate node-attached beacons reduce quality and duplicate graph IDs are rejected",()=>{const original=planBeacons({graph:line});const r=planBeacons({graph:line,configuration:{beacons:[...original.beacons,{...original.beacons[0],id:"duplicate"}]}});assert.ok(r.quality.spacingScore<100);assert.ok(r.quality.overallScore<100);assert.throws(()=>planBeacons({graph:{...line,edges:[...line.edges,...line.edges]}}));});
test("same-floor edge distances cannot fabricate physical beacon spacing",()=>{assert.throws(()=>planBeacons({graph:{...line,edges:[{...line.edges[0],distance:11}]}}),/does not match/);});
test("traverses large graph without recursion",()=>{const count=10001;const graph={nodes:Array.from({length:count},(_,i)=>n(String(i),i)),edges:Array.from({length:count-1},(_,i)=>({id:String(i),source:String(i),target:String(i+1),distance:1}))};const begin=performance.now();const r=planBeacons({graph,profile:BEACON_PROFILES[0]});assert.ok(r.beacons.length>1000);assert.equal(r.beacons.every(b=>b.type==="Navigation"),true);console.log(`beacon benchmark: ${count} nodes, ${r.beacons.length} beacons, ${(performance.now()-begin).toFixed(1)} ms`);});

test('landmark deployment groups four lifts and covers a junction without corridor filler',()=>{
  const graph={nodes:[n('j',20,10),n('left',0,10),n('right',40,10),n('up',20,30),...Array.from({length:4},(_,i)=>n('lift'+i,5+i,10,'Lift'))],edges:[{id:'jl',source:'j',target:'left',distance:20},{id:'jr',source:'j',target:'right',distance:20},{id:'ju',source:'j',target:'up',distance:20},...Array.from({length:4},(_,i)=>({id:'lift-edge'+i,source:'left',target:'lift'+i,distance:5+i}))]};
  const result=generate({graph,configuration:{placementStrategy:'landmarks'},floorGeometry:{floors:[{floorId:'G',boundaries:[box(-1,-1,45,35)],walkableAreas:[box(-1,-1,45,35)]}]}});
  assert.equal(result.beacons.filter(b=>b.placementStrategy==='Shared vertical lobby').length,1);
  assert.ok(result.beacons.some(b=>b.nodeId==='j'));
  assert.ok(result.beacons.every(b=>b.placementStrategy));
});

test('landmark deployment gives a room one exterior suggestion and none inside its polygon',()=>{
  const graph={nodes:[n('a',0,2),n('b',30,2)],edges:[{id:'ab',source:'a',target:'b',distance:30}]};
  const room={id:'shop',type:'room',floorId:'G',points:box(50,50,100,100)};
  const result=generate({graph,configuration:{placementStrategy:'landmarks'},floorGeometry:{metersPerPixel:.1,objects:[{type:'buildingBoundary',floorId:'G',points:box(-10,-10,400,200)},{type:'walkableArea',floorId:'G',points:box(-10,-10,400,200)},room]}});
  assert.equal(result.beacons.filter(b=>b.outletIds?.includes('shop')).length,1);
  assert.ok(result.beacons.some(b=>b.nodeId==='a'||b.anchorNodeIds?.includes('a')));
  assert.ok(result.beacons.some(b=>b.nodeId==='b'||b.anchorNodeIds?.includes('b')));
  assert.ok(result.beacons.find(b=>b.outletIds?.includes('shop')).worldY<5);
});

test('distinct close junctions each retain an exact beacon in centerline mode',()=>{
  const nodes=[n('j1',0),n('j2',.1),n('a',-10),n('b',0,10),n('c',10.1),n('d',.1,-10)];
  const edges=[['j1','j2'],['j1','a'],['j1','b'],['j2','c'],['j2','d']].map(([source,target],i)=>({id:String(i),source,target,distance:Math.hypot(nodes.find(n=>n.id===source).worldX-nodes.find(n=>n.id===target).worldX,nodes.find(n=>n.id===source).worldY-nodes.find(n=>n.id===target).worldY)}));
  const plan=planBeacons({graph:{nodes,edges},placementRules:{minimumSpacing:5,maximumSpacing:10},configuration:{spacing:7.5}});
  for(const id of ['j1','j2'])assert.equal(plan.beacons.filter(b=>b.nodeId===id).length,1);
  assert.ok(plan.warnings.some(w=>w.code==='spacing-too-small'));
});
test('close junctions retain both stations when merging would shorten path coverage',()=>{
  const nodes=[n('left',-5),n('a',0),n('b',2),n('right',7),n('top',0,5),n('bottom',2,-5)];
  const pairs=[['left','a'],['a','b'],['b','right'],['a','top'],['b','bottom']];
  const edges=pairs.map(([source,target],i)=>({id:String(i),source,target,distance:Math.hypot(nodes.find(n=>n.id===source).worldX-nodes.find(n=>n.id===target).worldX,nodes.find(n=>n.id===source).worldY-nodes.find(n=>n.id===target).worldY)}));
  const result=planBeacons({graph:{nodes,edges},placementRules:{minimumSpacing:5,maximumSpacing:10},configuration:{spacing:7.5}});
  const near=result.beacons.filter(b=>Math.hypot(b.worldX-1,b.worldY)<2.5);
  assert.equal(near.length,2);
  assert.ok(['a','b'].includes(near[0].nodeId));
});

test('crowded junctions share a beacon with or without vertical POIs without losing route coverage',()=>{
  const nodes=[n('j1',0),n('j2',1),n('a',-9,0,'Entrance'),n('b',0,9,'Entrance'),n('c',10,0,'Entrance'),n('d',1,-9,'Entrance')];
  const edges=[['j1','j2'],['j1','a'],['j1','b'],['j2','c'],['j2','d']].map(([source,target],i)=>({id:String(i),source,target,distance:Math.hypot(nodes.find(n=>n.id===source).worldX-nodes.find(n=>n.id===target).worldX,nodes.find(n=>n.id===source).worldY-nodes.find(n=>n.id===target).worldY)}));
  const input={graph:{nodes,edges},placementRules:{minimumSpacing:5,maximumSpacing:10},configuration:{spacing:7.5}};
  const baseline=planBeacons(input);
  const plan=planBeacons({...input,pois:[{...n('escalator',0),category:'Escalator'},{...n('lift',1),category:'Lift'}]});
  assert.equal(plan.beacons.filter(b=>Math.hypot(b.worldX,b.worldY)<3).length,1);
  assert.equal(baseline.beacons.filter(b=>Math.hypot(b.worldX,b.worldY)<3).length,1);
  assert.ok(plan.beacons.length<=baseline.beacons.length);
  assert.equal(plan.coverage.coveredLength,baseline.coverage.coveredLength);
  assert.ok(!plan.warnings.some(w=>w.code==='missing-anchor'));
  assert.ok(plan.beacons.some(b=>b.nodeId==='j2'||b.anchorNodeIds?.includes('j2')));
});

test('ordered landmark planning starts at floor connections and fills corridors evenly at 6–10 m',()=>{
  const graph={nodes:[n('exit',24,0,'Exit'),n('lift',0,0,'Lift')],edges:[{id:'path',source:'lift',target:'exit',distance:24}]};
  const result=generate({graph,configuration:{placementStrategy:'landmarks',spacing:8,reliableRadius:6},placementRules:{minimumSpacing:6,maximumSpacing:10},floorGeometry:{floors:[{floorId:'G',boundaries:[box(-2,-2,30,5)],walkableAreas:[box(-2,-2,30,5)]}]}});
  assert.equal(result.beacons[0].nodeId,'lift');
  assert.deepEqual(result.beacons.map(b=>b.worldX).sort((a,b)=>a-b),[0,8,16,24]);
  assert.equal(result.coverage.estimatedPercent,100);
});
test('intermediate stations divide the space between already marked beacons evenly',()=>{
  const graph={nodes:[n('a',0,0,'Entrance'),n('b',32,0,'Exit')],edges:[{id:'ab',source:'a',target:'b',distance:32}]};
  const seeds=[8,24].map((x,i)=>({...n(`saved${i}`,x),type:'Navigation',edgeId:'ab',edgeOffset:x,nodeId:undefined,locked:true}));
  const result=generate({graph,configuration:{placementStrategy:'centerline',spacing:8,reliableRadius:6,seedBeacons:seeds},placementRules:{minimumSpacing:6,maximumSpacing:10},floorGeometry:{floors:[{floorId:'G',boundaries:[box(-2,-2,38,5)],walkableAreas:[box(-2,-2,38,5)]}]}});
  assert.deepEqual(result.beacons.map(b=>b.worldX).sort((a,b)=>a-b),[0,8,16,24,32]);
});
test('floor-connection annotations are covered even when supplied route nodes are only corridors',()=>{
  const graph={nodes:[n('a',0),n('b',24)],edges:[{id:'ab',source:'a',target:'b',distance:24}]};
  const poi={...n('lift-poi',12,1),category:'Lift'};
  const result=generate({graph,pois:[poi],configuration:{placementStrategy:'centerline',spacing:8,reliableRadius:6},placementRules:{minimumSpacing:6,maximumSpacing:10},floorGeometry:{floors:[{floorId:'G',boundaries:[box(-2,-2,30,6)],walkableAreas:[box(-2,-2,30,6)]}]}});
  assert.ok(result.beacons.some(b=>Math.hypot(b.worldX-poi.worldX,b.worldY-poi.worldY)<=5));
});
