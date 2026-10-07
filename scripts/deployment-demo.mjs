import fs from "node:fs";
import assert from "node:assert/strict";
import {DeploymentPlanner} from "../src/engines/deploymentPlanner.js";
import {sampleMall} from "../src/samples/sampleMall.js";
import {geometryForProject,saveDeployment} from "../src/models/deployments.js";
import {deploymentDocument,beaconCsv,compareDeployments} from "../src/models/deploymentExport.js";
import {BEACON_PROFILES} from "../src/engines/beaconPlacement.js";

const planner=new DeploymentPlanner({graph:sampleMall.graph,floorGeometry:geometryForProject(sampleMall)});
const baseline=planner.generate();let project={...sampleMall,beaconPlan:baseline.plan,beaconProfile:BEACON_PROFILES[0],planningSettings:planner.settings,coverageAnalysis:baseline.coverage};
project=saveDeployment(project,"Version A · baseline","version-a");
const moved=planner.edit("move",{id:"IW007",floorId:"floor-1",x:560,y:161,worldX:56,worldY:16.1});
const disabled=planner.edit("patch",{id:"IW007",patch:{enabled:false}});
assert.ok(moved.work.recomputedCells<baseline.coverage.floorReports[0].cells.length);
project=saveDeployment({...project,beaconPlan:disabled.plan,coverageAnalysis:disabled.coverage},"Version B · moved and disabled","version-b");
fs.mkdirSync("reports",{recursive:true});
fs.writeFileSync("reports/milestone-6-deployment.json",JSON.stringify(deploymentDocument(project),null,2));
fs.writeFileSync("reports/milestone-6-beacons.csv",beaconCsv(disabled.plan.beacons));
const demo={baseline:baseline.plan.statistics,moved:moved.plan.statistics,disabled:disabled.plan.statistics,incrementalWork:moved.work,comparison:compareDeployments(...project.deployments)};

const graph={nodes:[],edges:[]},side=101;
for(let y=0;y<side;y++)for(let x=0;x<side;x++)graph.nodes.push({id:`${x}-${y}`,floorId:"large",x:x*5.5,y:y*5.5,worldX:x*5.5,worldY:y*5.5,type:"Corridor",metadata:{}});
for(let y=0;y<side;y++)for(let x=0;x<side;x++){const id=`${x}-${y}`;if(x+1<side)graph.edges.push({id:`h-${id}`,source:id,target:`${x+1}-${y}`,distance:5.5});if(y+1<side)graph.edges.push({id:`v-${id}`,source:id,target:`${x}-${y+1}`,distance:5.5});}
const polygon=[{x:-1,y:-1},{x:551,y:-1},{x:551,y:551},{x:-1,y:551}],start=performance.now();
const large=new DeploymentPlanner({graph,floorGeometry:{floors:[{floorId:"large",boundaries:[polygon],walkableAreas:[polygon]}]}});large.generate();const generationMs=performance.now()-start;
const edits=[];for(let i=0;i<5;i++)edits.push(large.edit("patch",{id:"beacon-5000",patch:{enabled:i%2===1}}).work);
assert.ok(edits.every(w=>w.incremental&&w.recomputedCells<500&&w.recomputedEdges<20));
demo.benchmark={nodes:graph.nodes.length,edges:graph.edges.length,beacons:large.beacons.length,generationMs,editMs:edits.map(w=>w.elapsedMs),lastWork:edits.at(-1)};
fs.writeFileSync("reports/milestone-6-demo.json",JSON.stringify(demo,null,2));console.log(JSON.stringify(demo,null,2));
