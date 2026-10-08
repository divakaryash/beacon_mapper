import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProject, defaultLayers} from './drawing.js';

test('reference uploads open a clear annotated plan without discarding deployment data', () => {
  const graph = {nodes:[{id:'entrance'}],edges:[]};
  const beaconPlan = {beacons:[{id:'IW001'}],geometryValidation:{rejected:0}};
  const original = {floorAnalysis:{method:'aligned-venue-reference'},layers:defaultLayers(),graph,beaconPlan};
  const result = normalizeProject(original);
  for (const id of ['coverage','warnings','walkableAreas']) assert.equal(result.layers[id].visible,false);
  for (const id of ['floorPlan','rooms','walls','restrictedAreas','pois','navigationGraph','beacons']) assert.equal(result.layers[id].visible,true);
  assert.equal(result.graph,graph);
  assert.equal(result.beaconPlan,beaconPlan);
  assert.equal(original.layers.beacons.visible,true);
  const reopened = normalizeProject({...result,layers:{...result.layers,beacons:{visible:false,locked:false}}});
  assert.equal(reopened.layers.beacons.visible,false);
});

test('manual and heuristic projects retain their layer choices', () => {
  const result = normalizeProject({floorAnalysis:{method:'raster'},layers:{rooms:{visible:false,locked:true}}});
  assert.equal(result.layers.rooms.visible,false);
  assert.equal(result.layers.navigationGraph.visible,true);
});
