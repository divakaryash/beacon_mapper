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
