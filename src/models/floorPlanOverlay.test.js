import test from 'node:test';
import assert from 'node:assert/strict';
import {createFloorPlanOverlay,overlayPoint,overlayTransform,snapFloorPlanOverlay,createManualAnnotationProject} from './floorPlanOverlay.js';
import {localToGeographic} from './floorPlanSetup.js';
import {normalizeProject,defaultLayers} from './drawing.js';
import {floorGeojson} from './floorGeojson.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} should equal ${b}`);
const coordinate=([x,y])=>localToGeographic({x,y:-y},{latitude:28,longitude:77});
const payload={features:[{id:'boundary',properties:{type:'Boundary',floor:0},geometry:{type:'Polygon',coordinates:[[[0,0],[80,0],[80,50],[0,50],[0,0]].map(coordinate)]}},{id:'room',properties:{type:'Store',name:'Room 1',floor:0},geometry:{type:'Polygon',coordinates:[[[5,5],[20,5],[20,20],[5,20],[5,5]].map(coordinate)]}},{id:'lift',properties:{type:'Lift',floor:0},geometry:{type:'Point',coordinates:coordinate([40,25])}}]};
const imported={file:new File(['<svg/>'],'floor.svg',{type:'image/svg+xml'}),drawingWidthPixels:800,drawingHeightPixels:1000};

test('overlay preserves aspect ratio, rotates and flips around its center',()=>{
  const overlay=createFloorPlanOverlay(800,1000,1200,750);
  near(overlay.scale,.75);assert.deepEqual(overlayPoint(overlay,{x:400,y:500}),{x:600,y:375});
  const turned={...overlay,rotation:90,flipX:true};
  const p=overlayPoint(turned,{x:800,y:500});near(p.x,600);near(p.y,75);
  assert.match(overlayTransform(turned),/rotate\(90\) scale\(-0.75 0.75\)/);
  for(const width of [0,NaN,-1,Infinity])assert.throws(()=>createFloorPlanOverlay(width,1000,1200,750));
});

test('snapping applies only a translation and respects screen-space tolerance and the off switch',()=>{
  const overlay={...createFloorPlanOverlay(100,100,200,200),rotation:27,flipY:true};
  const corner=overlayPoint(overlay,{x:0,y:0}),target={x:corner.x+3,y:corner.y+4};
  const snapped=snapFloorPlanOverlay(overlay,[target],6);
  near(snapped.x,overlay.x+3);near(snapped.y,overlay.y+4);near(snapped.scale,overlay.scale);near(snapped.rotation,27);
  assert.equal(snapFloorPlanOverlay(overlay,[target],4),overlay);
  const off={...overlay,snap:false};assert.equal(snapFloorPlanOverlay(off,[target],6),off);
});

test('import and reload never generate beacons; replacing the image keeps GeoJSON geometry and scale fixed',()=>{
  const first=normalizeProject({...createManualAnnotationProject(imported,payload,0),layers:defaultLayers()});
  const second=normalizeProject({...createManualAnnotationProject({...imported,drawingWidthPixels:1800,drawingHeightPixels:900},payload,0),layers:defaultLayers()});
  assert.equal(first.autoPlanPending,false);assert.equal(first.beaconPlan,null);assert.equal(normalizeProject(first).autoPlanPending,false);
  assert.deepEqual(first.objects,second.objects);assert.deepEqual(first.graph,second.graph);near(first.widthMeters,second.widthMeters);near(first.drawingHeightPixels,second.drawingHeightPixels);
  assert.notEqual(first.floorPlanOverlay.scale,second.floorPlanOverlay.scale);
  assert.equal(first.annotationData,payload);
  const moved={...first,floorPlanOverlay:{...first.floorPlanOverlay,x:900,y:-50,scale:3,rotation:143,flipX:true,opacity:.2}};
  assert.deepEqual(floorGeojson(moved),floorGeojson(first));
  assert.deepEqual(normalizeProject(moved).floorPlanOverlay,moved.floorPlanOverlay);
});

test('GeoJSON voids import and export separately from restricted areas',()=>{
  const area=(id,type,x)=>({id,properties:{type,floor:0},geometry:{type:'Polygon',coordinates:[[[x,30],[x+5,30],[x+5,35],[x,35],[x,30]].map(coordinate)]}});
  const importedProject=normalizeProject({...createManualAnnotationProject(imported,{features:[...payload.features,area('void','Void',25),area('restricted','Restricted Area',40)]},0),layers:defaultLayers()});
  assert.equal(importedProject.objects.find(o=>o.metadata?.sourceId==='void').layerId,'voidAreas');
  assert.equal(importedProject.objects.find(o=>o.metadata?.sourceId==='restricted').layerId,'restrictedAreas');
  const exported=floorGeojson(importedProject);
  assert.equal(exported.features.find(f=>f.id==='void').properties.type,'Void');
  assert.equal(exported.features.find(f=>f.id==='restricted').properties.type,'Restricted Area');
  assert.equal(importedProject.autoPlanPending,false);
});

test('combined floor data imports without an image and selects only the requested floor',()=>{
  const line=floor=>({id:`route-${floor}`,properties:{lineCategory:'waypoint',level:floor},geometry:{type:'LineString',coordinates:[[25,25],[55,25]].map(coordinate)}});
  const combined={type:'FeatureCollection',features:[...payload.features,line(0),...payload.features.map(f=>({...f,id:`upper-${f.id}`,properties:{...f.properties,floor:1}})),line(1)]};
  const ground=normalizeProject(createManualAnnotationProject({},combined,0));
  const upper=normalizeProject(createManualAnnotationProject({},combined,1));
  assert.equal(ground.floorPlanOverlay,null);
  assert.equal(ground.name,'Floor 0');
  assert.equal(ground.annotationFloor,'0');
  assert.equal(upper.annotationFloor,'1');
  assert.equal(ground.floorAnalysis.routeSource,'geojson');
  assert.equal(upper.floorAnalysis.routeSource,'geojson');
  assert.ok(ground.graph.edges.length>0);
  assert.ok(upper.graph.edges.length>0);
  assert.ok(ground.objects.some(o=>o.metadata?.sourceId==='room'));
  assert.ok(!ground.objects.some(o=>o.metadata?.sourceId==='upper-room'));
  assert.ok(upper.objects.some(o=>o.metadata?.sourceId==='upper-room'));
  assert.equal(ground.annotationData,combined);
});
