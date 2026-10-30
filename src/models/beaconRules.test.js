import test from 'node:test';
import assert from 'node:assert/strict';
import {beaconLabel,nearbyBeacons,compareAnnotatedBeacons,beaconRuleSummary} from './beaconRules.js';
const b=(id,x,y=0,floorId='G')=>({id,floorId,x,y,worldX:x,worldY:y,reliableRadius:6});
test('numeric labels preserve stable IDs; hover selects nearest in each map direction on this floor',()=>{
  assert.equal(beaconLabel('IW003'),'3');assert.equal(beaconLabel('custom'),'custom');
  const near=nearbyBeacons(b('IW001',0),[b('IW001',0),b('IW002',3),b('IW003',8),b('IW004',-4),b('IW005',0,-2),b('IW006',0,1,'other'),{...b('off',1),enabled:false}]);
  assert.deepEqual(near.map(n=>n.id),['IW002','IW004','IW005']);assert.equal(near[0].meters,3);
});
const reference=()=>({annotationAlignment:{origin:[0,0],widthMeters:100,heightMeters:100,geoToNormalizedPdf:[[1,0],[0,1],[0,0]]},widthMeters:100,heightMeters:100,annotationFloor:'0',annotationData:{features:[{geometry:{type:'Polygon',coordinates:[]},properties:{floor:0,type:'Room'}},...[0,.1].map(x=>({geometry:{type:'Point',coordinates:[x,0]},properties:{floor:0,type:'Beacon'}}))]},graph:{nodes:[{floorId:'G'}]},beaconPlan:{beacons:[b('a',0),b('b',10),b('extra',50)]}});
test('comparison penalizes extra and missing beacons and never reuses a reference match',()=>{
  const p=reference();assert.equal(compareAnnotatedBeacons(p).accuracy,80);
  p.beaconPlan.beacons=[b('a',0),b('b',1)];const result=compareAnnotatedBeacons(p);assert.equal(result.matched,1);assert.equal(result.accuracy,50);
  p.annotationData.features=p.annotationData.features.slice(0,1);assert.throws(()=>compareAnnotatedBeacons(p),/No annotated Beacon/);
});
test('coverage counts respect walls, radius and floors and distinguish sharing from conflicts',()=>{
  const points=[{x:-10,y:-10},{x:30,y:-10},{x:30,y:10},{x:-10,y:10}];
  const project={widthMeters:100,heightMeters:100,drawingWidthPixels:100,drawingHeightPixels:100,objects:[{id:'boundary',type:'buildingBoundary',floorId:'G',points},{id:'walk',type:'walkableArea',floorId:'G',points}],graph:{nodes:[{...b('lift',0),type:'Lift'},{...b('exit',4),type:'Exit'},{...b('end',20),type:'Corridor'}],edges:[]},beaconPlan:{beacons:[b('IW001',0)],warnings:[]}};
  let r=beaconRuleSummary(project);assert.equal(r.landmarksCovered,2);assert.equal(r.waypointsCovered,2);assert.equal(r.conflicts.length,0);
  project.beaconPlan.warnings=[{code:'physical-spacing-too-small',beaconIds:['IW001','other']}];r=beaconRuleSummary(project);assert.equal(r.conflicts.length,1);
});
test('comparison reassigns a nearby match to avoid undercounting valid reference matches',()=>{
  const p=reference();p.annotationData.features[2].geometry.coordinates=[.04,0];
  p.beaconPlan.beacons=[b('a',1),b('b',-2)];assert.equal(compareAnnotatedBeacons(p).matched,2);
});
test('comparison applies the full affine annotation alignment',()=>{
  const p=reference();p.annotationAlignment.geoToNormalizedPdf=[[0,1],[-1,0],[.5,.5]];
  p.beaconPlan.beacons=[b('a',50,50),b('b',50,60)];assert.equal(compareAnnotatedBeacons(p).accuracy,100);
});
test('canvas comparison exposes the exact missing and extra markers behind the score without changing the plan',()=>{
  const p=reference();p.drawingWidthPixels=200;
  p.annotationData.features[1].id='source-a';p.annotationData.features[1].properties.name='Reference A';
  p.annotationData.features.push({id:'other-floor',properties:{floor:1,type:'Beacon'},geometry:{type:'Point',coordinates:[.5,0]}});
  p.beaconPlan.beacons=[b('matched',0),b('extra',50),{...b('disabled',10),enabled:false},b('other-model-floor',10,0,'L2')];
  const before=structuredClone(p),result=compareAnnotatedBeacons(p);
  assert.equal(result.referenceBeacons.length,2);assert.equal(result.modelBeacons.length,2);
  assert.equal(result.missingBeacons.length,1);assert.equal(result.extraBeacons.length,1);
  assert.equal(result.missingBeacons[0].worldX,10);assert.equal(result.missingBeacons[0].x,20);
  assert.equal(result.extraBeacons[0].id,'extra');
  assert.equal(result.referenceBeacons[0].sourceId,'source-a');assert.equal(result.referenceBeacons[0].label,'Reference A');
  assert.equal(result.pairs[0].modelId,'matched');assert.equal(result.pairs[0].distance,0);
  assert.deepEqual(p,before);
});
test('annotated markers remain available before model generation and on a floor with no graph nodes',()=>{
  const p=reference();p.graph.nodes=[];p.beaconPlan=null;
  const result=compareAnnotatedBeacons(p);
  assert.equal(result.referenceBeacons.length,2);assert.equal(result.missingBeacons.length,2);assert.equal(result.extraBeacons.length,0);
  assert.equal(result.referenceBeacons[0].floorId,'floor-1');
});
