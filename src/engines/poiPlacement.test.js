import test from 'node:test';
import assert from 'node:assert/strict';
import {planPoiBeacons} from './poiPlacement.js';
import {compileFloorGeometry,geometryConflict} from './floorGeometry.js';
import {DeploymentPlanner} from './deploymentPlanner.js';
const box=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const objects=[{id:'boundary',type:'buildingBoundary',floorId:'floor-1',points:box(0,0,50,30)},{id:'walkable',type:'walkableArea',floorId:'floor-1',points:box(0,0,50,30)}];
const poi=(id,x,y,category='Store')=>({id,name:id,x,y,worldX:x,worldY:y,floorId:'floor-1',category});
test('nearby POIs share a central beacon and vertical transitions have priority without routes',()=>{
  const pois=[poi('shop',9,10),poi('lift',2,10,'Lift'),poi('stairs',25,10,'Stairs'),poi('escalator',26,10,'Escalator')];
  const planner=new DeploymentPlanner({graph:{nodes:[],edges:[]},floorGeometry:{objects,metersPerPixel:1},pois,settings:{placementStrategy:'pois',spacing:9,minimumSpacing:8,maximumSpacing:10,cellSize:1,additionalBeaconBudget:0}});
  const result=planner.generate();assert.equal(result.plan.beacons.length,2);assert.equal(result.plan.poiSummary.served,4);assert.equal(result.plan.poiSummary.sharedBeacons,2);
  for(const b of result.plan.beacons){assert.equal(b.placementStrategy,'Floor-change lobby');assert.equal(geometryConflict({x:b.worldX,y:b.worldY},planner.floors.get('floor-1')),null);}
  assert.deepEqual(planner.graph.edges,[]);assert.ok(!result.plan.warnings.some(w=>w.code==='invalid-graph-reference'));
});
test('wall-separated POIs do not share a beacon and exactly 10 m stays separate',()=>{
  const wall={id:'wall',type:'nonWalkableArea',floorId:'floor-1',points:box(9,0,2,30)};
  const floors=compileFloorGeometry({objects:[...objects,wall],metersPerPixel:1});
  const result=planPoiBeacons({pois:[poi('a',7,10),poi('b',13,10)],floors,metersPerPixel:1});assert.equal(result.beacons.length,2);
  assert.equal(planPoiBeacons({pois:[poi('a',20,10),poi('b',30,10)],floors,metersPerPixel:1}).beacons.length,2);
});
test('sharing never chains together POIs further than 10 m apart',()=>{
  const result=planPoiBeacons({pois:[poi('a',2,10),poi('b',11,10),poi('c',20,10)],floors:compileFloorGeometry({objects,metersPerPixel:1}),metersPerPixel:1});
  assert.equal(result.beacons.length,2);
  assert.ok(result.beacons.every(b=>b.poiIds.length<=2));
});
