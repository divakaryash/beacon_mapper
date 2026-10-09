import test from 'node:test';
import assert from 'node:assert/strict';
import {floorGeojson} from './floorGeojson.js';
const project={name:'Test floor',widthMeters:20,drawingWidthPixels:200,drawingHeightPixels:100,objects:[
  {id:'room-1',type:'room',x:10,y:10,width:20,height:30,floorId:'floor-1'},
  {id:'wall-1',type:'wall',points:[{x:0,y:0},{x:100,y:0}],thicknessMeters:.2,floorId:'floor-1'},
  {id:'restricted',type:'restrictedArea',points:[{x:50,y:50},{x:70,y:50},{x:70,y:70},{x:50,y:70}]}
]};
test('exports closed room, restricted and thick wall polygons in labelled local metre coordinates',()=>{
  const output=floorGeojson(project);
  assert.equal(output.type,'FeatureCollection');assert.match(output.coordinateSystem,/Local metres/);
  assert.equal(output.features.length,3);
  for(const f of output.features){assert.equal(f.type,'Feature');assert.equal(f.geometry.type,'Polygon');assert.deepEqual(f.geometry.coordinates[0][0],f.geometry.coordinates[0].at(-1));assert.equal(f.properties.isWalkable,false);}
  assert.ok(Math.abs(output.features[0].properties.area-6)<1e-9);
  assert.equal(Math.abs(output.features[1].geometry.coordinates[0][0][1]),.1);
});
test('inverts reference alignment and preserves API feature identity and properties after edits',()=>{
  const reference={floor:0,alignment:{origin:[77,28],geoToNormalizedPdf:[[2,0],[0,4],[0,0]]},features:[{id:'source',properties:{type:'Store',outletName:'Shop A'}}]};
  const output=floorGeojson({...project,objects:[{id:'edited',type:'room',x:100,y:40,width:20,height:10,metadata:{sourceId:'source',sourceType:'Store'}}]},reference);
  assert.equal(output.coordinateSystem,'WGS84 longitude/latitude');
  const feature=output.features[0];assert.equal(feature.id,'source');assert.equal(feature.properties.floor,0);assert.equal(feature.properties.outletName,'Shop A');
  assert.ok(feature.geometry.coordinates[0].some(p=>Math.abs(p[0]-77.25)<1e-9&&Math.abs(p[1]-28.1)<1e-9));
});
test('invalid scale and coordinates fail instead of downloading corrupt data',()=>{
  assert.throws(()=>floorGeojson({...project,widthMeters:0}));
  assert.throws(()=>floorGeojson({...project,objects:[{type:'polygon',points:[{x:NaN,y:0},{x:1,y:0},{x:1,y:1}]}]}));
});

test('provided origin overrides saved reference coordinates and uses calibrated dimensions',()=>{
  const output=floorGeojson({...project,geographicOrigin:{latitude:0,longitude:0},heightMeters:10,objects:[{id:'anchor',type:'poi',x:0,y:0},{id:'corner',type:'poi',x:200,y:100}]},{floor:0,alignment:{origin:[77,28],geoToNormalizedPdf:[[2,0],[0,4],[0,0]]}});
  assert.equal(output.coordinateSystem,'WGS84 longitude/latitude');
  assert.deepEqual(output.features[0].geometry.coordinates,[0,0]);
  const [lon,lat]=output.features[1].geometry.coordinates;
  assert.ok(lon>0&&lon<.001);assert.ok(lat<0&&lat>-.001);
});

test('irregular room export preserves every corner instead of its bounding rectangle',()=>{
  const points=[{x:0,y:0},{x:100,y:0},{x:100,y:40},{x:40,y:40},{x:40,y:100},{x:0,y:100}];
  const output=floorGeojson({...project,objects:[{id:'irregular',type:'room',points}]});
  const ring=output.features[0].geometry.coordinates[0];
  assert.equal(ring.length,7);
  for(const p of points)assert.ok(ring.some(([x,y])=>x===p.x*.1&&y===-p.y*.1));
  assert.ok(Math.abs(output.features[0].properties.area-64)<1e-9);
});

test('export carries readable category styles without changing polygon geometry',()=>{
  const output=floorGeojson({...project,objects:[...project.objects,{id:'boundary',type:'buildingBoundary',points:[{x:0,y:0},{x:200,y:0},{x:200,y:100},{x:0,y:100}]},{id:'walkable',type:'walkableArea',points:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]}]});
  const byId=new Map(output.features.map(f=>[f.id,f]));
  assert.equal(byId.get('wall-1').properties['stroke-opacity'],0);
  assert.equal(byId.get('boundary').properties['fill-opacity'],0);
  assert.equal(byId.get('room-1').properties.fill,'#64c3dc');
  assert.equal(byId.get('walkable').properties.fill,'#78e196');
  assert.equal(byId.get('room-1').geometry.coordinates[0].length,5);
});

test('connected polygon holes export as inner rings instead of rectangle fragments',()=>{
  const points=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
  const holes=[[{x:10,y:10},{x:90,y:10},{x:90,y:90},{x:10,y:90}]];
  const output=floorGeojson({...project,objects:[{id:'wall-contour',type:'nonWalkableArea',category:'Wall',points,holes}]});
  assert.equal(output.features.length,1);assert.equal(output.features[0].geometry.coordinates.length,2);
  assert.ok(Math.abs(output.features[0].properties.area-36)<1e-9);
});

test('detected corridor geometry exports as navigation lines instead of filled polygons',()=>{
  const output=floorGeojson({...project,objects:[...project.objects,{id:'internal-corridor',type:'walkableArea',origin:'automatic',points:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]}],graph:{nodes:[{id:'a',floorId:'floor-1',x:0,y:0},{id:'b',floorId:'floor-1',x:100,y:0}],edges:[{id:'path',source:'a',target:'b'}]}});
  assert.ok(!output.features.some(f=>f.id==='internal-corridor'));
  const path=output.features.find(f=>f.id==='path');assert.equal(path.geometry.type,'LineString');assert.equal(path.properties.isWalkable,true);
});
