import fs from 'node:fs';
import assert from 'node:assert/strict';
import {NavigationSimulation,compareSimulationDeployments} from '../src/engines/navigationSimulation.ts';
import {planBeacons} from '../src/engines/beaconPlacement.js';
import {geometryForProject} from '../src/models/deployments.js';
import {sampleMall} from '../src/samples/sampleMall.js';

const geometry=geometryForProject(sampleMall);
// Preserve the reproducible Milestone 7 baseline; topology comparison has its own Milestone 8 demo.
const baseline=planBeacons({graph:sampleMall.graph,floorGeometry:geometry,configuration:{placementStrategy:'centerline'}}).beacons.map((b,i)=>({...b,id:`IW${String(i+1).padStart(3,'0')}`,reliableRadius:6,marginalRadius:8}));
const inputs={graph:sampleMall.graph,floorGeometry:geometry,beacons:baseline,pois:sampleMall.objects.filter(o=>o.type==='poi').map(o=>({...o,worldX:o.x*.1,worldY:o.y*.1})),configuration:{sampleStep:.25,walkingSpeedMps:1.35}};
const simulation=new NavigationSimulation(inputs,'poi-main','poi-lift'),report=simulation.report();
assert.equal(report.statistics.distance,57);assert.ok(report.statistics.continuousCoverage);assert.equal(report.statistics.coveragePercentage,100);
const missing=baseline.map(b=>({...b,enabled:!['IW010','IW011','IW012'].includes(b.id)}));
const comparison=compareSimulationDeployments(inputs,'poi-main','poi-lift',{name:'A · baseline',beacons:baseline},{name:'B · three disabled',beacons:missing});assert.ok(comparison.a.navigationScore>comparison.b.navigationScore);
fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/milestone-7-navigation.json',JSON.stringify(report,null,2));fs.writeFileSync('reports/milestone-7-events.json',JSON.stringify(report.events,null,2));fs.writeFileSync('reports/milestone-7-comparison.json',JSON.stringify(comparison,null,2));
const graph={nodes:[],edges:[]};for(let i=0;i<10001;i++){graph.nodes.push({id:`n${i}`,x:i*5.5,y:0,worldX:i*5.5,worldY:0,floorId:'large',type:'Corridor',metadata:{}});if(i)graph.edges.push({id:`e${i}`,source:`n${i-1}`,target:`n${i}`,distance:5.5,accessibility:true,direction:'both',edgeType:'Walkway'});}
const polygon=[{x:-1,y:-2},{x:56000,y:-2},{x:56000,y:2},{x:-1,y:2}];
const beacons=Array.from({length:2501},(_,i)=>({id:`IW${String(i+1).padStart(3,'0')}`,floorId:'large',worldX:i*22,worldY:0,coverageRadius:12,reliableRadius:11,marginalRadius:12}));
const started=performance.now(),large=new NavigationSimulation({graph,floorGeometry:{floors:[{floorId:'large',boundaries:[polygon],walkableAreas:[polygon]}]},beacons,pois:[{id:'s',name:'Start',floorId:'large',worldX:0,worldY:0,metadata:{nodeId:'n0'}},{id:'e',name:'End',floorId:'large',worldX:1100,worldY:0,metadata:{nodeId:'n200'}}]},'s','e'),prepareMs=performance.now()-started;
const seekStart=performance.now();for(let i=0;i<1000;i++)large.stateAt(i%large.duration);const seek1000Ms=performance.now()-seekStart;
const result={sampleStatistics:report.statistics,beaconSequence:report.events.filter(e=>['connect','handover'].includes(e.kind)).map(e=>({time:e.time,id:e.currentBeacon})),comparison,benchmark:{nodes:10001,beacons:2501,routeDistance:1100,prepareMs,seek1000Ms}};
fs.writeFileSync('reports/milestone-7-demo.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
