import assert from 'node:assert/strict';
import {planBeacons} from '../src/engines/beaconPlacement.js';
import {normalizeProject} from '../src/models/drawing.js';
import {DeploymentPlanner} from '../src/engines/deploymentPlanner.js';
const node=(id,x,y)=>({id,floorId:'floor-1',type:'Corridor',x,y,worldX:x,worldY:y,metadata:{}});
const boundary=[{x:-20,y:-20},{x:20,y:-20},{x:20,y:20},{x:-20,y:20}];
for(const gap of [.1,2,7.49,7.5,8]){
  const nodes=[node('j1',0,0),node('j2',gap,0),node('left',-10,0),node('up',0,10),node('right',10+gap,0),node('down',gap,-10)];
  const edges=[['j1','j2'],['j1','left'],['j1','up'],['j2','right'],['j2','down']].map(([source,target],i)=>({id:String(i),source,target,distance:Math.hypot(nodes.find(n=>n.id===source).x-nodes.find(n=>n.id===target).x,nodes.find(n=>n.id===source).y-nodes.find(n=>n.id===target).y)}));
  const graph={nodes,edges},floorGeometry={metersPerPixel:1,floors:[{floorId:'floor-1',boundaries:[boundary],walkableAreas:[boundary]}]};
  for(const placementStrategy of ['landmarks','centerline','topology']){
    const settings={placementStrategy,spacing:7.5,minimumSpacing:7.5,maximumSpacing:10,additionalBeaconBudget:0};
    const result=planBeacons({graph,floorGeometry,configuration:settings,placementRules:settings});
    for(const id of ['j1','j2'])assert.equal(result.beacons.filter(b=>b.nodeId===id&&b.requiredJunction&&Math.hypot(b.worldX-nodes.find(n=>n.id===id).x,b.worldY-nodes.find(n=>n.id===id).y)<1e-7).length,1,`${placementStrategy}, ${gap}: ${id}`);
    const planner=new DeploymentPlanner({graph,floorGeometry,settings});
    planner.generate();
    const checkSpacing=()=>{
      for(const [i,a] of planner.beacons.entries())for(const b of planner.beacons.slice(i+1))if(a.floorId===b.floorId)assert.ok(Math.hypot(a.worldX-b.worldX,a.worldY-b.worldY)>=planner.settings.minimumSpacing-1e-6);
      assert.equal(planner.beacons.filter(b=>['j1','j2'].includes(b.nodeId)).length,gap>=planner.settings.minimumSpacing?2:1);
    };
    checkSpacing();
    const locked=planner.beacons.find(b=>b.nodeId==='j1');locked.locked=true;
    planner.generate();
    checkSpacing();
    assert.equal(planner.beacons.find(b=>b.id===locked.id).locked,true);
    if(gap===2){planner.configure({minimumSpacing:2});planner.generate();checkSpacing();}

  }
}
const old=normalizeProject({objects:[],graph:{nodes:[],edges:[]},planningSettings:{minimumSpacing:5,spacing:7,maximumSpacing:9}});
assert.equal(old.planningSettings.minimumSpacing,7.5);
const customized=normalizeProject({...old,planningSettings:{...old.planningSettings,minimumSpacing:3}});
assert.equal(customized.planningSettings.minimumSpacing,3);
console.log('Automatic spacing enforced below / at / above 7.5 m, including junctions and locked neighbours; panel overrides and saved settings preserved.');
