import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProject, defaultLayers, makeObject} from './drawing.js';

test('reference uploads open a clear annotated plan without discarding deployment data', () => {
  const graph = {nodes:[{id:'entrance'}],edges:[]};
  const beaconPlan = {beacons:[{id:'IW001'}],geometryValidation:{rejected:0}};
  const original = {floorAnalysis:{method:'aligned-venue-reference'},layers:defaultLayers(),graph,beaconPlan};
  const result = normalizeProject(original);
  for (const id of ['coverage','warnings']) assert.equal(result.layers[id].visible,false);
  for (const id of ['floorPlan','rooms','walls','walkableAreas','restrictedAreas','pois','navigationGraph','beacons']) assert.equal(result.layers[id].visible,true);
  assert.equal(result.graph,graph);
  assert.equal(result.beaconPlan.beacons[0].id,"IW001");
  assert.equal(result.beaconPlan.beacons[0].type,"Navigation");
  assert.equal(result.beaconPlan.geometryValidation,beaconPlan.geometryValidation);
  assert.equal(original.layers.beacons.visible,true);
  const reopened = normalizeProject({...result,layers:{...result.layers,beacons:{visible:false,locked:false}}});
  assert.equal(reopened.layers.beacons.visible,false);
});

test('manual and heuristic projects retain their layer choices', () => {
  const result = normalizeProject({floorAnalysis:{method:'raster'},layers:{rooms:{visible:false,locked:true}}});
  assert.equal(result.layers.rooms.visible,false);
  assert.equal(result.layers.navigationGraph.visible,true);
});

test('legacy live and saved deployments use one type without changing positions or IDs', () => {
  const plan={beacons:[{id:'IW001',type:'Anchor',x:4,y:8},{id:'IW002',type:'Navigation',enabled:false}],statistics:{anchorBeacons:1,navigationBeacons:0,totalBeacons:2}};
  const result=normalizeProject({beaconPlan:plan,deployments:[{id:'v1',plan}]});
  for(const migrated of [result.beaconPlan,result.deployments[0].plan]) {
    assert.ok(migrated.beacons.every(b=>b.type==='Navigation'));
    assert.deepEqual(migrated.beacons.map(b=>b.id),['IW001','IW002']);
    assert.equal(migrated.beacons[0].x,4);
    assert.equal(migrated.statistics.navigationBeacons,1);
    assert.equal('anchorBeacons' in migrated.statistics,false);
  }
  assert.equal(plan.beacons[0].type,'Anchor');
});

test('restoring removes blocked automatic beacons and requests regeneration without moving protected beacons',()=>{
  const points=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
  const result=normalizeProject({widthMeters:10,drawingWidthPixels:10,objects:[
    {type:'buildingBoundary',points},
    {type:'polygon',layerId:'restrictedAreas',geometryRole:'none',points}
  ],beaconPlan:{beacons:[
    {id:'IW001',x:5,y:5,floorId:'floor-1',origin:'automatic'},
    {id:'IW002',x:5,y:5,floorId:'floor-1',origin:'manual'},
    {id:'IW003',x:5,y:5,floorId:'floor-1',origin:'automatic',locked:true}
  ]}});
  assert.deepEqual(result.beaconPlan.beacons.map(b=>b.id),['IW002','IW003']);
  assert.equal(result.autoPlanPending,true);
  assert.equal(result.coverageAnalysis,null);
});


test('connected line edges close as one irregular polygon while open lines remain lines',()=>{
  const points=[{x:0,y:0},{x:10,y:0},{x:10,y:4},{x:4,y:4},{x:4,y:10},{x:0,y:10}];
  const polygon=makeObject('polyline',{points:[...points,{...points[0]}]});
  assert.equal(polygon.type,'polygon');assert.deepEqual(polygon.points,points);
  assert.equal(polygon.layerId,'rooms');
  assert.equal(makeObject('polyline',{points}).type,'polyline');
  assert.equal(makeObject('wall',{points:[...points,points[0]]}).type,'wall');
});


test('old automatic contours update once without altering manual or locked shapes',()=>{
  const points=[{x:0,y:0},{x:10,y:0},{x:10,y:1},{x:9,y:1},{x:9,y:2},{x:8,y:2},{x:8,y:3},{x:7,y:3},{x:7,y:4},{x:6,y:4},{x:6,y:5},{x:0,y:5}];
  const automatic={type:'room',origin:'automatic',points};
  const manual={...automatic,origin:'manual'},locked={...automatic,locked:true};
  const original={widthMeters:10,drawingWidthPixels:10,drawingHeightPixels:10,floorAnalysis:{method:'bounded-raster-topology',resolution:{width:10,height:10}},objects:[automatic,manual,locked],coverageAnalysis:{old:true}};
  const result=normalizeProject(original);
  assert.ok(result.objects[0].points.length<points.length);
  assert.equal(result.objects[1],manual);assert.equal(result.objects[2],locked);
  assert.equal(original.objects[0].points,points);
  assert.equal(result.floorAnalysis.contourVersion,2);
  assert.equal(result.autoPlanPending,true);assert.equal(result.coverageAnalysis,null);
  const reopened=normalizeProject({...result,autoPlanPending:false});
  assert.equal(reopened.objects,result.objects);assert.equal(reopened.autoPlanPending,false);
});

test('automatic corridors stay internal geometry while rooms, facilities and manual annotations remain visible',async()=>{
  const {visibleAnnotation}=await import('./drawing.js');
  assert.equal(visibleAnnotation({origin:'automatic',type:'walkableArea'}),false);
  assert.equal(visibleAnnotation({origin:'reference',type:'walkableArea'}),false);
  assert.equal(visibleAnnotation({origin:'automatic',type:'buildingBoundary'}),false);
  assert.equal(visibleAnnotation({origin:'automatic',category:'Wall'}),false);
  for(const object of [{origin:'automatic',type:'room'},{origin:'automatic',type:'nonWalkableArea',category:'Stairs'},{type:'walkableArea'}])assert.equal(visibleAnnotation(object),true);
});
