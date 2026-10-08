import test from 'node:test';
import assert from 'node:assert/strict';
import reference from '../samples/dlfGroundReference.js';
import basement from '../samples/dlfBasementReference.js';
import {analyzeVenueReference} from './venueReference.js';
import {compileFloorGeometry,geometryConflict,validGraphIntervals} from './floorGeometry.js';
import {NavigationGraph} from './navigationGraph.js';
import {DeploymentPlanner} from './deploymentPlanner.js';

const dimensions={drawingWidth:1191,drawingHeight:1684};
function position(coordinates){const [lon,lat]=coordinates.map((n,i)=>n-reference.alignment.origin[i]),m=reference.alignment.geoToNormalizedPdf;return {x:(lon*m[0][0]+lat*m[1][0]+m[2][0])*dimensions.drawingWidth,y:(lon*m[0][1]+lat*m[1][1]+m[2][1])*dimensions.drawingHeight};}

test('DLF reference preserves API points, excludes private footprints and generates a connected, geometry-valid deployment',()=>{
  const result=analyzeVenueReference(reference,dimensions),scale=result.widthMeters/dimensions.drawingWidth,floorGeometry={objects:result.objects,metersPerPixel:scale},floor=compileFloorGeometry(floorGeometry).get('floor-1'),pois=result.objects.filter(o=>o.type==='poi'),nodes=new Map(result.graph.nodes.map(n=>[n.id,n]));
  assert.equal(result.analysis.counts.Store,73);
  assert.equal(result.analysis.counts.Wall,49);
  assert.equal(pois.length,131);
  assert.equal(new NavigationGraph(result.graph).components().length,1);
  assert.equal(result.analysis.scaleAssumed,false);
  for(const poi of pois){
    const source=reference.features.find(f=>f.id===poi.metadata.sourceId),expected=position(source.geometry.coordinates);
    assert.deepEqual({x:poi.x,y:poi.y},expected);
    assert.notEqual(source.properties.type,'Centroid');
  }
  for(const node of nodes.values())assert.equal(geometryConflict({x:node.worldX,y:node.worldY},floor),null);
  for(const edge of result.graph.edges){const a=nodes.get(edge.source),b=nodes.get(edge.target);assert.ok(validGraphIntervals({x:a.worldX,y:a.worldY},{x:b.worldX,y:b.worldY},floor).reduce((sum,[lo,hi])=>sum+hi-lo,0)>1-1e-7);}
  const zaraCenter=position([77.321060507513,28.568205359717798]);
  assert.equal(geometryConflict({x:zaraCenter.x*scale,y:zaraCenter.y*scale},floor),'non-walkable-area');
  const output=new DeploymentPlanner({graph:result.graph,floorGeometry,pois:pois.map(p=>({...p,worldX:p.x*scale,worldY:p.y*scale})),settings:{cellSize:1,additionalBeaconBudget:100}}).generate();
  assert.ok(output.plan.beacons.length>0);
  assert.equal(output.plan.beacons[0].id,'IW001');
  for(const b of output.plan.beacons)assert.equal(geometryConflict({x:b.worldX,y:b.worldY},floor),null);
  assert.ok(output.coverage.coveragePercentage>=90);
  assert.ok(!output.plan.warnings.some(w=>w.code==='graph-geometry-conflict'));
});

test('centroids and stale local point coordinates cannot become deployment targets; malformed references fail',()=>{
  const original=reference.features.find(f=>f.properties.type==='Store'&&f.geometry.type==='Point');
  const changed=structuredClone(reference);
  changed.features.find(f=>f.id===original.id).geometry.coordinnatesLocal=[99999,-99999];
  changed.features.push({...structuredClone(original),id:'fake-centroid',properties:{...original.properties,type:'Centroid'}});
  const result=analyzeVenueReference(changed,dimensions);
  assert.ok(!result.objects.some(o=>o.metadata?.sourceId==='fake-centroid'));
  assert.deepEqual({x:result.objects.find(o=>o.metadata?.sourceId===original.id).x,y:result.objects.find(o=>o.metadata?.sourceId===original.id).y},position(original.geometry.coordinates));
  assert.throws(()=>analyzeVenueReference({...reference,alignment:null},dimensions),/Invalid/);
  assert.throws(()=>analyzeVenueReference({...reference,features:[original,original]},dimensions),/unique/);
  assert.throws(()=>analyzeVenueReference({...reference,features:[{...original,geometry:{type:'Point',coordinates:[Infinity,28]}}]},dimensions),/Invalid geographic/);
});

test('L00 basement produces its own editable graph, numbered beacons and measurable coverage',()=>{
  const result=analyzeVenueReference(basement,dimensions),scale=result.widthMeters/dimensions.drawingWidth;
  assert.equal(result.analysis.referenceFloor,-1);
  assert.equal(result.analysis.counts.Store,59);
  assert.equal(result.analysis.counts.Wall,25);
  assert.equal(result.analysis.attachedAccessPoints,110);
  assert.ok(result.graph.edges.length>0);
  const floorGeometry={objects:result.objects,metersPerPixel:scale},floors=compileFloorGeometry(floorGeometry);
  for(const edge of result.graph.edges){
    const a=result.graph.nodes.find(n=>n.id===edge.source),b=result.graph.nodes.find(n=>n.id===edge.target);
    const intervals=validGraphIntervals({x:a.worldX,y:a.worldY},{x:b.worldX,y:b.worldY},floors.get(a.floorId));
    assert.ok(intervals.length===1&&intervals[0][0]<1e-6&&intervals[0][1]>1-1e-6);
  }
  const output=new DeploymentPlanner({graph:result.graph,floorGeometry,settings:{cellSize:1,additionalBeaconBudget:100},pois:result.objects.filter(o=>o.type==='poi').map(o=>({...o,worldX:o.x*scale,worldY:o.y*scale}))}).generate();
  assert.ok(output.plan.beacons.length>0);
  assert.equal(output.plan.beacons[0].id,'IW001');
  assert.equal(new Set(output.plan.beacons.map(b=>b.id)).size,output.plan.beacons.length);
  for(const beacon of output.plan.beacons)assert.equal(geometryConflict({x:beacon.worldX,y:beacon.worldY},floors.get(beacon.floorId)),null);
  assert.ok(output.coverage.totalArea>0);
  assert.ok(output.coverage.coveragePercentage>80);
});
