import { geometryConflict, pointInPolygon, segmentProjection, validGraphIntervals, visibleGeometrySegment } from './floorGeometry.js';
import {analyzeCoverage} from './coverage.js';

export const TOPOLOGY_DEFAULTS = { narrowWidth: 3, mediumWidth: 6, openAreaWidth: 12, mountingInset: .4, topologySearchRadius: 8, additionalBeaconBudget: 20 };
export function validateTopologySettings(settings) {
  const s={...TOPOLOGY_DEFAULTS,...settings};
  for(const key of Object.keys(TOPOLOGY_DEFAULTS))if(!Number.isFinite(s[key])||s[key]<0||(key!=='additionalBeaconBudget'&&s[key]===0))throw new Error(`${key} must be positive and finite (additional budget may be zero).`);
  if(!Number.isSafeInteger(s.additionalBeaconBudget)||s.additionalBeaconBudget>200)throw new Error('Additional beacon budget must be an integer from 0 to 200.');
  if(!(s.narrowWidth<s.mediumWidth&&s.mediumWidth<s.openAreaWidth))throw new Error('Corridor width thresholds must be increasing.');
  return s;
}
const point=n=>({x:n.worldX,y:n.worldY});
const special={'Lift':'Lift','Escalator':'Escalator','Stairs':'Stair','Room Entrance':'Store Entrance','Store':'Store Entrance','Outlet':'Store Entrance','Food Court':'Food Court','Atrium':'Atrium','Junction':'Junction'};
function crossSection(center,normal,floor,reach=100) {
  const a={x:center.x-normal.x*reach,y:center.y-normal.y*reach},b={x:center.x+normal.x*reach,y:center.y+normal.y*reach};
  const interval=validGraphIntervals(a,b,floor).find(([lo,hi])=>lo<=.5&&hi>=.5);
  return interval?{left:(interval[1]-.5)*reach*2,right:(.5-interval[0])*reach*2,capped:interval[0]===0||interval[1]===1}:null;
}

// A reference describes the route station, not a constraint on mounting coordinates.
export function referenceBeacon(beacon,graph) {
  const nodes=graph.nodes instanceof Map?graph.nodes:new Map(graph.nodes.map(n=>[n.id,n]));
  const edges=graph.edges instanceof Map?[...graph.edges.values()]:graph.edges;
  let best=null;
  const preferred=edges.find(e=>e.id===beacon.edgeId),search=preferred&&nodes.get(preferred.source)?.floorId===beacon.floorId&&nodes.get(preferred.target)?.floorId===beacon.floorId?[preferred]:edges;
  for(const edge of search){const a=nodes.get(edge.source),b=nodes.get(edge.target);if(a.floorId!==beacon.floorId||b.floorId!==beacon.floorId)continue;const p=segmentProjection(point(beacon),point(a),point(b));if(!best||p.distance<best.distance)best={edge,p,distance:p.distance};}
  if(!best)return beacon;
  const node=nodes.get(beacon.nodeId);
  return {...beacon,nodeId:node?.floorId===beacon.floorId?beacon.nodeId:undefined,edgeId:best.edge.id,edgeOffset:best.p.t*best.edge.distance,referenceDistance:best.distance};
}

export function analyzeFloorTopology({graph,floors,pois=[],settings={}}) {
  if(pois.some(p=>!p.id||!p.floorId||![p.worldX,p.worldY].every(Number.isFinite)))throw new Error('POIs require IDs, floor IDs and finite world coordinates.');
  const s=validateTopologySettings(settings),nodes=graph.nodes instanceof Map?graph.nodes:new Map(graph.nodes.map(n=>[n.id,n])),edges=graph.edges instanceof Map?[...graph.edges.values()]:graph.edges;
  const degree=new Map();for(const e of edges)for(const id of [e.source,e.target])degree.set(id,(degree.get(id)||0)+1);
  const landmarks=[...nodes.values()].filter(n=>special[n.type]||special[n.metadata?.category]);
  const contextPoints=[...landmarks,...pois];
  const contextBins=new Map();for(const p of contextPoints){const key=`${p.floorId}:${Math.floor(p.worldX/s.topologySearchRadius)}:${Math.floor(p.worldY/s.topologySearchRadius)}`;if(!contextBins.has(key))contextBins.set(key,[]);contextBins.get(key).push(p);}
  const reports=edges.map(edge=>{
    const a=nodes.get(edge.source),b=nodes.get(edge.target),floor=floors.get(a.floorId);
    if(a.floorId!==b.floorId)return {edgeId:edge.id,floorId:a.floorId,classification:'floor-transition',strategy:special[a.type]||special[b.type]||'Lift',corridorWidth:null,walkablePolygons:[],adjacentRoomEntrances:[],nearbyPOIs:[]};
    const normal={x:-(b.worldY-a.worldY)/edge.distance,y:(b.worldX-a.worldX)/edge.distance};
    const widths=[.1,.5,.9].map(t=>crossSection({x:a.worldX+t*(b.worldX-a.worldX),y:a.worldY+t*(b.worldY-a.worldY)},normal,floor)).filter(Boolean);
    const values=widths.map(w=>w.left+w.right).sort((a,b)=>a-b),width=values.length?values[Math.floor(values.length/2)]:null;
    const nearby=[],size=s.topologySearchRadius,minX=Math.floor(Math.min(a.worldX,b.worldX)/size)-1,maxX=Math.floor(Math.max(a.worldX,b.worldX)/size)+1,minY=Math.floor(Math.min(a.worldY,b.worldY)/size)-1,maxY=Math.floor(Math.max(a.worldY,b.worldY)/size)+1;
    if((maxX-minX+1)*(maxY-minY+1)>contextPoints.length){for(const p of contextPoints)if(p.floorId===a.floorId&&segmentProjection(point(p),point(a),point(b)).distance<=size)nearby.push(p);}
    else for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++)for(const p of contextBins.get(`${a.floorId}:${x}:${y}`)||[])if(segmentProjection(point(p),point(a),point(b)).distance<=size)nearby.push(p);
    const polygons=(floor?.walkableAreas||[]).map((polygon,i)=>({id:floor.walkableRegionMetadata?.[i]?.id||`${a.floorId}:walkable-${i+1}`,polygon,category:floor.walkableRegionMetadata?.[i]?.category})).filter(p=>[a,b].some(n=>pointInPolygon(point(n),p.polygon))||pointInPolygon({x:(a.worldX+b.worldX)/2,y:(a.worldY+b.worldY)/2},p.polygon));
    const classification=width===null?'unknown':width>=s.openAreaWidth?'open-area':'corridor';
    return {edgeId:edge.id,floorId:a.floorId,corridorWidth:width,widthSamples:values,widthCapped:widths.some(w=>w.capped),classification,normal,walkablePolygons:polygons,adjacentRoomEntrances:nearby.filter(p=>p.type==='Room Entrance'||['Store','Outlet'].includes(p.category||p.metadata?.category)).map(p=>p.id),nearbyPOIs:nearby.map(p=>({id:p.id,type:p.type,category:p.category||p.metadata?.category,worldX:p.worldX,worldY:p.worldY})),strategy:width===null?'Narrow Corridor':width<=s.narrowWidth?'Narrow Corridor':width<=s.mediumWidth?'Medium Corridor':classification==='open-area'?'Atrium':'Wide Corridor',junctionNodes:[a,b].filter(n=>(degree.get(n.id)||0)>=3).map(n=>n.id)};
  });
  return reports;
}

export function placeByTopology({graph,floors,beacons,profile,pois=[],settings={}}) {
  graph={nodes:graph.nodes instanceof Map?graph.nodes:new Map(graph.nodes.map(n=>[n.id,n])),edges:graph.edges instanceof Map?[...graph.edges.values()]:graph.edges};
  const s=validateTopologySettings(settings),edges=analyzeFloorTopology({graph,floors,pois,settings:s}),lookup=new Map(edges.map(e=>[e.edgeId,e]));
  const nodes=graph.nodes instanceof Map?graph.nodes:new Map(graph.nodes.map(n=>[n.id,n]));
  const radius=Number(settings.reliableRadius??profile.coverageRadius),warnings=[];
  if(!(radius>0)||!Number.isFinite(radius))throw new Error('Topology planning radius must be positive.');
  for(const edge of edges)if(edge.widthCapped)warnings.push({code:'topology-width-capped',edgeId:edge.edgeId,message:`${edge.edgeId}: cross-section reached the 200 m measurement ceiling; width/classification requires review.`});
  const neighborBins=new Map(),bucket=b=>`${b.floorId}:${Math.floor(b.worldX/radius)}:${Math.floor(b.worldY/radius)}`;
  function indexBeacon(b){const key=bucket(b);if(!neighborBins.has(key))neighborBins.set(key,new Map());neighborBins.get(key).set(b.id,b);}
  for(const b of beacons)indexBeacon(b);
  function coveredByOther(p,floorId,floor){const cx=Math.floor(p.x/radius),cy=Math.floor(p.y/radius);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const b of neighborBins.get(`${floorId}:${cx+dx}:${cy+dy}`)?.values()||[])if(Math.hypot(p.x-b.worldX,p.y-b.worldY)<=radius&&visibleGeometrySegment(point(b),p,floor))return true;return false;}
  const routeBins=new Map(),graphLength=graph.edges.reduce((sum,e)=>sum+e.distance,0),routeStep=Math.max(.25,graphLength/100000);
  for(const edge of graph.edges){const a=nodes.get(edge.source),b=nodes.get(edge.target);if(a.floorId!==b.floorId)continue;const count=Math.max(1,Math.ceil(edge.distance/routeStep));for(let i=0;i<=count;i++){const t=i/count,p={x:a.worldX+t*(b.worldX-a.worldX),y:a.worldY+t*(b.worldY-a.worldY)};if(geometryConflict(p,floors.get(a.floorId)))continue;const key=`${a.floorId}:${Math.floor(p.x/radius)}:${Math.floor(p.y/radius)}`;if(!routeBins.has(key))routeBins.set(key,[]);routeBins.get(key).push(p);}}
  if(routeStep>.25)warnings.push({code:'topology-route-resolution',message:`Topology route constraints sampled at ${routeStep.toFixed(2)} m; final coverage validation remains authoritative.`});
  const placed=beacons.map((original,index)=>{
    const b={...referenceBeacon(original,graph),reliableRadius:radius,marginalRadius:settings.marginalRadius??radius*4/3},context=lookup.get(b.edgeId),floor=floors.get(b.floorId),node=nodes.get(b.nodeId);
    if(!context?.normal)return {...b,placementStrategy:special[node?.type]||'Lift'};
    const nearby=context.nearbyPOIs.filter(p=>(special[p.category]||special[p.type])&&Math.hypot(p.worldX-b.worldX,p.worldY-b.worldY)<=s.topologySearchRadius).sort((a,c)=>Math.hypot(a.worldX-b.worldX,a.worldY-b.worldY)-Math.hypot(c.worldX-b.worldX,c.worldY-b.worldY));
    const strategy=special[node?.metadata?.category]||special[node?.type]||special[nearby[0]?.category]||special[nearby[0]?.type]||(context.junctionNodes.includes(b.nodeId)?'Junction':context.strategy);
    const center=point(b),section=crossSection(center,context.normal,floor);
    if(!section){warnings.push({code:'unknown-topology',beaconId:b.id,message:`${b.id}: no valid corridor cross-section; geometry repair required.`});return {...b,placementStrategy:strategy};}
    // Keep the reference station inside reliable geometric radius; width alone must not break route coverage.
    const cap=Math.max(0,Math.sqrt(Math.max(0,radius*radius-(Number(settings.spacing??5.5)/2)**2))-.05);
    const left=Math.min(cap,Math.max(0,section.left-s.mountingInset)),right=-Math.min(cap,Math.max(0,section.right-s.mountingInset));
    const preferred=strategy==='Narrow Corridor'?left:index%2?right:left;
    const offsets=strategy==='Narrow Corridor'?[left,left/2,0]:strategy==='Medium Corridor'?[preferred,preferred/2,0]:[preferred,preferred===left?right:left,preferred/2,0];
    neighborBins.get(bucket(original))?.delete(original.id);
    const criticalRoute=[],cx=Math.floor(center.x/radius),cy=Math.floor(center.y/radius);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const p of routeBins.get(`${b.floorId}:${cx+dx}:${cy+dy}`)||[])if(Math.hypot(p.x-center.x,p.y-center.y)<=radius&&visibleGeometrySegment(center,p,floor)&&!coveredByOther(p,b.floorId,floor))criticalRoute.push(p);
    // ponytail: 81 local marginal-coverage probes per candidate; exact polygon optimisation is not claimed.
    const probes=[];for(let x=-4;x<=4;x++)for(let y=-4;y<=4;y++){const p={x:center.x+x*radius/2,y:center.y+y*radius/2};if(!geometryConflict(p,floor)&&!coveredByOther(p,b.floorId,floor))probes.push(p);}
    let chosen=null,best=-Infinity;
    const choices=offsets.map(offset=>({x:center.x+context.normal.x*offset,y:center.y+context.normal.y*offset,preferred:offset===preferred}));
    if(['Junction','Lift','Escalator','Stair'].includes(strategy))for(const sign of [-1,1])choices.unshift({x:center.x+context.normal.x*preferred+context.normal.y*s.mountingInset*sign,y:center.y+context.normal.y*preferred-context.normal.x*s.mountingInset*sign,preferred:true});
    if(strategy==='Store Entrance'&&nearby.length){const poi=nearby[0],dx=poi.worldX-center.x,dy=poi.worldY-center.y,d=Math.hypot(dx,dy);if(d>0)choices.unshift({x:center.x+dx/d*Math.min(d,cap),y:center.y+dy/d*Math.min(d,cap),preferred:true});}
    for(const p of choices){const moved=Math.hypot(p.x-center.x,p.y-center.y),routeRadius=moved>1e-7?Math.max(0,radius-routeStep/2):radius;if(moved>cap+1e-6||geometryConflict(p,floor)||!visibleGeometrySegment(p,center,floor)||criticalRoute.some(q=>Math.hypot(q.x-p.x,q.y-p.y)>routeRadius||!visibleGeometrySegment(p,q,floor)))continue;
      const gain=probes.filter(q=>Math.hypot(q.x-p.x,q.y-p.y)<=radius&&visibleGeometrySegment(p,q,floor)).length;
      // Retain an edge/alternating-side mounting preference when coverage is tied.
      const score=gain+(p.preferred ? .1 : 0);if(score>best){best=score;chosen=p;}
    }
    if(!chosen){indexBeacon(original);return {...b,placementStrategy:strategy};}
    const edge=graph.edges instanceof Map?graph.edges.get(b.edgeId):graph.edges.find(e=>e.id===b.edgeId),a=nodes.get(edge.source),z=nodes.get(edge.target);
    const pixelLength=Math.hypot(z.x-a.x,z.y-a.y),scale=Number(settings.metersPerPixel)||edge.distance/pixelLength;
    if(!(scale>0)||!Number.isFinite(scale))throw new Error('Topology placement requires a valid pixel-to-metre scale.');
    const result={...b,x:b.x+(chosen.x-center.x)/scale,y:b.y+(chosen.y-center.y)/scale,worldX:chosen.x,worldY:chosen.y,referenceDistance:Math.hypot(chosen.x-center.x,chosen.y-center.y),placementStrategy:strategy,walkablePolygonIds:context.walkablePolygons.map(p=>p.id)};indexBeacon(result);return result;
  });
  const optimized=completeAreaCoverage({graph,floors,beacons:mergeNearbyBeacons(placed,floors,Math.min(settings.minimumSpacing??5,automaticBeaconSeparationMeters)),profile,settings:{...settings,...s},edges});
  warnings.push(...optimized.warnings);
  return {beacons:optimized.beacons,topology:{method:'geometry-cross-sections-greedy-area-coverage',edges,strategies:Object.fromEntries([...new Set(optimized.beacons.map(b=>b.placementStrategy))].map(strategy=>[strategy,optimized.beacons.filter(b=>b.placementStrategy===strategy).length])),optimization:optimized.statistics,objective:'Merge nearby visible route stations; greedily cover uncovered walkable samples using perimeter candidates, then remove redundant area beacons. Bounded heuristic, not a global optimum.'},warnings};
}

export const automaticBeaconSeparationMeters=3;

export function nearbyVisibleBeacon(beacons, candidate, floors, minimum=automaticBeaconSeparationMeters) {
  return beacons.find(b=>b.enabled!==false&&b.floorId===candidate.floorId&&Math.hypot(b.worldX-candidate.worldX,b.worldY-candidate.worldY)<minimum-1e-6&&visibleGeometrySegment(point(b),point(candidate),floors.get(b.floorId)));
}

function mergeNearbyBeacons(beacons, floors, minimum) {
  const kept=[];
  for(const beacon of beacons) {
    const existing=nearbyVisibleBeacon(kept,beacon,floors,minimum);
    if(existing)existing.anchorNodeIds=[...new Set([...(existing.anchorNodeIds||[]),existing.nodeId,...(beacon.anchorNodeIds||[]),beacon.nodeId].filter(Boolean))];
    else kept.push({...beacon});
  }
  return kept;
}

function completeAreaCoverage({graph,floors,beacons,profile,settings,edges}) {
  if(settings.additionalBeaconBudget===0)return {beacons,warnings:[],statistics:{routeBeacons:beacons.length,areaBeacons:0,added:0,removed:0,candidates:0,additionalBeaconBudget:0}};
  const nodes=graph.nodes instanceof Map?graph.nodes:new Map(graph.nodes.map(n=>[n.id,n])),sourceEdges=new Map((graph.edges instanceof Map?[...graph.edges.values()]:graph.edges).map(e=>[e.id,e])),edgeContexts=new Map(edges.map(e=>[e.edgeId,e]));
  const coverage=analyzeCoverage({graph,floorGeometry:{},compiledFloors:floors,beacons,profile,configuration:{...settings,coverageThreshold:'reliable',cellSize:Math.max(1,settings.cellSize||1)}});
  const radius=settings.reliableRadius??profile.coverageRadius,target=settings.coverageTarget??90,points=[],bins=new Map(),counts=[];
  for(const floor of coverage.floorReports)for(const cell of floor.cells){const id=points.length;points.push({...cell,floorId:floor.floorId});counts.push(cell.count);const key=`${floor.floorId}:${Math.floor(cell.x/radius)}:${Math.floor(cell.y/radius)}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(id);}
  function footprint(b){const list=[],floor=floors.get(b.floorId),p=point(b),cx=Math.floor(p.x/radius),cy=Math.floor(p.y/radius);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const id of bins.get(`${b.floorId}:${cx+dx}:${cy+dy}`)||[])if(Math.hypot(points[id].x-p.x,points[id].y-p.y)<=radius&&visibleGeometrySegment(p,points[id],floor))list.push(id);return list;}
  const candidates=[],warnings=[],seen=new Set();
  // Candidates follow actual polygon edges/corners, never a beacon placement grid.
  candidateSearch: for(const [floorId,floor] of floors)for(const [polygonIndex,polygon] of floor.walkableAreas.entries())for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],length=Math.hypot(b.x-a.x,b.y-a.y),segments=Math.max(1,Math.ceil(length/(settings.spacing??5.5)));
    for(let j=0;j<segments;j++)for(const sign of [-1,1]){
      if(candidates.length>=2000)break candidateSearch;
      const p={x:a.x+(b.x-a.x)*j/segments-sign*(b.y-a.y)/length*settings.mountingInset,y:a.y+(b.y-a.y)*j/segments+sign*(b.x-a.x)/length*settings.mountingInset};
      if(geometryConflict(p,floor))continue;const key=`${floorId}:${p.x.toFixed(3)}:${p.y.toFixed(3)}`;if(seen.has(key))continue;seen.add(key);
      const ref=referenceBeacon({floorId,worldX:p.x,worldY:p.y},graph);if(!ref.edgeId)continue;
      const edge=edgeContexts.get(ref.edgeId),strategy=floor.walkableRegionMetadata?.[polygonIndex]?.category==='Food Court'?'Food Court':edge?.classification==='open-area'?'Atrium':'Wide Corridor';
      const sourceEdge=sourceEdges.get(ref.edgeId),na=nodes.get(sourceEdge.source),nb=nodes.get(sourceEdge.target),scale=Number(settings.metersPerPixel)||sourceEdge.distance/Math.hypot(nb.x-na.x,nb.y-na.y);
      const candidate={...ref,x:p.x/scale,y:p.y/scale,type:'Navigation',origin:'automatic',enabled:true,placementRole:'area',placementStrategy:strategy,profileId:profile.id,coverageRadius:profile.coverageRadius,reliableRadius:radius,walkablePolygonIds:[floor.walkableRegionMetadata?.[polygonIndex]?.id||`${floorId}:walkable-${polygonIndex+1}`]};
      if(!nearbyVisibleBeacon(beacons,candidate,floors,Math.min(settings.minimumSpacing??5,automaticBeaconSeparationMeters)))candidates.push({beacon:candidate,footprint:footprint(candidate)});
    }
  }
  if(candidates.length>=2000)warnings.push({code:'topology-candidate-limit',message:'Perimeter candidates capped at 2,000; remaining uncovered area requires review.'});
  let covered=counts.filter(n=>n>0).length,added=0;const extras=[];
  // ponytail: bounded greedy set cover (2,000 candidates, 200 additions); no global minimum claim.
  while(points.length&&100*covered/points.length<target&&added<settings.additionalBeaconBudget){
    let best=null,gain=0;for(const candidate of candidates){if(candidate.used||nearbyVisibleBeacon(extras.map(c=>c.beacon),candidate.beacon,floors,Math.min(settings.minimumSpacing??5,automaticBeaconSeparationMeters)))continue;const value=candidate.footprint.reduce((sum,id)=>sum+(counts[id]===0),0);if(value>gain){gain=value;best=candidate;}}
    if(!best||gain===0)break;best.used=true;for(const id of best.footprint){if(counts[id]===0)covered++;counts[id]++;}extras.push({...best,beacon:{...best.beacon,id:`area-beacon-${++added}`}});
  }
  let removed=0;for(let i=extras.length-1;i>=0;i--){const candidate=extras[i];if(candidate.footprint.every(id=>counts[id]>1)){for(const id of candidate.footprint)counts[id]--;extras.splice(i,1);removed++;}}
  const achieved=points.length?100*covered/points.length:0;if(achieved<target)warnings.push({code:'topology-target-unmet',message:`Topology planning achieved ${achieved.toFixed(1)}% sampled area coverage; target ${target}%. Review geometry, radius and additional-beacon budget.`});
  return {beacons:[...beacons,...extras.map(c=>c.beacon)],warnings,statistics:{routeBeacons:beacons.length,areaBeacons:extras.length,added,removed,sampledCoveragePercent:achieved,sampleCellSize:coverage.resolution.cellSize,candidates:candidates.length,additionalBeaconBudget:settings.additionalBeaconBudget}};
}
