import test from 'node:test';
import assert from 'node:assert/strict';
import {beaconAnnotationExport} from './beaconAnnotationExport.js';
const room={id:'room',type:'Feature',building_ID:'building',properties:{level:0,type:'Room'},geometry:{type:'Polygon',coordinates:[[[10,20],[11,20],[11,19],[10,20]]],coordinnatesLocal:[[[100,100],[200,100],[200,200],[100,100]]]}};
const route={id:'route',type:'Feature',properties:{level:0,lineCategory:'waypoint'},geometry:{type:'LineString',coordinates:[[10,20],[11,19]]}};
const old={id:'old',properties:{level:0,type:'Beacon'}},other={id:'other-floor',properties:{level:1,type:'Beacon'}};
const project=payload=>({name:'Map',annotationData:payload,annotationFloor:'0',annotationAlignment:{origin:[10,20],geoToNormalizedPdf:[[1,0],[0,-1],[0,0]]},widthMeters:100,heightMeters:100,drawingWidthPixels:100,drawingHeightPixels:100,beaconPlan:{beacons:[{id:'IW001',x:25,y:50,enabled:true}]}});
test('preserves the complete input and adds DLF-style Beacon points without mutating the upload',()=>{
  const payload={mappingElements:[room,route,old,other],masterGraph:{a:['b']},custom:'keep'};
  const original=structuredClone(payload),p=project(payload),out=beaconAnnotationExport(p);
  assert.deepEqual(payload,original);
  assert.deepEqual(out.masterGraph,payload.masterGraph);
  assert.equal(out.custom,'keep');
  assert.deepEqual(out.mappingElements.slice(0,3),[room,route,other]);
  const b=out.mappingElements.at(-1);
  assert.equal(b.properties.type,'Beacon');assert.equal(b.properties.name,'IW001');assert.equal(b.building_ID,'building');
  assert.deepEqual(b.geometry,{type:'Point',coordinates:[10.25,19.5],coordinnatesLocal:[125,150]});
  assert.deepEqual(beaconAnnotationExport({...p,annotationData:out}),out);
});
test('retains array and FeatureCollection wrappers and includes separate uploaded waypoints',()=>{
  for(const payload of [[room],{type:'FeatureCollection',features:[room]}]){
    const out=beaconAnnotationExport({...project(payload),waypointData:[route]});
    const fs=Array.isArray(out)?out:out.features;
    assert.deepEqual(fs.slice(0,2),[room,route]);assert.equal(fs.at(-1).properties.type,'Beacon');
  }
  assert.throws(()=>beaconAnnotationExport({...project([room]),annotationAlignment:null}),/Import annotated JSON/);
});
