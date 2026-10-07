import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {sampleMall,sampleFloorSvg} from "../src/samples/sampleMall.js";
import {geometryForProject} from "../src/models/deployments.js";
import {planBeacons,BEACON_PROFILES} from "../src/engines/beaconPlacement.js";
import {analyzeCoverage} from "../src/engines/coverage.js";
const graph=sampleMall.graph,floorGeometry=geometryForProject(sampleMall),profile=BEACON_PROFILES[0];
const plan=planBeacons({graph,floorGeometry,profile});
const start=performance.now();
const analyze=placement=>analyzeCoverage({graph,floorGeometry,beacons:placement.beacons,profile,placementQuality:placement.quality});
const coverage=analyze(plan),elapsedMs=performance.now()-start;
const disabled=plan.beacons.map(b=>b.edgeId==="atrium-lift"&&b.worldY>40&&b.worldY<56?{...b,enabled:false}:b);
const gapPlan=planBeacons({graph,floorGeometry,profile,configuration:{mode:"hybrid",beacons:disabled}}),gapCoverage=analyze(gapPlan);
assert.equal(coverage.graphCoveragePercentage,100);assert.ok(coverage.deadZones.length);assert.ok(coverage.overlapArea>0);assert.ok(gapCoverage.gaps.length);assert.equal(gapPlan.statistics.disabledBeacons,3);
const summarize=result=>{const {floorReports,...summary}=result;return {...summary,floorReports:floorReports.map(({cells,...floor})=>floor)};};
const report={source:"Hand-modelled Milestone 2 sample mall, not a surveyed deployment",placement:plan.statistics,placementWarnings:plan.warnings,coverage:summarize(coverage),gapTest:{placement:gapPlan.statistics,coverage:summarize(gapCoverage)},elapsedMs};
const nodes=new Map(graph.nodes.map(n=>[n.id,n]));
function diagram(placement,result) {
  const cells=result.floorReports.flatMap(f=>f.cells.map(c=>`<rect x="${(c.x-f.cellSize/2)*10}" y="${(c.y-f.cellSize/2)*10}" width="${f.cellSize*10}" height="${f.cellSize*10}" fill="${!c.count?'#ef4444':c.count>1?'#8b5cf6':'#10b981'}" opacity=".55"/>`)).join("");
  const edges=graph.edges.map(e=>{const a=nodes.get(e.source),b=nodes.get(e.target);return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#8256c7" stroke-width="3"/>`;}).join("");
  const rings=placement.beacons.filter(b=>b.enabled!==false).map(b=>`<circle cx="${b.x}" cy="${b.y}" r="${b.coverageRadius*10}" fill="none" stroke="#0891b2" stroke-dasharray="5 4" stroke-opacity=".5"/><circle cx="${b.x}" cy="${b.y}" r="${b.type==='Anchor'?9:6}" fill="${b.type==='Anchor'?'#e39522':'#0891b2'}" stroke="white" stroke-width="2"/>`).join("");
  const gaps=result.gaps.map(g=>`<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="#b91c1c" stroke-width="9"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><rect width="1200" height="900" fill="#f8fafb"/><g font-family="Arial" fill="#10253f"><text x="36" y="35" font-size="24" font-weight="bold">INPS · Sample mall coverage analysis</text><text x="36" y="65" font-size="17">Walkable coverage ${result.coveragePercentage.toFixed(1)}% · Graph ${result.graphCoveragePercentage.toFixed(1)}% · ${result.deadZones.length} dead zones · ${result.overlapArea.toFixed(1)} m² overlap</text><text x="36" y="90" font-size="15">Red: dead zones · Green: single beacon · Purple: overlap · Orange: anchors · Grid 0.5 m · Not RF coverage</text></g><g transform="translate(0 105)">${sampleFloorSvg}${cells}${edges}${rings}${gaps}</g><text x="36" y="883" font-family="Arial" font-size="14" fill="#536171">Hand-modelled sample floor. Installation and spacing warnings require review; not a deployment certification.</text></svg>`;
}
await mkdir(new URL("../reports/",import.meta.url),{recursive:true});await mkdir(new URL("../screenshots/",import.meta.url),{recursive:true});
await writeFile(new URL("../reports/milestone-5-demo.json",import.meta.url),JSON.stringify(report,null,2));
await writeFile(new URL("../screenshots/milestone-5-coverage.svg",import.meta.url),diagram(plan,coverage));
await writeFile(new URL("../screenshots/milestone-5-gap-check.svg",import.meta.url),diagram(gapPlan,gapCoverage));
console.log(JSON.stringify({beacons:plan.statistics.totalBeacons,anchors:plan.statistics.anchorBeacons,coveragePercentage:coverage.coveragePercentage,deadZones:coverage.deadZones.length,deadZoneArea:coverage.deadZoneArea,overlapArea:coverage.overlapArea,graphCoveragePercentage:coverage.graphCoveragePercentage,quality:coverage.quality.overallScore,gapTest:{disabled:3,gaps:gapCoverage.gaps.length,gapLength:gapCoverage.gaps.reduce((sum,g)=>sum+g.length,0),graphCoverage:gapCoverage.graphCoveragePercentage},elapsedMs},null,2));
