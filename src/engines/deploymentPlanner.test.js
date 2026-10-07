import test from "node:test";
import assert from "node:assert/strict";
import {DeploymentPlanner} from "./deploymentPlanner.js";
import {sampleMall} from "../samples/sampleMall.js";
import {geometryForProject,saveDeployment,loadDeployment} from "../models/deployments.js";
import {compareDeployments,beaconCsv,deploymentDocument} from "../models/deploymentExport.js";
import {BEACON_PROFILES} from "./beaconPlacement.js";

const inputs=()=>({graph:structuredClone(sampleMall.graph),floorGeometry:geometryForProject(sampleMall),settings:{additionalBeaconBudget:0},pois:sampleMall.objects.filter(o=>o.type==="poi").map(o=>({...o,floorId:"floor-1",worldX:o.x*.1,worldY:o.y*.1}))});
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
  const next=planner.configure({coverageThreshold:"marginal",installationCost:100});assert.ok(next.coverage.coveredArea>before);assert.equal(next.plan.statistics.installationCost,1700);assert.deepEqual(planner.beacons.map(b=>b.id),ids);
  const settings=planner.settings;assert.throws(()=>planner.configure({reliableRadius:9,marginalRadius:2}));assert.equal(planner.settings,settings);assert.throws(()=>planner.edit("patch",{id:"IW007",patch:{mountingHeight:NaN}}));
});
test("another floor and disconnected region are reused during selected edits",()=>{
  const input=inputs(),graph=input.graph;const extra=graph.nodes.map(n=>({...n,id:`f2-${n.id}`,floorId:"floor-2"}));graph.nodes.push(...extra);graph.edges.push(...graph.edges.map(e=>({...e,id:`f2-${e.id}`,source:`f2-${e.source}`,target:`f2-${e.target}`})));
  const geo=structuredClone(input.floorGeometry.objects);input.floorGeometry.objects.push(...geo.map(o=>({...o,id:`f2-${o.id}`,floorId:"floor-2"})));
  const planner=new DeploymentPlanner(input);planner.generate();const floor=planner.coverage.floorReports.find(f=>f.floorId==="floor-2"),beacon=planner.beacons.find(b=>b.floorId==="floor-1"&&b.type==="Navigation");const next=planner.edit("patch",{id:beacon.id,patch:{enabled:false}});assert.equal(next.work.recomputedRegions,1);assert.equal(next.work.regions,8);assert.equal(next.work.reusedFloors,1);assert.ok(planner.coverage.floorReports.find(f=>f.floorId==="floor-2")===floor);
});
test("locked geometry conflicts remain visible and penalize quality instead of disappearing",()=>{
  const planner=new DeploymentPlanner({...inputs(),beacons:[{id:"bad",floorId:"floor-1",x:660,y:420,worldX:66,worldY:42,locked:true}]});assert.ok(planner.output.plan.warnings.some(w=>w.code==="restricted-area"));assert.equal(planner.output.plan.quality.overallScore,0);assert.equal(planner.recalculate().plan.beacons.length,1);
});
test("version comparison persists analyzed metrics and export is unit-explicit and CSV-safe",()=>{
  const planner=new DeploymentPlanner(inputs());planner.generate();let project={...sampleMall,beaconPlan:planner.output.plan,coverageAnalysis:planner.coverage,planningSettings:planner.settings,beaconProfile:BEACON_PROFILES[0]};project=saveDeployment(project,"A","a");
  planner.edit("patch",{id:"IW007",patch:{enabled:false}});project=saveDeployment({...project,beaconPlan:planner.output.plan,coverageAnalysis:planner.coverage},"B","b");const comparison=compareDeployments(...project.deployments);assert.ok(comparison.sameGeometry);assert.equal(comparison.rows.find(r=>r.metric==="activeBeacons").delta,-1);assert.equal(loadDeployment(project,"a").beaconPlan.beacons.filter(b=>b.enabled!==false).length,17);
  assert.equal(deploymentDocument(project).units,"metres");assert.ok(beaconCsv([{id:"=1+2",notes:'a,"b"\nnext'}]).includes("'=1+2"));assert.ok(beaconCsv([{notes:'a,"b"\nnext'}]).includes('a,""b""\nnext'));
});
test("sequential IDs persist through delete, reload, prefix changes and version reload",()=>{
  const planner=new DeploymentPlanner(inputs());planner.generate();
  assert.equal(planner.beacons[0].id,"IW001");assert.equal(planner.beacons[16].id,"IW017");
  planner.edit("delete",{id:"IW017"});
  let result=planner.edit("duplicate",{id:"IW007"});assert.equal(result.plan.beacons.at(-1).id,"IW018");
  const restored=new DeploymentPlanner({...inputs(),settings:result.settings,beacons:result.plan.beacons});
  restored.edit("delete",{id:"IW018"});result=restored.edit("duplicate",{id:"IW007"});assert.equal(result.plan.beacons.at(-1).id,"IW019");
  restored.configure({beaconPrefix:"BLD"});result=restored.edit("duplicate",{id:"IW007"});assert.equal(result.plan.beacons.at(-1).id,"BLD020");assert.ok(result.plan.beacons.some(b=>b.id==="IW007"));
  assert.throws(()=>restored.configure({beaconPrefix:"<invalid>"}));
  const project={...sampleMall,beaconPlan:result.plan,planningSettings:result.settings,beaconProfile:BEACON_PROFILES[0]};
  const saved=saveDeployment(project,"A","a");
  const loaded=loadDeployment({...saved,planningSettings:{...result.settings,nextBeaconNumber:30}},"a");
  assert.equal(loaded.planningSettings.nextBeaconNumber,30);
});
