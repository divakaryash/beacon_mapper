import fs from 'node:fs/promises';
import clipping from 'polygon-clipping';
import {floorGeojson} from '../src/models/floorGeojson.js';
const source=JSON.parse(await fs.readFile('reports/professional/second-floor-source.json'));
const output=floorGeojson(source),areas=output.features.filter(f=>f.geometry.type==='Polygon'&&f.properties.type!=='Boundary');
const area=ring=>Math.abs(ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p[0]*q[1]-q[0]*p[1];},0))/2;
const multiArea=polys=>polys.reduce((sum,rings)=>sum+area(rings[0])-rings.slice(1).reduce((s,r)=>s+area(r),0),0);
let overlaps=0,overlapArea=0;
for(let i=0;i<areas.length;i++)for(let j=i+1;j<areas.length;j++){
  const intersection=multiArea(clipping.intersection(areas[i].geometry.coordinates,areas[j].geometry.coordinates));
  if(intersection>Math.max(.1,.005*Math.min(multiArea([areas[i].geometry.coordinates]),multiArea([areas[j].geometry.coordinates])))){overlaps++;overlapArea+=intersection;}
}
const counts={};for(const f of output.features)counts[f.properties.type]=(counts[f.properties.type]||0)+1;
const report={sample:source.name,scale:'Diagnostic 100 m drawing width only; not a verified physical scale.',counts,areaFeatures:areas.length,overlappingPairs:overlaps,overlapArea,placeholderNames:output.features.filter(f=>/^Detected|^Stair \/ escalator assembly/i.test(f.properties.name||'')).length,stringFloors:output.features.filter(f=>!Number.isInteger(f.properties.floor)).length,missingHeight:output.features.filter(f=>!('height'in f.properties)).length,missingLocalCoordinates:output.features.filter(f=>!f.geometry.coordinnatesLocal).length,doorPoints:0,centroidPoints:0,microSegments:source.graph.edges.filter(e=>e.distance<2).length,navigationSegments:source.graph.edges.length,registration:'No surveyed control points available; not georeferenced.'};
await fs.writeFile('reports/professional/00-baseline.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
