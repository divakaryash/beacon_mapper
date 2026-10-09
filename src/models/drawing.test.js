import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProject, defaultLayers} from './drawing.js';

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
