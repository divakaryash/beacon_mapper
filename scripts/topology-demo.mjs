import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DeploymentPlanner} from '../src/engines/deploymentPlanner.js';
import {planBeacons,BEACON_PROFILES} from '../src/engines/beaconPlacement.js';
import {analyzeCoverage} from '../src/engines/coverage.js';
import {sampleMall} from '../src/samples/sampleMall.js';
import {geometryForProject} from '../src/models/deployments.js';
const geometry=geometryForProject(sampleMall),inputs={graph:sampleMall.graph,floorGeometry:geometry,pois:sampleMall.objects.filter(o=>o.type==='poi').map(o=>({...o,worldX:o.x*.1,worldY:o.y*.1}))};
const legacy=planBeacons({...inputs,configuration:{placementStrategy:'centerline'}}),oldCoverage=analyzeCoverage({...inputs,beacons:legacy.beacons,profile:BEACON_PROFILES[0]});
const limited=new DeploymentPlanner({...inputs,settings:{additionalBeaconBudget:0}}).generate();
const planner=new DeploymentPlanner(inputs),start=performance.now(),result=planner.generate(),generationMs=performance.now()-start;
assert.equal(limited.plan.beacons.length,legacy.beacons.length);assert.ok(limited.coverage.coveragePercentage>oldCoverage.coveragePercentage);assert.equal(result.coverage.graphCoveragePercentage,100);
const report={sample:'Hand-modelled sample mall, not a surveyed DLF deployment',isRFSimulation:false,baseline:{beacons:legacy.beacons.length,walkableCoverage:oldCoverage.coveragePercentage,graphCoverage:oldCoverage.graphCoveragePercentage},sameCount:{beacons:limited.plan.beacons.length,walkableCoverage:limited.coverage.coveragePercentage,graphCoverage:limited.coverage.graphCoveragePercentage},topology:{statistics:result.plan.statistics,graphCoverage:result.coverage.graphCoveragePercentage,generationMs,optimization:result.plan.topology.optimization,strategies:result.plan.topology.strategies,beacons:result.plan.beacons,warnings:result.plan.warnings}};
fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/milestone-8-topology.json',JSON.stringify(report,null,2));
// A repo-native vector diagram uses actual geometry/coordinates, not a fabricated screenshot.
function svg(beacons){const polygons=sampleMall.objects.filter(o=>o.points),paths=polygons.map(o=>`<polygon points="${o.points.map(p=>`${p.x},${p.y}`).join(' ')}" fill="${o.type==='walkableArea'?'#eef5ee':o.type==='restrictedArea'?'#fecaca':'none'}" stroke="#999"/>`).join('');const nodes=new Map(sampleMall.graph.nodes.map(n=>[n.id,n]));return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><rect width="1200" height="760" fill="white"/>${paths}${sampleMall.graph.edges.map(e=>{const a=nodes.get(e.source),b=nodes.get(e.target);return `<path d="M${a.x} ${a.y}L${b.x} ${b.y}" stroke="#94a3b8" stroke-dasharray="4 4"/>`;}).join('')}${beacons.map(b=>`<circle cx="${b.x}" cy="${b.y}" r="${b.type==='Anchor'?10:7}" fill="${b.type==='Anchor'?'#e39522':'#0891b2'}"/><text x="${b.x+10}" y="${b.y-8}" font-family="Arial" font-size="12">${b.id}</text>`).join('')}</svg>`;}
fs.mkdirSync('screenshots',{recursive:true});fs.writeFileSync('screenshots/milestone-8-topology.svg',svg(result.plan.beacons));fs.writeFileSync('screenshots/milestone-8-centerline.svg',svg(legacy.beacons));
console.log(JSON.stringify({...report,topology:{...report.topology,beacons:undefined,warnings:report.topology.warnings.map(w=>w.message)}},null,2));
