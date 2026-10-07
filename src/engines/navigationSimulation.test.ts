import test from 'node:test';
import assert from 'node:assert/strict';
import {NavigationSimulation,compareSimulationDeployments} from './navigationSimulation.ts';
import type {Inputs,Node} from './navigationSimulation.ts';
const node=(id:string,x:number,floorId='f'):Node=>({id,floorId,x,y:0,worldX:x,worldY:0,type:'Corridor',metadata:{label:id}});
const polygon=[{x:-1,y:-2},{x:60000,y:-2},{x:60000,y:2},{x:-1,y:2}];
function fixture():Inputs{return {graph:{nodes:[node('a',0),node('b',10),node('c',20)],edges:[{id:'ab',source:'a',target:'b',distance:10,direction:'both',accessibility:true,edgeType:'Walkway'},{id:'bc',source:'b',target:'c',distance:10,direction:'both',accessibility:true,edgeType:'Walkway'}]},floorGeometry:{floors:[{floorId:'f',boundaries:[polygon],walkableAreas:[polygon]}]},beacons:[0,10,20].map((x,i)=>({id:`IW00${i+1}`,floorId:'f',worldX:x,worldY:0,coverageRadius:6,reliableRadius:4,marginalRadius:6})),pois:[{id:'start',name:'Entrance',floorId:'f',worldX:0,worldY:0,metadata:{nodeId:'a'}},{id:'end',name:'Store',floorId:'f',worldX:20,worldY:0,metadata:{nodeId:'c'}}],configuration:{walkingSpeedMps:1,sampleStep:.25}};}
test('shortest route and deterministic beacon switching with reliable/weak statistics',()=>{
  const simulation=new NavigationSimulation(fixture(),'start','end'),stats=simulation.statistics;
  assert.deepEqual(stats.orderedNodes,['a','b','c']);assert.equal(stats.distance,20);assert.equal(stats.walkingTime,20);assert.equal(stats.handovers,2);assert.equal(stats.coveragePercentage,100);assert.ok(stats.continuousCoverage);assert.ok(stats.reliabilityScore<100);assert.equal(stats.maximumDistanceBetweenActiveBeacons,10);
  assert.deepEqual(simulation.events.filter(e=>['connect','handover'].includes(e.kind)).map(e=>e.currentBeacon),['IW001','IW002','IW003']);
  assert.equal(simulation.events.at(-1)?.message,'Arrived at Store');assert.equal(simulation.stateAt(11).activeBeacon,'IW002');assert.ok(simulation.events.some(e=>e.kind==='landmark'));
});
test('play/pause/resume/seek/speed/stop/replay update progress inside the engine',()=>{
  const s=new NavigationSimulation(fixture(),'start','end');s.control('play');assert.equal(s.advance(2).distance,2);s.control('pause');assert.equal(s.advance(8).distance,2);s.control('speed',5);s.control('resume');assert.equal(s.advance(2).distance,12);assert.equal(s.control('seek',3).distance,3);assert.equal(s.control('stop').distance,0);s.control('replay');assert.equal(s.advance(100).status,'finished');assert.equal(s.stateAt(20).nodeId,'c');assert.throws(()=>s.advance(-1));assert.throws(()=>s.control('speed',3));
});
test('disabled beacons expose gaps and comparison recommends the better layout',()=>{
  const input=fixture(),baseline=input.beacons;input.beacons=input.beacons.map(b=>({...b,enabled:b.id!=='IW002'}));const s=new NavigationSimulation(input,'start','end');assert.equal(s.statistics.coveragePercentage,60);assert.equal(s.statistics.longestGap,8);assert.equal(s.statistics.continuousCoverage,false);assert.equal(s.statistics.deadZones.length,1);
  const comparison=compareSimulationDeployments(input,'start','end',{name:'A',beacons:baseline},{name:'B',beacons:input.beacons});assert.ok(comparison.a.navigationScore>comparison.b.navigationScore);assert.match(comparison.recommendation,/A has/);
});
test('thin walls cannot disappear between samples and missing geometry fails closed',()=>{
  const input=fixture();(input.floorGeometry as any).floors[0].walls=[{points:[{x:5.13,y:-2},{x:5.13,y:2}],width:.01}];const s=new NavigationSimulation(input,'start','end');assert.ok(s.statistics.longestGap>=.25);assert.equal(s.statistics.continuousCoverage,false);
  input.floorGeometry={};const unknown=new NavigationSimulation(input,'start','end');assert.equal(unknown.statistics.coveragePercentage,0);assert.equal(unknown.statistics.longestGap,20);
  assert.match(unknown.warnings.join(' '),/unavailable/);
});
test('same POI zero route, missing attachments, directions and invalid inputs',()=>{
  const input=fixture();assert.equal(new NavigationSimulation(input,'start','start').statistics.distance,0);assert.ok(new NavigationSimulation(input,'start','start').statistics.continuousCoverage);
  input.graph.edges[0].direction='reverse';assert.throws(()=>new NavigationSimulation(input,'start','end'),/No route/);
  const invalid=fixture();invalid.pois[0].metadata={nodeId:'missing'};assert.throws(()=>new NavigationSimulation(invalid,'start','end'),/attachment/);invalid.pois[0].metadata={nodeId:'a'};invalid.beacons[0].worldX=NaN;assert.throws(()=>new NavigationSimulation(invalid,'start','end'),/Invalid beacon/);
});
test('multi-floor lift travel is unverified, never covered by another floor',()=>{
  const input=fixture();input.graph.nodes[2]=node('c',10,'f2');input.graph.edges[1]={...input.graph.edges[1],distance:3,edgeType:'Lift Connection'};input.pois[1]={...input.pois[1],floorId:'f2',worldX:10};
  (input.floorGeometry as any).floors.push({floorId:'f2',boundaries:[polygon],walkableAreas:[polygon]});input.beacons.push({...input.beacons[0],id:'f2-beacon',floorId:'f2',worldX:10});
  const s=new NavigationSimulation(input,'start','end');assert.deepEqual(s.statistics.floorsTraversed,['f','f2']);assert.ok(s.statistics.longestGap>=3);assert.equal(s.stateAt(11).coverageState,'transition');assert.equal(s.stateAt(13).floorId,'f2');assert.match(s.warnings.join(' '),/unverified/);
});
test('10,000+ nodes and 2,000+ beacons simulate with indexed lookups',()=>{
  const input=fixture(),count=10001;input.graph.nodes=Array.from({length:count},(_,i)=>node(`n${i}`,i*5.5));input.graph.edges=Array.from({length:count-1},(_,i)=>({id:`e${i}`,source:`n${i}`,target:`n${i+1}`,distance:5.5,direction:'both',accessibility:true,edgeType:'Walkway'}));input.beacons=Array.from({length:2501},(_,i)=>({id:`IW${i}`,floorId:'f',worldX:i*22,worldY:0,coverageRadius:12,reliableRadius:11,marginalRadius:12}));input.pois[0].metadata={nodeId:'n0'};input.pois[1]={...input.pois[1],worldX:1100,metadata:{nodeId:'n200'}};
  const started=performance.now(),s=new NavigationSimulation(input,'start','end'),prepareMs=performance.now()-started;const tick=performance.now();for(let i=0;i<1000;i++)s.stateAt(i%s.duration);const playbackMs=performance.now()-tick;
  console.log(`simulation benchmark: ${count} nodes, ${input.beacons.length} beacons; prepare ${prepareMs.toFixed(1)} ms, 1,000 seeks ${playbackMs.toFixed(1)} ms`);assert.equal(s.statistics.distance,1100);assert.equal(s.statistics.coveragePercentage,100);assert.ok(prepareMs<10000);assert.ok(playbackMs<2000);
});
test('unmodelled POI approaches cannot be reported as continuous end-to-end navigation',()=>{
  const input=fixture();input.pois[0].worldY=1;const s=new NavigationSimulation(input,'start','end');
  assert.equal(s.statistics.approachDistance,1);assert.equal(s.statistics.coveragePercentage,100);assert.equal(s.statistics.continuousCoverage,false);assert.match(s.warnings.join(' '),/unverified/);
});
