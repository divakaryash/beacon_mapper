import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFloorPlanSetup,localToGeographic} from './floorPlanSetup.js';
const values={latitude:'28.567',longitude:'77.32',widthMeters:'200',heightMeters:'300'};
test('requires location and positive dimensions before upload, including valid zero coordinates',()=>{
  assert.deepEqual(validateFloorPlanSetup({...values,latitude:'0',longitude:'0'}),{latitude:0,longitude:0,widthMeters:200,heightMeters:300});
  for(const patch of [{latitude:''},{longitude:''},{widthMeters:''},{heightMeters:0},{widthMeters:-1},{latitude:90},{longitude:181},{widthMeters:Infinity}])assert.throws(()=>validateFloorPlanSetup({...values,...patch}));
});
test('top-left anchor stays fixed and east/south floor offsets move longitude/latitude correctly',()=>{
  const origin={latitude:28.567,longitude:77.32};
  const anchor=localToGeographic({x:0,y:0},origin),corner=localToGeographic({x:200,y:-300},origin);
  assert.ok(Math.abs(anchor[0]-origin.longitude)<1e-10);assert.equal(anchor[1],origin.latitude);
  assert.ok(corner[0]>origin.longitude);assert.ok(corner[1]<origin.latitude);
  const wrapped=localToGeographic({x:200,y:0},{latitude:0,longitude:179.999});assert.ok(wrapped[0]<0&&wrapped[0]>=-180);
});
