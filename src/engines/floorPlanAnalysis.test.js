import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeFloorPlan,maskContours} from './floorPlanAnalysis.js';
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

test('concave region contours preserve shape and split pinched contacts into valid polygons',()=>{
  const width=8,height=8,mask=new Uint8Array(width*height);
  for(let y=1;y<7;y++)for(let x=1;x<7;x++)if(x<3||y>4)mask[y*width+x]=1;
  const contours=maskContours(mask,width,height),outer=contours.filter(c=>!c.hole);
  assert.equal(outer.length,1);assert.ok(outer[0].points.length>4);
  const objects=[{type:'buildingBoundary',points:[{x:0,y:0},{x:8,y:0},{x:8,y:8},{x:0,y:8}]},{type:'walkableArea',points:outer[0].points}];
  const floor=compileFloorGeometry({objects,metersPerPixel:1}).get('floor-1');
  assert.equal(geometryConflict({x:5,y:2},floor),'non-walkable-area');assert.equal(geometryConflict({x:2,y:5},floor),null);
  const pinched=new Uint8Array(64);for(const [x,y] of [[2,2],[3,3],[4,3],[4,2],[4,1],[3,1],[2,1]])pinched[y*8+x]=1;
  for(const c of maskContours(pinched,8,8))assert.doesNotThrow(()=>compileFloorGeometry({objects:[{type:'buildingBoundary',points:c.points}],metersPerPixel:1}));
});

test('closed rooms receive actual polygons and are excluded from automatically generated routes',()=>{
  const input=fixture();
  for(let y=10;y<=20;y++)for(let x=10;x<=20;x++)if(x===10||x===20||y===10||y===20){const p=(y*input.width+x)*4;input.data[p]=input.data[p+1]=input.data[p+2]=0;}
  const result=analyzeFloorPlan(input),room=result.objects.find(o=>o.type==='room');assert.ok(room);
  const floor=compileFloorGeometry({objects:result.objects,metersPerPixel:.5}).get('floor-1');
  assert.equal(geometryConflict({x:7,y:7},floor),'non-walkable-area');
  for(const n of result.graph.nodes)assert.equal(geometryConflict({x:n.worldX,y:n.worldY},floor),null);
});

test('PDF page frames cannot become building boundaries or outdoor navigation areas',()=>{
  const width=80,height=80,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(((x===1||x===78)&&y>=1&&y<=78)||((y===1||y===78)&&x>=1&&x<=78)||((x===10||x===65)&&y>=12&&y<=67)||((y===12||y===67)&&x>=10&&x<=65)){const p=(y*width+x)*4;data[p]=data[p+1]=data[p+2]=0;}
  const result=analyzeFloorPlan({data,width,height,metersPerPixel:1,excludeDrawingFrame:true});
  const floor=compileFloorGeometry({objects:result.objects,metersPerPixel:1}).get('floor-1');
  assert.equal(result.analysis.detected.boundaries,1);
  assert.equal(geometryConflict({x:4,y:40},floor),'outside-building');
  for(const n of result.graph.nodes)assert.equal(geometryConflict({x:n.worldX,y:n.worldY},floor),null);
});

test('automatic walls are connected contour polygons with holes rather than row rectangles',()=>{
  const result=analyzeFloorPlan(fixture());
  const walls=result.objects.filter(o=>o.category==='Wall');
  assert.ok(walls.length>0);
  assert.ok(walls.every(w=>Array.isArray(w.holes)));
  assert.ok(walls.some(w=>w.holes.length>0||w.points.length>4));
});

test('word-like text inside the building does not create wall polygons while solid columns remain',()=>{
  const width=320,height=240,data=new Uint8ClampedArray(width*height*4).fill(255);
  const ink=(x,y)=>{const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0;};
  for(let y=10;y<230;y++)for(let x=10;x<310;x++)if(x===10||x===309||y===10||y===229)ink(x,y);
  for(let y=80;y<86;y++)for(let x=80;x<86;x++)ink(x,y);
  const input={data,width,height,metersPerPixel:1};
  const before=analyzeFloorPlan(input);
  for(const start of [120,132,144])for(let y=100;y<112;y++)for(let x=start;x<start+8;x++)if(x===start||x===start+7||y===100||y===111)ink(x,y);
  const after=analyzeFloorPlan(input);
  assert.deepEqual(after.objects,before.objects);
  const floor=compileFloorGeometry({objects:after.objects,metersPerPixel:1}).get('floor-1');
  assert.equal(geometryConflict({x:82,y:82},floor),'non-walkable-area');
});


test('an internal X is one enclosing room while a real divider remains separate rooms',()=>{
  const width=100,height=100;
  const draw=(cross)=>{
    const data=new Uint8ClampedArray(width*height*4).fill(255);
    const ink=(x,y)=>{const p=(y*width+x)*4;data[p]=data[p+1]=data[p+2]=0;};
    for(let y=5;y<=94;y++)for(let x=5;x<=94;x++)if(x===5||x===94||y===5||y===94)ink(x,y);
    for(let y=20;y<=60;y++)for(let x=20;x<=60;x++)if(x===20||x===60||y===20||y===60||(cross?(x===y||x+y===80):x===40))ink(x,y);
    return analyzeFloorPlan({data,width,height,metersPerPixel:1});
  };
  const crossed=draw(true),divided=draw(false);
  assert.equal(crossed.objects.filter(o=>o.type==='room').length,1);
  assert.equal(divided.objects.filter(o=>o.type==='room').length,2);
  const floor=compileFloorGeometry({objects:crossed.objects,metersPerPixel:1}).get('floor-1');
  assert.equal(geometryConflict({x:40,y:40},floor),'non-walkable-area');
  assert.ok(!crossed.objects.some(o=>o.category==='Wall'&&o.holes?.length===4));
});

test('readable printed labels name their enclosing room without changing its geometry',()=>{
  const input=fixture();
  for(let y=10;y<=20;y++)for(let x=10;x<=20;x++)if(x===10||x===20||y===10||y===20){const p=(y*input.width+x)*4;input.data[p]=input.data[p+1]=input.data[p+2]=0;}
  const before=analyzeFloorPlan({...input,labels:[]});
  const after=analyzeFloorPlan({...input,labels:[{text:'Shop 101',x:12,y:14},{text:'Zara',x:12,y:17}]});
  const room=after.objects.find(o=>o.type==='room');
  assert.equal(room.name,'Shop 101 Zara');
  assert.deepEqual(room.points,before.objects.find(o=>o.type==='room').points);
});

test('a labeled stair assembly produces one block and its lobby point stays outside the treads',()=>{
  const width=120,height=100,data=new Uint8ClampedArray(width*height*4).fill(255);
  const ink=(x,y)=>{const p=(y*width+x)*4;data[p]=data[p+1]=data[p+2]=0;};
  for(let y=5;y<95;y++)for(const x of [5,114])ink(x,y);
  for(let x=5;x<=114;x++)for(const y of [5,94])ink(x,y);
  for(let y=20;y<=38;y+=3)for(let x=20;x<40;x++)ink(x,y);
  const result=analyzeFloorPlan({data,width,height,metersPerPixel:.1,labels:[{text:'STAIRS',x:20,y:48,width:20,height:5}]});
  const blocks=result.objects.filter(o=>o.metadata?.groupedAssembly&&o.type==='nonWalkableArea');assert.equal(blocks.length,1);
  const poi=result.objects.find(o=>o.type==='poi'&&o.category==='Stairs');assert.ok(poi);
  const floor=compileFloorGeometry({objects:result.objects,metersPerPixel:.1}).get('floor-1');
  assert.equal(geometryConflict({x:poi.x*.1,y:poi.y*.1},floor),null);
  assert.ok(Math.hypot(poi.x-30,poi.y-29)*.1<=6);
});
