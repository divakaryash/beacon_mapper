import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeFloorPlan} from './floorPlanAnalysis.js';
import {compileFloorGeometry,geometryConflict,validGraphIntervals} from './floorGeometry.js';
import {DeploymentPlanner} from './deploymentPlanner.js';

function fixture(){
  const width=64,height=48,data=new Uint8ClampedArray(width*height*4).fill(255);
  function wall(x,y,w,h){for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++){const i=(row*width+col)*4;data[i]=data[i+1]=data[i+2]=0;}}
  wall(5,5,54,2);wall(5,41,54,2);wall(5,5,2,38);wall(57,5,2,38);
  wall(30,7,2,14);wall(30,28,2,13);
  return {data,width,height,drawingWidth:64,drawingHeight:48,metersPerPixel:.5,labels:[{text:'Lift',x:18,y:25}]};
}
test('upload analysis creates editable geometry, routes and IW deployment without crossing walls',()=>{
  const input=fixture(),result=analyzeFloorPlan(input);
  assert.ok(result.objects.some(o=>o.type==='buildingBoundary'));
  assert.ok(result.objects.some(o=>o.type==='walkableArea'));
  assert.ok(result.objects.some(o=>o.type==='poi'&&o.category==='Lift'));
  assert.ok(result.graph.edges.length);
  const floorGeometry={objects:result.objects,metersPerPixel:input.metersPerPixel},floor=compileFloorGeometry(floorGeometry).get('floor-1'),nodes=new Map(result.graph.nodes.map(n=>[n.id,n]));
  assert.equal(geometryConflict({x:31*.5,y:15*.5},floor),'non-walkable-area');
  assert.ok(geometryConflict({x:1,y:1},floor));
  for(const n of nodes.values())assert.equal(geometryConflict({x:n.worldX,y:n.worldY},floor),null);
  for(const e of result.graph.edges){const a=nodes.get(e.source),b=nodes.get(e.target);assert.ok(validGraphIntervals({x:a.worldX,y:a.worldY},{x:b.worldX,y:b.worldY},floor).reduce((sum,[a,b])=>sum+b-a,0)>.99999);}
  const output=new DeploymentPlanner({graph:result.graph,floorGeometry,settings:{cellSize:2,additionalBeaconBudget:4}}).generate();
  assert.ok(output.plan.beacons.length);
  assert.equal(output.plan.beacons[0].id,'IW001');
  assert.equal(new Set(output.plan.beacons.map(b=>b.id)).size,output.plan.beacons.length);
  assert.ok(output.coverage.totalArea>0);
  for(const b of output.plan.beacons)assert.equal(geometryConflict({x:b.worldX,y:b.worldY},floor),null);
});
test('blank and invalid plans fail explicitly, rather than fabricating a deployment',()=>{
  const input=fixture();input.data.fill(255);
  assert.throws(()=>analyzeFloorPlan(input),/No enclosed/);
  assert.throws(()=>analyzeFloorPlan({...input,metersPerPixel:0}),/Invalid/);
});

test('landmarks attach to edges in their own region and exterior marks do not fabricate buildings',()=>{
  const input=fixture();
  input.labels=[{text:'Escalator',x:18,y:25},{text:'Exit',x:47,y:25},{text:'Lift',x:0,y:0}];
  // Exterior legend mark is not a building boundary.
  for(let y=1;y<3;y++)for(let x=1;x<3;x++){const p=(y*input.width+x)*4;input.data[p]=input.data[p+1]=input.data[p+2]=0;}
  const result=analyzeFloorPlan(input);
  assert.equal(result.objects.filter(o=>o.type==='buildingBoundary').length,1);
  assert.deepEqual(result.objects.filter(o=>o.type==='poi').map(o=>o.category),['Escalator','Exit']);
  assert.ok(result.graph.nodes.some(n=>n.type==='Escalator'));
  assert.ok(result.graph.nodes.some(n=>n.type==='Exit'));
});
