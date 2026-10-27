import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestWaypointCoverage} from './waypointSuggestions.js';
import {analyzeCoverage} from './coverage.js';
const region=[{x:0,y:0},{x:30,y:0},{x:30,y:10},{x:0,y:10}];
const graph={nodes:[{id:'a',floorId:'G',x:1,y:5,worldX:1,worldY:5},{id:'b',floorId:'G',x:29,y:5,worldX:29,worldY:5}],edges:[{id:'e',source:'a',target:'b',distance:28}]};
const base={graph,floorGeometry:{metersPerPixel:1,floors:[{floorId:'G',boundaries:[region],walkableAreas:[region]}]},profile:{coverageRadius:6},configuration:{coverageThreshold:'reliable',reliableRadius:6,marginalRadius:8,minimumSpacing:5,graphStep:.25},beacons:[]};
const run=input=>suggestWaypointCoverage({...input,coverage:analyzeCoverage(input)});
test('suggestions close waypoint gaps without changing the deployment',()=>{
 const r=run(base);assert.ok(r.suggestions.length>0);assert.equal(r.projectedPercentage,100);assert.equal(r.remainingLength,0);assert.equal(base.beacons.length,0);
 for(const a of r.suggestions)for(const b of r.suggestions)if(a!==b)assert.ok(Math.hypot(a.worldX-b.worldX,a.worldY-b.worldY)>=5);
 const verified=analyzeCoverage({...base,beacons:r.suggestions});assert.equal(verified.graphCoveragePercentage,100);
});
test('blocked waypoint segments remain gaps and cannot claim full coverage',()=>{
 const input={...base,floorGeometry:{metersPerPixel:1,floors:[{floorId:'G',boundaries:[region],walkableAreas:[region],walls:[{points:[{x:15,y:0},{x:15,y:10}],width:1}]}]}};
 const r=run(input);assert.ok(r.projectedPercentage<100);assert.ok(r.remainingLength>=1);assert.ok(r.reasons.some(g=>g.reason.includes('blocked')));
 assert.ok(r.suggestions.every(s=>Math.abs(s.worldX-15)>.5));
});
test('already covered paths require no additional beacons',()=>{
 const r=run({...base,beacons:[{id:'existing',floorId:'G',worldX:15,worldY:5,coverageRadius:40,reliableRadius:40}]});assert.equal(r.projectedPercentage,100);assert.equal(r.suggestions.length,0);
});
test('minimum spacing can prevent full coverage',()=>{
 const r=run({...base,configuration:{...base.configuration,minimumSpacing:100}});assert.ok(r.projectedPercentage<100);assert.ok(r.remainingLength>0);assert.equal(r.suggestions.length,1);
});
