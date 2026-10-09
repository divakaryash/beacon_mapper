import test from 'node:test';
import assert from 'node:assert/strict';
import {planBeacons,analyzePlacement,BEACON_PROFILES} from './beaconPlacement.js';
import {analyzeFloorTopology,referenceBeacon,validateTopologySettings} from './topologyPlacement.js';
import {compileFloorGeometry,geometryConflict,visibleGeometrySegment} from './floorGeometry.js';
import {analyzeCoverage} from './coverage.js';
import {DeploymentPlanner} from './deploymentPlanner.js';
import {sampleMall} from '../samples/sampleMall.js';
import {geometryForProject} from '../models/deployments.js';
const box=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const node=(id,x,type='Corridor',category)=>({id,floorId:'G',x:x*10,y:0,worldX:x,worldY:0,type,metadata:{category}});
function fixture(width=4,type='Corridor',category){const polygon=box(-1,-width/2,24,width);return {graph:{nodes:[node('a',0,type,category),node('b',22)],edges:[{id:'ab',source:'a',target:'b',distance:22}]},floorGeometry:{floors:[{floorId:'G',boundaries:[polygon],walkableAreas:[polygon]}]},configuration:{additionalBeaconBudget:0}};}
test('cross-sections classify narrow, medium, wide and open polygons without crossing obstacles',()=>{
  for(const [width,strategy] of [[2,'Narrow Corridor'],[4,'Medium Corridor'],[8,'Wide Corridor'],[16,'Atrium']]){const input=fixture(width),r=analyzeFloorTopology({graph:input.graph,floors:compileFloorGeometry(input.floorGeometry)});assert.ok(Math.abs(r[0].corridorWidth-width)<1e-7);assert.equal(r[0].strategy,strategy);assert.equal(r[0].walkablePolygons.length,1);}
  const input=fixture(16);input.floorGeometry.floors[0].restrictedAreas=[box(-1,2,24,6)];const r=analyzeFloorTopology({graph:input.graph,floors:compileFloorGeometry(input.floorGeometry)});assert.ok(Math.abs(r[0].corridorWidth-10)<1e-7);
});
test('all ten strategies are selected from geometry and explicit landmark semantics',()=>{
  for(const [width,type,category,strategy] of [[2,'Corridor',null,'Narrow Corridor'],[4,'Corridor',null,'Medium Corridor'],[8,'Corridor',null,'Wide Corridor'],[4,'Junction',null,'Junction'],[16,'Corridor',null,'Atrium'],[16,'Room Entrance','Food Court','Food Court'],[4,'Room Entrance',null,'Store Entrance'],[4,'Lift',null,'Lift'],[4,'Escalator',null,'Escalator'],[4,'Stairs',null,'Stair']]){const r=planBeacons(fixture(width,type,category));assert.equal(r.beacons.find(b=>b.nodeId==='a').placementStrategy,strategy);}
});
test('graph references retain valid off-centre coordinates and drawing scale',()=>{
  const input=fixture(4),r=planBeacons(input);assert.ok(r.beacons.some(b=>Math.abs(b.worldY)>1));for(const b of r.beacons){assert.ok(Math.abs(b.y-b.worldY*10)<1e-7);assert.equal(geometryConflict({x:b.worldX,y:b.worldY},compileFloorGeometry(input.floorGeometry).get('G')),null);}
  const b=referenceBeacon({id:'manual',floorId:'G',worldX:7,worldY:1,x:70,y:10},input.graph);assert.equal(b.worldY,1);assert.equal(b.edgeOffset,7);assert.equal(b.referenceDistance,1);
  assert.equal(r.coverage.estimatedPercent,100);
});
test('configured reliable radii drive both placement and coverage instead of silently using profile radius',()=>{
  const input=fixture(4),r=planBeacons({...input,configuration:{...input.configuration,reliableRadius:2,marginalRadius:3}});assert.ok(r.beacons.every(b=>b.reliableRadius===2&&b.marginalRadius===3));assert.ok(r.coverage.estimatedPercent<100);
});
test('raw off-center references cannot fabricate graph coverage even without topology metadata',()=>{
  const input=fixture(30),r=analyzePlacement({graph:input.graph,floors:compileFloorGeometry(input.floorGeometry),beacons:[{id:'raw',floorId:'G',worldX:11,worldY:10,x:110,y:100,edgeId:'ab',edgeOffset:11,coverageRadius:6,reliableRadius:6}]});assert.equal(r.coverage.estimatedPercent,0);assert.equal(r.quality.coverageScore,0);
});
test('nearby POIs and explicit entrances are reported; malformed POIs and thresholds fail closed',()=>{
  const input=fixture(4),pois=[{id:'store',floorId:'G',worldX:11,worldY:1,category:'Store'}];const r=planBeacons({...input,pois});assert.ok(r.topology.edges[0].adjacentRoomEntrances.includes('store'));assert.ok(r.beacons.some(b=>b.placementStrategy==='Store Entrance'));
  assert.throws(()=>planBeacons({...input,pois:[{...pois[0],worldX:NaN}]}));assert.throws(()=>validateTopologySettings({narrowWidth:10}));assert.throws(()=>validateTopologySettings({additionalBeaconBudget:201}));
});
test('wide-area candidates improve coverage with fewer clustered route beacons, then stop at a configured budget',()=>{
  const geometry=geometryForProject(sampleMall),baseline=planBeacons({graph:sampleMall.graph,floorGeometry:geometry,configuration:{placementStrategy:'centerline'}});
  const oldCoverage=analyzeCoverage({graph:sampleMall.graph,floorGeometry:geometry,beacons:baseline.beacons,profile:BEACON_PROFILES[0]});
  const planner=new DeploymentPlanner({graph:sampleMall.graph,floorGeometry:geometry,settings:{additionalBeaconBudget:0}}),sameCount=planner.generate();assert.ok(sameCount.plan.beacons.length<=baseline.beacons.length);assert.ok(sameCount.coverage.coveragePercentage>oldCoverage.coveragePercentage);assert.equal(sameCount.coverage.graphCoveragePercentage,100);
  planner.configure({additionalBeaconBudget:3});const expanded=planner.generate();assert.ok(expanded.plan.topology.optimization.areaBeacons<=3);assert.ok(expanded.coverage.coveragePercentage>sameCount.coverage.coveragePercentage);assert.equal(expanded.coverage.graphCoveragePercentage,100);assert.ok(expanded.plan.beacons.filter(b=>b.placementRole==='area').every(b=>b.referenceDistance>0));
});
test('moving, reloading and recalculating off-graph beacons preserves coordinates, IDs and live coverage',()=>{
  const input=fixture(4),planner=new DeploymentPlanner({...input,settings:{additionalBeaconBudget:0}});planner.generate();const id=planner.beacons[2].id;planner.edit('move',{id,floorId:'G',worldX:11,worldY:1,x:110,y:10});planner.recalculate('selected',id);const before=planner.beacons.find(b=>b.id===id);assert.equal(before.worldY,1);assert.ok(!planner.output.plan.warnings.some(w=>w.code==='invalid-graph-reference'));
  const reload=new DeploymentPlanner({...input,beacons:planner.beacons,settings:planner.settings});reload.recalculate('project');assert.deepEqual(reload.beacons.find(b=>b.id===id),before);assert.equal(reload.coverage.coveredArea,planner.coverage.coveredArea);
});
test('blocked and missing geometry never become installation candidates; multi-floor references stay local',()=>{
  const input=fixture(8);input.floorGeometry.floors[0].walls=[{points:[{x:5,y:-4},{x:5,y:4}],width:.2}];const r=planBeacons(input),floors=compileFloorGeometry(input.floorGeometry);assert.ok(r.beacons.every(b=>!geometryConflict({x:b.worldX,y:b.worldY},floors.get(b.floorId))));assert.ok(r.coverage.estimatedPercent<100);
  const unknown=planBeacons({...input,floorGeometry:{}});assert.equal(unknown.beacons.length,0);
  const b=referenceBeacon({floorId:'other',worldX:11,worldY:1,x:110,y:10},input.graph);assert.equal(b.edgeId,undefined);
});
test('10,001-node topology generation stays bounded and remains independent from UI',()=>{
  const count=10001,polygon=box(-1,-2,count+1,4),graph={nodes:Array.from({length:count},(_,i)=>node(String(i),i)),edges:Array.from({length:count-1},(_,i)=>({id:String(i),source:String(i),target:String(i+1),distance:1}))};
  const start=performance.now(),r=planBeacons({graph,floorGeometry:{floors:[{floorId:'G',boundaries:[polygon],walkableAreas:[polygon]}]},configuration:{additionalBeaconBudget:0}}),elapsed=performance.now()-start;
  console.log(`topology benchmark: ${count} nodes, ${r.topology.edges.length} edges, ${r.beacons.length} beacons, ${elapsed.toFixed(1)} ms`);assert.equal(r.topology.edges.length,10000);assert.ok(r.beacons.length>1000);assert.ok(r.beacons.some(b=>Math.abs(b.worldY)>1));assert.equal(r.coverage.estimatedPercent,100);assert.ok(elapsed<10000);
});

test('automatic generation merges clustered access points and retains a single navigation beacon per visible 3 m neighbourhood',()=>{
  const input=fixture(2);
  input.graph.nodes=[node('a',0,'Entrance'),node('b',.7,'Exit'),node('c',1.3,'Lift'),node('d',1.9,'Escalator'),node('end',22)];
  input.graph.edges=input.graph.nodes.slice(1).map((n,i)=>({id:`edge-${i}`,source:input.graph.nodes[i].id,target:n.id,distance:n.worldX-input.graph.nodes[i].worldX}));
  const result=planBeacons(input),floor=compileFloorGeometry(input.floorGeometry).get('G');
  assert.ok(result.beacons.length>1);
  assert.equal(result.beacons.filter(b=>b.worldX<2).length,1);
  for(let i=0;i<result.beacons.length;i++)for(const b of result.beacons.slice(i+1)) {
    const a=result.beacons[i];
    if(visibleGeometrySegment({x:a.worldX,y:a.worldY},{x:b.worldX,y:b.worldY},floor))assert.ok(Math.hypot(a.worldX-b.worldX,a.worldY-b.worldY)>=3-1e-6);
  }
  assert.ok(!result.warnings.some(w=>w.code==='missing-anchor'));
});

test('nearby beacons separated by walls or floors cannot be merged',async()=>{
  const {nearbyVisibleBeacon}=await import('./topologyPlacement.js');
  const floors=compileFloorGeometry({floors:[{floorId:'G',boundaries:[box(-5,-5,10,10)],walkableAreas:[box(-5,-5,10,10)],walls:[{points:[{x:0,y:-5},{x:0,y:5}],width:.2}]}]});
  const candidate={floorId:'G',worldX:1,worldY:0};
  assert.equal(nearbyVisibleBeacon([{floorId:'G',worldX:-1,worldY:0}],candidate,floors),undefined);
  assert.equal(nearbyVisibleBeacon([{floorId:'L1',worldX:1,worldY:0}],candidate,floors),undefined);
});
