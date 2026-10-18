import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFloorGeometry,geometryConflict,beaconGeometryConflict,validGraphIntervals} from './floorGeometry.js';
import {DeploymentPlanner} from './deploymentPlanner.js';
import {normalizeProject} from '../models/drawing.js';
import {floorGeojson} from '../models/floorGeojson.js';

const box=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const objects=[{id:'boundary',type:'buildingBoundary',points:box(0,0,20,20)},{id:'floor',type:'walkableArea',points:box(0,0,20,20)},{id:'void',type:'voidArea',layerId:'voidAreas',points:box(8,8,4,4)},{id:'restricted',type:'restrictedArea',points:box(14,8,4,4)},{id:'blocked',type:'nonWalkableArea',points:box(2,8,4,4)}];
const graph={nodes:[{id:'a',floorId:'floor-1',type:'Corridor',x:1,y:2,worldX:1,worldY:2},{id:'b',floorId:'floor-1',type:'Corridor',x:19,y:2,worldX:19,worldY:2}],edges:[{id:'ab',source:'a',target:'b',distance:18,direction:'both',edgeType:'Walkway'}]};
const floorGeometry={objects,metersPerPixel:1};

test('void mounting permission never opens restricted areas, obstacles or walking routes',()=>{
  for(const allowed of [false,true]){
    const floor=compileFloorGeometry({...floorGeometry,allowVoidBeacons:allowed}).get('floor-1');
    assert.equal(floor.voidAreas.length,1);assert.equal(floor.restrictedAreas.length,1);
    assert.equal(beaconGeometryConflict({x:10,y:10},floor),allowed?null:'non-walkable-area');
    assert.equal(geometryConflict({x:10,y:10},floor),'non-walkable-area');
    assert.equal(beaconGeometryConflict({x:16,y:10},floor),'restricted-area');
    assert.equal(beaconGeometryConflict({x:4,y:10},floor),'non-walkable-area');
    assert.equal(beaconGeometryConflict({x:-1,y:10},floor),'outside-building');
    assert.ok(validGraphIntervals({x:7,y:10},{x:13,y:10},floor).reduce((sum,[lo,hi])=>sum+hi-lo,0)<1);
    const overlapping=compileFloorGeometry({objects:[...objects,{id:'overlap',type:'restrictedArea',points:box(9,9,1,1)}],metersPerPixel:1,allowVoidBeacons:allowed}).get('floor-1');
    assert.equal(beaconGeometryConflict({x:9.5,y:9.5},overlapping),'restricted-area');
    const tagged=compileFloorGeometry({objects:[objects[0],objects[1],{id:'tagged',type:'polygon',geometryRole:'restrictedArea',category:'Void',points:box(8,8,4,4)}],metersPerPixel:1,allowVoidBeacons:allowed}).get('floor-1');
    assert.equal(beaconGeometryConflict({x:10,y:10},tagged),'restricted-area');
  }
});

test('manual void insert, live permission toggling, coverage and reload keep the same policy',()=>{
  const planner=new DeploymentPlanner({graph,floorGeometry,settings:{additionalBeaconBudget:0,allowVoidBeacons:true}});
  const result=planner.edit('insert',{floorId:'floor-1',x:10,y:10,worldX:10,worldY:10});
  const beacon=result.plan.beacons[0];assert.equal(beacon.worldX,10);assert.equal(beacon.worldY,10);
  assert.ok(!result.plan.warnings.some(w=>w.code==='invalid-coverage-beacon'));assert.ok(result.coverage.coveredArea>0);
  assert.equal(result.coverage.totalArea,352);
  const disabled=planner.configure({allowVoidBeacons:false});assert.ok(disabled.coverage.warnings.some(w=>w.code==='invalid-coverage-beacon'));
  const enabled=planner.configure({allowVoidBeacons:true});assert.ok(!enabled.coverage.warnings.some(w=>w.code==='invalid-coverage-beacon'));
  const project={objects,graph,widthMeters:20,heightMeters:20,drawingWidthPixels:20,drawingHeightPixels:20,planningSettings:enabled.settings,beaconPlan:enabled.plan};
  assert.equal(normalizeProject(project).beaconPlan.beacons[0].worldX,10);
  const exported=floorGeojson(project);assert.equal(exported.features.find(f=>f.id==='void').properties.type,'Void');assert.equal(exported.features.find(f=>f.id==='restricted').properties.type,'Restricted Area');
  planner.edit('insert',{floorId:'floor-1',x:16,y:10,worldX:16,worldY:10});
  assert.ok(planner.beacons.every(b=>geometryConflict({x:b.worldX,y:b.worldY},planner.floors.get('floor-1'))!=='restricted-area'));
  assert.throws(()=>planner.configure({allowVoidBeacons:'yes'}),/Void placement/);
});

test('legacy void shapes move out of the restricted layer on restore',()=>{
  const project=normalizeProject({objects:[{id:'old-void',type:'nonWalkableArea',category:'Void',layerId:'restrictedAreas',points:box(8,8,4,4)}],graph:{nodes:[],edges:[]}});
  assert.equal(project.objects[0].type,'voidArea');assert.equal(project.objects[0].layerId,'voidAreas');
});
