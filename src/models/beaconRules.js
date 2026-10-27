import {compileFloorGeometry,visibleGeometrySegment} from '../engines/floorGeometry.js';
import {annotationFloors} from './annotatedFloor.js';
import {geometryForProject} from './deployments.js';
export const beaconLabel=id=>/^IW\d+$/.test(id)?String(Number(id.slice(2))):id;
const distance=(a,b)=>Math.hypot(a.worldX-b.worldX,a.worldY-b.worldY);
export function nearbyBeacons(beacon,beacons){
  const nearest=new Map();
  for(const other of beacons){
    if(other.id===beacon.id||other.floorId!==beacon.floorId||other.enabled===false)continue;
    const dx=other.worldX-beacon.worldX,dy=other.worldY-beacon.worldY;
    const direction=Math.abs(dx)>=Math.abs(dy)?dx<0?'Left':'Right':dy<0?'Front (map up)':'Back (map down)';
    const meters=distance(beacon,other);
    if(!nearest.has(direction)||nearest.get(direction).meters>meters)nearest.set(direction,{id:other.id,direction,meters});
  }
  return [...nearest.values()];
}
export function beaconRuleSummary(project){
  const beacons=(project.beaconPlan?.beacons||[]).filter(b=>b.enabled!==false),nodes=project.graph.nodes;
  const floors=compileFloorGeometry(geometryForProject(project));
  const covers=(b,n)=>b.floorId===n.floorId&&distance(b,n)<=Math.min(b.reliableRadius??6,['Lift','Stairs','Escalator'].includes(n.type)?5:Infinity)&&visibleGeometrySegment({x:b.worldX,y:b.worldY},{x:n.worldX,y:n.worldY},floors.get(n.floorId));
  const degree=new Map(nodes.map(n=>[n.id,0]));
  for(const e of project.graph.edges){degree.set(e.source,(degree.get(e.source)||0)+1);degree.set(e.target,(degree.get(e.target)||0)+1);}
  const graphLandmarks=nodes.filter(n=>['Lift','Stairs','Escalator','Entrance','Exit','Landmark','Room Entrance','Junction'].includes(n.type)||degree.get(n.id)>=3||n.metadata?.anchorRequired);
  const scale=Number(project.widthMeters)/Number(project.drawingWidthPixels);
  const landmarks=[...graphLandmarks,...project.objects.filter(o=>o.type==='poi'&&!graphLandmarks.some(n=>n.metadata?.sourceId&&n.metadata.sourceId===o.metadata?.sourceId)).map(o=>({...o,floorId:o.floorId||nodes[0]?.floorId,type:o.category,worldX:o.x*scale,worldY:o.y*scale}))];
  const covered=items=>items.filter(n=>beacons.some(b=>covers(b,n))).length;
  const conflicts=beacons.flatMap(b=>{
    const rules=new Set();
    for(const w of project.beaconPlan?.warnings||[]){
      if(w.beaconId!==b.id&&!w.beaconIds?.includes(b.id))continue;
      if(w.code.includes('spacing')||w.code==='duplicate-beacons')rules.add('6–10 m spacing');
      else if(w.code.includes('geometry')||w.code.includes('wall')||w.code.includes('restricted'))rules.add('Valid mounting position');
    }
    const served=landmarks.filter(n=>covers(b,n));
    if(rules.size&&served.length)rules.add('Landmark coverage');
    return rules.size>=2?[{beacon:b,rules:[...rules]}]:[];
  });
  return {landmarks:landmarks.length,landmarksCovered:covered(landmarks),waypoints:nodes.length,waypointsCovered:covered(nodes),conflicts};
}
export function compareAnnotatedBeacons(project,tolerance=3){
  const alignment=project.annotationAlignment;
  if(!alignment)throw new Error('Import annotated floor data before comparing.');
  const matrix=alignment.geoToNormalizedPdf;
  const actual=annotationFloors(project.annotationData).features.filter(f=>f.properties?.type==='Beacon'&&String(f.properties.floor??f.properties.level??'0')===String(project.annotationFloor)&&f.geometry?.type==='Point').map(f=>{
    const [lon,lat]=f.geometry.coordinates;
    if(!Number.isFinite(lon)||!Number.isFinite(lat))throw new Error('Reference beacon has invalid coordinates.');
    const dx=lon-alignment.origin[0],dy=lat-alignment.origin[1];
    return {worldX:(dx*matrix[0][0]+dy*matrix[1][0]+matrix[2][0])*project.widthMeters,worldY:(dx*matrix[0][1]+dy*matrix[1][1]+matrix[2][1])*project.heightMeters};
  });
  if(!actual.length)throw new Error('No annotated Beacon points found on this floor.');
  const planned=(project.beaconPlan?.beacons||[]).filter(b=>b.enabled!==false&&b.floorId===(project.graph.nodes[0]?.floorId));
  const candidates=actual.map(a=>planned.map((b,j)=>({j,meters:distance(a,b)})).filter(p=>p.meters<=tolerance).sort((a,b)=>a.meters-b.meters));
  const matches=new Map();
  for(let i=0;i<actual.length;i++){
    const queue=[i],parents=new Map([[i,null]]),via=new Map();let free=null;
    for(let head=0;head<queue.length&&free===null;head++)for(const p of candidates[queue[head]]){
      if(via.has(p.j))continue;
      via.set(p.j,queue[head]);
      if(!matches.has(p.j)){free=p.j;break;}
      const previous=matches.get(p.j);
      if(!parents.has(previous)){parents.set(previous,p.j);queue.push(previous);}
    }
    while(free!==null){const index=via.get(free),previous=parents.get(index);matches.set(free,index);free=previous;}
  }
  const matched=matches.size,error=[...matches].reduce((sum,[j,i])=>sum+distance(actual[i],planned[j]),0);
  return {matched,actual:actual.length,planned:planned.length,accuracy:100*2*matched/(actual.length+planned.length),recall:100*matched/actual.length,precision:planned.length?100*matched/planned.length:0,meanError:matched?error/matched:null,tolerance};
}
