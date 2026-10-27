import test from "node:test";
import assert from "node:assert/strict";
import {DeploymentPlanner} from "./deploymentPlanner.js";
import {sampleMall} from "../samples/sampleMall.js";
import {geometryForProject,saveDeployment,loadDeployment} from "../models/deployments.js";
import {compareDeployments,beaconCsv,deploymentDocument} from "../models/deploymentExport.js";
import {BEACON_PROFILES} from "./beaconPlacement.js";

const inputs=()=>({graph:structuredClone(sampleMall.graph),floorGeometry:geometryForProject(sampleMall),settings:{additionalBeaconBudget:0,placementStrategy:"topology"},pois:sampleMall.objects.filter(o=>o.type==="poi").map(o=>({...o,floorId:"floor-1",worldX:o.x*.1,worldY:o.y*.1}))});
function fresh(planner){return new DeploymentPlanner({...inputs(),beacons:structuredClone(planner.beacons),settings:planner.settings}).output;}
function equivalent(a,b){assert.equal(a.coverage.coveredArea,b.coverage.coveredArea);assert.equal(a.coverage.overlapArea,b.coverage.overlapArea);assert.equal(a.coverage.graphCoveredLength,b.coverage.graphCoveredLength);assert.deepEqual(a.coverage.gaps,b.coverage.gaps);assert.deepEqual(a.plan.statistics,b.plan.statistics);}

test("live disable/enable, move, profile radii, delete and duplicate match full analysis",()=>{
  const planner=new DeploymentPlanner(inputs());planner.generate();const ids=planner.beacons.map(b=>b.id),initial=planner.output;
  let result=planner.edit("patch",{id:"IW007",patch:{enabled:false}});equivalent(result,fresh(planner));assert.ok(result.work.recomputedCells<initial.coverage.floorReports.reduce((sum,f)=>sum+f.cells.length,0));
  planner.edit("patch",{id:"IW007",patch:{enabled:true}});
  result=planner.edit("move",{id:"IW007",floorId:"floor-1",x:555,y:158,worldX:55.5,worldY:15.8});equivalent(result,fresh(planner));assert.equal(planner.beacons.find(b=>b.id==="IW007").worldX,55.5);assert.equal(planner.beacons.find(b=>b.id==="IW007").worldY,15.8);
  result=planner.edit("patch",{id:"IW007",patch:{profileId:BEACON_PROFILES[1].id,installationType:"Wall",mountingHeight:2.5,reliableRadius:4,marginalRadius:5,coverageRadius:5}});equivalent(result,fresh(planner));
  assert.deepEqual(planner.beacons.map(b=>b.id),ids);
  result=planner.edit("duplicate",{id:"IW007",newId:"duplicate"});assert.ok(result.plan.warnings.some(w=>w.code==="duplicate-beacons"));equivalent(result,fresh(planner));
  result=planner.edit("delete",{id:"duplicate"});equivalent(result,fresh(planner));
});
test("locking protects position, deletion and scoped recalculation",()=>{
  const planner=new DeploymentPlanner(inputs());planner.generate();planner.edit("patch",{id:"IW007",patch:{locked:true}});const position=structuredClone(planner.beacons.find(b=>b.id==="IW007"));
  assert.throws(()=>planner.edit("move",{id:position.id,worldX:56,worldY:17}),/Unlock/);assert.throws(()=>planner.edit("delete",{id:position.id}),/Unlock/);
  for(const scope of ["selected","floor","project"])planner.recalculate(scope,position.id);
  assert.deepEqual(planner.beacons.find(b=>b.id===position.id),position);
  planner.generate();assert.deepEqual(planner.beacons.find(b=>b.id===position.id),position);
});
test("metadata settings reuse analysis and hybrid generation preserves manually moved beacons",()=>{
  const planner=new DeploymentPlanner(inputs());planner.generate();
  const result=planner.configure({installationCost:250,currency:"INR"});
  assert.equal(result.work.recomputedCells,0);assert.equal(result.work.recomputedEdges,0);assert.equal(result.work.recomputedRegions,0);
  planner.edit("move",{id:"IW007",floorId:"floor-1",x:560,y:161,worldX:56,worldY:16.1});
  const moved=structuredClone(planner.beacons.find(b=>b.id==="IW007"));assert.equal(moved.origin,"manual");
  planner.generate();assert.deepEqual(planner.beacons.find(b=>b.id===moved.id),moved);
});
test("inspector contribution equals area lost by removal; nearest POI and warnings have locations",()=>{
  const planner=new DeploymentPlanner(inputs());planner.generate();const info=planner.inspector("IW007"),area=planner.coverage.coveredArea;assert.ok(info.nearestPoi);assert.ok(info.nearestEdge);
  const after=planner.edit("delete",{id:"IW007"});assert.equal(area-after.coverage.coveredArea,info.coverageContribution);
  assert.ok(after.plan.warnings.filter(w=>w.code.startsWith("spacing-")).every(w=>Number.isFinite(w.x)&&Number.isFinite(w.y)));
});
test("settings trigger analysis without regenerating layout; invalid changes are rejected",()=>{
  const planner=new DeploymentPlanner(inputs());planner.generate();const ids=planner.beacons.map(b=>b.id),before=planner.coverage.coveredArea;
  const next=planner.configure({coverageThreshold:"marginal",installationCost:100});assert.ok(next.coverage.coveredArea>before);assert.equal(next.plan.statistics.installationCost,ids.length*100);assert.deepEqual(planner.beacons.map(b=>b.id),ids);
  const settings=planner.settings;assert.throws(()=>planner.configure({reliableRadius:9,marginalRadius:2}));assert.equal(planner.settings,settings);assert.throws(()=>planner.edit("patch",{id:"IW007",patch:{mountingHeight:NaN}}));
});
test("another floor and disconnected region are reused during selected edits",()=>{
  const input=inputs(),graph=input.graph;const extra=graph.nodes.map(n=>({...n,id:`f2-${n.id}`,floorId:"floor-2"}));graph.nodes.push(...extra);graph.edges.push(...graph.edges.map(e=>({...e,id:`f2-${e.id}`,source:`f2-${e.source}`,target:`f2-${e.target}`})));
  const geo=structuredClone(input.floorGeometry.objects);input.floorGeometry.objects.push(...geo.map(o=>({...o,id:`f2-${o.id}`,floorId:"floor-2"})));
  const planner=new DeploymentPlanner(input);planner.generate();const floor=planner.coverage.floorReports.find(f=>f.floorId==="floor-2"),beacon=planner.beacons.find(b=>b.floorId==="floor-1"&&b.type==="Navigation");const next=planner.edit("patch",{id:beacon.id,patch:{enabled:false}});assert.equal(next.work.recomputedRegions,planner.regionsFor(beacon).size);assert.equal(next.work.regions,8);assert.equal(next.work.reusedFloors,1);assert.ok(planner.coverage.floorReports.find(f=>f.floorId==="floor-2")===floor);
});
test("locked geometry conflicts remain visible and penalize quality instead of disappearing",()=>{
  const planner=new DeploymentPlanner({...inputs(),beacons:[{id:"bad",floorId:"floor-1",x:660,y:420,worldX:66,worldY:42,locked:true}]});assert.ok(planner.output.plan.warnings.some(w=>w.code==="restricted-area"));assert.equal(planner.output.plan.quality.overallScore,0);assert.equal(planner.recalculate().plan.beacons.length,1);assert.throws(()=>planner.generate(),/inside blocked geometry/);assert.equal(planner.beacons[0].id,"bad");
});
test("version comparison persists analyzed metrics and export is unit-explicit and CSV-safe",()=>{
  const planner=new DeploymentPlanner(inputs());planner.generate();let project={...sampleMall,beaconPlan:planner.output.plan,coverageAnalysis:planner.coverage,planningSettings:planner.settings,beaconProfile:BEACON_PROFILES[0]};project=saveDeployment(project,"A","a");
  planner.edit("patch",{id:"IW007",patch:{enabled:false}});project=saveDeployment({...project,beaconPlan:planner.output.plan,coverageAnalysis:planner.coverage},"B","b");const comparison=compareDeployments(...project.deployments);assert.ok(comparison.sameGeometry);assert.equal(comparison.rows.find(r=>r.metric==="activeBeacons").delta,-1);assert.equal(loadDeployment(project,"a").beaconPlan.beacons.filter(b=>b.enabled!==false).length,project.deployments[0].plan.beacons.length);
  assert.equal(deploymentDocument(project).units,"metres");assert.ok(beaconCsv([{id:"=1+2",notes:'a,"b"\nnext'}]).includes("'=1+2"));assert.ok(beaconCsv([{notes:'a,"b"\nnext'}]).includes('a,""b""\nnext'));
});
test("sequential IDs persist through delete, reload, prefix changes and version reload",()=>{
  const planner=new DeploymentPlanner(inputs());planner.generate();
  const count=planner.beacons.length,iw=n=>`IW${String(n).padStart(3,"0")}`;
  assert.equal(planner.beacons[0].id,"IW001");assert.equal(planner.beacons.at(-1).id,iw(count));
  planner.edit("delete",{id:iw(count)});
  let result=planner.edit("duplicate",{id:"IW007"});assert.equal(result.plan.beacons.at(-1).id,iw(count+1));
  const restored=new DeploymentPlanner({...inputs(),settings:result.settings,beacons:result.plan.beacons});
  restored.edit("delete",{id:iw(count+1)});result=restored.edit("duplicate",{id:"IW007"});assert.equal(result.plan.beacons.at(-1).id,iw(count+2));
  restored.configure({beaconPrefix:"BLD"});result=restored.edit("duplicate",{id:"IW007"});assert.equal(result.plan.beacons.at(-1).id,`BLD${String(count+3).padStart(3,"0")}`);assert.ok(result.plan.beacons.some(b=>b.id==="IW007"));
  assert.throws(()=>restored.configure({beaconPrefix:"<invalid>"}));
  const project={...sampleMall,beaconPlan:result.plan,planningSettings:result.settings,beaconProfile:BEACON_PROFILES[0]};
  const saved=saveDeployment(project,"A","a");
  const loaded=loadDeployment({...saved,planningSettings:{...result.settings,nextBeaconNumber:30}},"a");
  assert.equal(loaded.planningSettings.nextBeaconNumber,30);
});

test('empty upload geometry cannot produce a misleading zero-score deployment',()=>{
  assert.throws(()=>new DeploymentPlanner({...inputs(),graph:{nodes:[],edges:[]}}),/No navigation paths detected/);
  assert.throws(()=>new DeploymentPlanner({...inputs(),floorGeometry:{objects:[],metersPerPixel:.1}}),/No walkable geometry detected/);
});

test('manual placement and relocation refresh waypoint coverage against a full analysis',()=>{
  const planner=new DeploymentPlanner(inputs());
  const initial=planner.output.coverage.graphCoveredLength;
  const placed=planner.edit('insert',{floorId:'floor-1',x:555,y:158,worldX:55.5,worldY:15.8});
  assert.equal(placed.plan.beacons.length,1);
  assert.ok(placed.coverage.graphCoveredLength>initial);
  equivalent(placed,fresh(planner));
  const id=placed.plan.beacons[0].id;
  const moved=planner.edit('move',{id,floorId:'floor-1',x:560,y:161,worldX:56,worldY:16.1});
  assert.equal(moved.plan.beacons[0].id,id);
  assert.equal(moved.plan.beacons[0].worldX,56);
  equivalent(moved,fresh(planner));
});

test('manual waypoint snapping uses line interiors and deletion refreshes coverage',()=>{
  const nodes=[{id:'a',type:'Corridor',floorId:'G',x:1,y:5,worldX:1,worldY:5},{id:'b',type:'Corridor',floorId:'G',x:29,y:5,worldX:29,worldY:5}];
  const region=[{x:0,y:0},{x:30,y:0},{x:30,y:10},{x:0,y:10}];
  const planner=new DeploymentPlanner({graph:{nodes,edges:[{id:'line',source:'a',target:'b',distance:28,direction:'bidirectional'}]},floorGeometry:{metersPerPixel:1,floors:[{floorId:'G',boundaries:[region],walkableAreas:[region]}]},settings:{additionalBeaconBudget:0}});
  let output=planner.edit('insert',{floorId:'G',x:15,y:7,worldX:15,worldY:7,snapToWaypoint:true});
  const b=output.plan.beacons[0];assert.equal(b.worldX,15);assert.equal(b.worldY,5);assert.equal(b.edgeOffset,14);assert.equal(b.snapToWaypoint,undefined);assert.ok(output.coverage.graphCoveredLength>0);
  output=planner.edit('move',{id:b.id,floorId:'G',x:20,y:8,worldX:20,worldY:8,snapToWaypoint:true});
  assert.equal(output.plan.beacons[0].worldX,20);assert.equal(output.plan.beacons[0].worldY,5);assert.equal(output.plan.beacons[0].id,b.id);
  output=planner.edit('delete',{id:b.id});assert.equal(output.plan.beacons.length,0);assert.equal(output.coverage.graphCoveragePercentage,0);assert.equal(output.coverage.gaps.length,1);
});

test('6 m separation takes precedence over clustered junctions, connections and coverage in every generation mode',()=>{
  const point=(id,x,y,type='Corridor')=>({id,floorId:'G',x,y,worldX:x,worldY:y,type});
  const nodes=[point('a',1,5,'Entrance'),point('lift',9,5,'Lift'),point('stairs',10,5,'Stairs'),point('junction',11,5,'Junction'),point('exit',29,5,'Exit'),point('branch',11,14)];
  const edges=[['a','lift'],['lift','stairs'],['stairs','junction'],['junction','exit'],['junction','branch']].map(([source,target],i)=>({id:`e${i}`,source,target,distance:Math.hypot(nodes.find(n=>n.id===source).worldX-nodes.find(n=>n.id===target).worldX,nodes.find(n=>n.id===source).worldY-nodes.find(n=>n.id===target).worldY)}));
  const region=[{x:0,y:0},{x:32,y:0},{x:32,y:16},{x:0,y:16}],floorGeometry={metersPerPixel:1,floors:[{floorId:'G',boundaries:[region],walkableAreas:[region]}]};
  const pois=nodes.filter(n=>n.type!=='Corridor').map(n=>({...n,category:n.type}));
  for(const placementStrategy of ['centerline','landmarks','topology','pois']){
    const planner=new DeploymentPlanner({graph:{nodes,edges},floorGeometry,pois,settings:{placementStrategy,cellSize:1,additionalBeaconBudget:0}});
    const result=planner.generate(),active=result.plan.beacons.filter(b=>b.enabled!==false);
    assert.ok(active.length>=2,placementStrategy);
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++)assert.ok(Math.hypot(active[i].worldX-active[j].worldX,active[i].worldY-active[j].worldY)>=6-1e-6,`${placementStrategy}: ${active[i].id}/${active[j].id}`);
    assert.ok(!result.plan.warnings.some(w=>w.code==='physical-spacing-too-small'),placementStrategy);
  }
});

test('generation refuses to retain a cluster of fixed manual beacons',()=>{
  const planner=new DeploymentPlanner(inputs());
  planner.edit('insert',{floorId:'floor-1',x:555,y:158,worldX:55.5,worldY:15.8});
  planner.edit('insert',{floorId:'floor-1',x:560,y:158,worldX:56,worldY:15.8});
  const before=structuredClone(planner.beacons);
  assert.throws(()=>planner.generate(),/less than 6 m apart/);
  assert.deepEqual(planner.beacons,before);
});

test('a clear corridor keeps consecutive physical beacon distances inside 6–10 m',()=>{
  const region=[{x:0,y:0},{x:44,y:0},{x:44,y:4},{x:0,y:4}];
  const graph={nodes:[{id:'a',floorId:'G',type:'Entrance',x:1,y:2,worldX:1,worldY:2},{id:'b',floorId:'G',type:'Exit',x:43,y:2,worldX:43,worldY:2}],edges:[{id:'ab',source:'a',target:'b',distance:42}]};
  const planner=new DeploymentPlanner({graph,floorGeometry:{metersPerPixel:1,floors:[{floorId:'G',boundaries:[region],walkableAreas:[region]}]},settings:{placementStrategy:'centerline',spacing:8,cellSize:1,additionalBeaconBudget:0}});
  const beacons=planner.generate().plan.beacons.sort((a,b)=>a.worldX-b.worldX);
  assert.ok(beacons.length>2);
  for(let i=1;i<beacons.length;i++){const gap=Math.hypot(beacons[i].worldX-beacons[i-1].worldX,beacons[i].worldY-beacons[i-1].worldY);assert.ok(gap>=6-1e-6&&gap<=10+1e-6,`Physical gap ${gap} m`);}
});
