import assert from 'node:assert/strict';
import {planBeacons} from '../src/engines/beaconPlacement.js';
import {DeploymentPlanner} from '../src/engines/deploymentPlanner.js';
const node=(id,x,y)=>({id,floorId:'floor-1',type:'Corridor',x,y,worldX:x,worldY:y,metadata:{}});
const boundary=[{x:-20,y:-20},{x:20,y:-20},{x:20,y:20},{x:-20,y:20}];
for(const gap of [.1,2]){
  const nodes=[node('j1',0,0),node('j2',gap,0),node('left',-10,0),node('up',0,10),node('right',10+gap,0),node('down',gap,-10)];
  const edges=[['j1','j2'],['j1','left'],['j1','up'],['j2','right'],['j2','down']].map(([source,target],i)=>({id:String(i),source,target,distance:Math.hypot(nodes.find(n=>n.id===source).x-nodes.find(n=>n.id===target).x,nodes.find(n=>n.id===source).y-nodes.find(n=>n.id===target).y)}));
  const graph={nodes,edges},floorGeometry={metersPerPixel:1,floors:[{floorId:'floor-1',boundaries:[boundary],walkableAreas:[boundary]}]};
  for(const placementStrategy of ['landmarks','centerline','topology']){
    const settings={placementStrategy,spacing:7,minimumSpacing:5,maximumSpacing:9,additionalBeaconBudget:0};
    const result=planBeacons({graph,floorGeometry,configuration:settings,placementRules:settings});
    for(const id of ['j1','j2'])assert.equal(result.beacons.filter(b=>b.nodeId===id&&b.requiredJunction&&Math.hypot(b.worldX-nodes.find(n=>n.id===id).x,b.worldY-nodes.find(n=>n.id===id).y)<1e-7).length,1,`${placementStrategy}, ${gap}: ${id}`);
    const planner=new DeploymentPlanner({graph,floorGeometry,settings});
    planner.generate();
    for(const id of ['j1','j2'])assert.ok(planner.beacons.some(b=>b.nodeId===id),`planner: ${id}`);
    const locked=planner.beacons.find(b=>b.nodeId==='j1');locked.locked=true;
    planner.generate();
    for(const id of ['j1','j2'])assert.equal(planner.beacons.filter(b=>b.nodeId===id).length,1,`locked neighbour: ${id}`);
  }
}
console.log('Close three-way junctions retain separate beacons across all route strategies, including beside locked beacons.');
