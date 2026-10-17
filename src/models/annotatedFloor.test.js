import test from 'node:test';
import assert from 'node:assert/strict';
import {annotationFloors,annotatedReference} from './annotatedFloor.js';
import {localToGeographic} from './floorPlanSetup.js';
import {analyzeVenueReference} from '../engines/venueReference.js';
const setup={latitude:28,longitude:77,widthMeters:20,heightMeters:20};
const coordinate=(x,y)=>localToGeographic({x,y:-y},setup);
const payload={data:[{id:'area',type:'Feature',properties:{floor:1,type:'Walkable Area',isWalkable:true},geometry:{type:'Polygon',coordinates:[[[0,0],[20,0],[20,20],[0,20],[0,0]].map(([x,y])=>coordinate(x,y))]}},{id:'entry',type:'Feature',properties:{floor:1,type:'Main Entry'},geometry:{type:'Point',coordinates:coordinate(10,10)}},{id:'centroid',properties:{floor:1,type:'Centroid'},geometry:{type:'Point',coordinates:coordinate(10,10)}}]};
test('polygon-only API annotations preserve overlays without inventing routes',()=>{
  assert.deepEqual(annotationFloors(payload).floors,['1']);
  const reference=annotatedReference(payload,'1',setup);
  assert.equal(reference.features.length,2);
  assert.match(reference.alignment.boundarySource,/Inferred/);
  const result=analyzeVenueReference(reference,{drawingWidth:200,drawingHeight:200});
  assert.equal(result.graph.edges.length,0);
  assert.equal(result.widthMeters,20);
});
test('invalid annotation inputs and mismatched map anchors are rejected',()=>{
  assert.throws(()=>annotationFloors({data:[]}),/Provide/);
  assert.throws(()=>annotatedReference(payload,2,setup),/no annotated/);
  assert.throws(()=>annotatedReference(payload,1,{...setup,longitude:76}),/outside the map/);
  const bad=structuredClone(payload);bad.data[0].geometry.coordinates[0][0]=[NaN,28];
  assert.throws(()=>annotatedReference(bad,1,setup),/invalid geographic/);
});

test('uploaded paths split at intersections and keep one exact junction beacon with 8–10 m spacing',async()=>{
  const {DeploymentPlanner}=await import('../engines/deploymentPlanner.js');
  const {BEACON_PROFILES}=await import('../engines/beaconPlacement.js');
  const values={...setup,widthMeters:40,heightMeters:40};
  const polygon=(id,type,points,extra={})=>({id,properties:{floor:1,type,...extra},geometry:{type:'Polygon',coordinates:[points.map(([x,y])=>coordinate(x,y))]}});
  const line=(id,points)=>({id,properties:{floor:1,type:'Navigation Path'},geometry:{type:'LineString',coordinates:points.map(([x,y])=>coordinate(x,y))}});
  const data={features:[polygon('area','Walkable Area',[[0,0],[40,0],[40,40],[0,40],[0,0]],{isWalkable:true,fillColor:'#abcdef'}),polygon('shop','Store',[[1,1],[3,1],[3,3],[1,3],[1,1]],{fillColor:'#a4d3df'}),line('horizontal',[[2,20],[38,20]]),line('vertical',[[20,2],[20,38]])]};
  const result=analyzeVenueReference(annotatedReference(data,1,values),{drawingWidth:400,drawingHeight:400});
  assert.equal(result.objects.find(o=>o.metadata?.sourceId==='shop').fillColor,'#a4d3df');
  assert.equal(result.objects.find(o=>o.metadata?.sourceId==='area').metadata.uploadedAnnotation,true);
  const junctions=result.graph.nodes.filter(n=>n.type==='Junction');
  assert.equal(junctions.length,1);
  const planner=new DeploymentPlanner({graph:result.graph,floorGeometry:{objects:result.objects,metersPerPixel:.1},profiles:BEACON_PROFILES,settings:{spacing:9,minimumSpacing:8,maximumSpacing:10,placementStrategy:'centerline',cellSize:1,additionalBeaconBudget:0}});
  planner.generate();
  const beacons=planner.output.plan.beacons,junction=junctions[0];
  assert.equal(beacons.filter(b=>Math.hypot(b.worldX-junction.worldX,b.worldY-junction.worldY)<1e-6).length,1);
  assert.equal(beacons.length,9);
  assert.ok(planner.output.plan.statistics.minimumSpacing>=8-1e-6);
  assert.ok(planner.output.plan.statistics.maximumSpacing<=10+1e-6);
  assert.ok(!planner.output.plan.warnings.some(w=>['spacing-too-small','spacing-too-large'].includes(w.code)));
});

test('location and dimensions derive from selected floor coordinates, ignoring stale local data',async()=>{
  const {annotationSetup}=await import('./annotatedFloor.js');
  const {visibleAnnotation}=await import('./drawing.js');
  const data=structuredClone(payload);
  data.data[0].properties.fillColor='#a4d3df';
  data.data[0].geometry.coordinnatesLocal=[[[999999,999999]]];
  data.data.push({id:'other-floor',properties:{floor:2,type:'Store'},geometry:{type:'Polygon',coordinates:[[[1,1],[2,1],[2,2],[1,1]]]}});
  const setupFromData=annotationSetup(data,1);
  assert.ok(Math.abs(setupFromData.latitude-28)<1e-9);
  assert.ok(Math.abs(setupFromData.longitude-77)<1e-9);
  assert.ok(Math.abs(setupFromData.widthMeters-20)<1e-6);
  assert.ok(Math.abs(setupFromData.heightMeters-20)<1e-6);
  const result=analyzeVenueReference(annotatedReference(data,1,setupFromData),{drawingWidth:200,drawingHeight:200});
  const area=result.objects.find(o=>o.metadata?.sourceId==='area');
  assert.equal(area.fillColor,'#a4d3df');
  assert.equal(visibleAnnotation(area),true);
  assert.ok(annotationSetup(data,2).longitude<2);
  const invalid=structuredClone(data);invalid.data[0].geometry.coordinates[0][0]=[Infinity,28];
  assert.throws(()=>annotationSetup(invalid,1),/invalid geographic/);
});

test('duplicate API IDs and a self-crossing wall preserve annotations without inventing courtyard routes',async()=>{
  const {annotationSetup}=await import('./annotatedFloor.js');
  const data=structuredClone(payload);
  const wall={id:'wall',properties:{floor:1,type:'Wall',fillColor:'#aa3344'},geometry:{type:'Polygon',coordinates:[[[2,2],[18,2],[18,18],[2,18],[2,2]].map(([x,y])=>coordinate(x,y)),[[4,4],[4,16],[16,16],[16,4],[4,4]].map(([x,y])=>coordinate(x,y))]}};
  data.data.push(wall,{...wall,geometry:{type:'Polygon',coordinates:[[[0,0],[1,1],[0,1],[1,0],[0,0]].map(([x,y])=>coordinate(x,y))]}});
  const reference=annotatedReference(data,1,annotationSetup(data,1));
  assert.equal(new Set(reference.features.map(f=>f.id)).size,reference.features.length);
  const result=analyzeVenueReference(reference,{drawingWidth:200,drawingHeight:200});
  assert.ok(result.objects.some(o=>o.holes?.length));
  assert.equal(result.graph.edges.length,0);
});

test('supplied multiline routes create one T-junction without invented POI links or gap bridges',async()=>{
  const data=structuredClone(payload);
  data.data[0].geometry.coordinates=[[[0,0],[40,0],[40,40],[0,40],[0,0]].map(([x,y])=>coordinate(x,y))];
  data.data[1].geometry.coordinates=coordinate(18,21);
  data.data.push({id:'routes',properties:{floor:1,type:'Navigation Path'},geometry:{type:'MultiLineString',coordinates:[[[2,20],[38,20]],[[20,2],[20,20]],[[18,22],[18,38]]].map(line=>line.map(([x,y])=>coordinate(x,y)))}});
  const result=analyzeVenueReference(annotatedReference(data,1,{...setup,widthMeters:40,heightMeters:40}),{drawingWidth:400,drawingHeight:400});
  assert.equal(result.analysis.routeSource,'geojson');assert.equal(result.analysis.sourcePathCount,3);
  assert.equal(result.graph.edges.length,4);
  const junctions=result.graph.nodes.filter(n=>n.type==='Junction');assert.equal(junctions.length,1);
  assert.ok(result.graph.nodes.every(n=>!n.id.startsWith('reference-access')));
  const {NavigationGraph}=await import('../engines/navigationGraph.js');assert.equal(new NavigationGraph(result.graph).components().length,2);
  const {DeploymentPlanner}=await import('../engines/deploymentPlanner.js');
  const planner=new DeploymentPlanner({graph:result.graph,floorGeometry:{objects:result.objects,metersPerPixel:.1},settings:{spacing:9,minimumSpacing:8,maximumSpacing:10,placementStrategy:'centerline',cellSize:1,additionalBeaconBudget:0}});
  const beacons=planner.generate().plan.beacons,junction=junctions[0];
  assert.equal(beacons.filter(b=>Math.hypot(b.worldX-junction.worldX,b.worldY-junction.worldY)<1e-6).length,1);
});
test('older uploaded projects discard invented routes while retaining aligned polygons',async()=>{
  const {normalizeProject}=await import('./drawing.js');
  const object={id:'shop',type:'room',points:[{x:0,y:0},{x:10,y:0},{x:10,y:10}],fillColor:'#a4d3df'};
  const result=normalizeProject({objects:[object],floorAnalysis:{method:'uploaded-annotations',warnings:[]},graph:{nodes:[{id:'fake'}],edges:[{id:'fake-edge'}]},beaconPlan:{beacons:[{id:'fake-beacon'}]},drawingWidthPixels:100,widthMeters:10,heightMeters:10});
  assert.deepEqual(result.objects,[object]);assert.equal(result.graph.edges.length,0);assert.equal(result.beaconPlan,null);assert.equal(result.floorAnalysis.routeSource,'missing');
});
