import {compileFloorGeometry,geometryConflict,nearestValidGraphPosition,validGraphIntervals,visibleGeometrySegment} from "./floorGeometry.js";
import {deploymentQuality} from "./deploymentQuality.js";
import {placeByTopology,referenceBeacon,automaticBeaconSeparationMeters} from './topologyPlacement.js';
import {analyzeCoverage} from './coverage.js';
export const defaultBeaconSpacingMeters = 5.5;
// Planning assumptions, not manufacturer-certified RF specifications.
export const BEACON_PROFILES = ["Ceiling", "Wall", "Outdoor"].map(mountType => ({
  id: `iw-${mountType.toLowerCase()}`, modelName: `IW ${mountType} Beacon`, mountType,
  installationType: mountType === "Outdoor" ? "Pole" : mountType,
  recommendedHeight: mountType === "Wall" ? 2.5 : 3,
  defaultBeaconSpacing: 5.5, coverageRadius: 6, rssiPlanningThreshold: -75,
  advertisementInterval: 500, txPower: 0,
  notes: "Editable planning assumptions. Confirm hardware specifications and site conditions before deployment.",
}));
const important = new Set(["Lift","Escalator","Stairs","Entrance","Exit","Room Entrance","Junction"]);
const anchorTypes = new Set(["Lift","Escalator","Stairs","Entrance","Exit"]);
const key = (floor,x,y,size) => `${floor}:${Math.floor(x/size)}:${Math.floor(y/size)}`;
const distance = (a,b) => Math.hypot(a.worldX-b.worldX,a.worldY-b.worldY);

function inputGraph(graph) {
  const list=graph.nodes instanceof Map?[...graph.nodes.values()]:graph.nodes||[],edges=graph.edges instanceof Map?[...graph.edges.values()]:graph.edges||[];
  if(list.some(n=>!n.id||!n.floorId)||new Set(list.map(n=>n.id)).size!==list.length||edges.some(e=>!e.id)||new Set(edges.map(e=>e.id)).size!==edges.length)throw new Error("Graph node/edge IDs must be unique and nodes require a floor ID.");
  return { nodes: graph.nodes instanceof Map ? graph.nodes : new Map(list.map(n=>[n.id,n])), edges };
}
export function validatePlacementGraph(graph) {
  const {nodes,edges}=inputGraph(graph);
  if([...nodes.values()].some(n=>![n.x,n.y,n.worldX,n.worldY].every(Number.isFinite)))throw new Error("Graph coordinates must be finite.");
  for(const edge of edges){if(edge.source===edge.target||!nodes.has(edge.source)||!nodes.has(edge.target)||!Number.isFinite(edge.distance)||!(edge.distance>0))throw new Error("Graph contains an invalid edge or self-loop.");const a=nodes.get(edge.source),b=nodes.get(edge.target),measured=distance(a,b);if(a.floorId===b.floorId&&(measured<1e-7||Math.abs(measured-edge.distance)>Math.max(.001,measured*.001)))throw new Error(`Edge ${edge.id}: distance does not match its straight-line geometry. Correct the graph before placing beacons.`);}
  return {nodes,edges};
}
export function snapBeaconToGraph(beacon, graph, maximumDistance = Infinity) {
  const {nodes,edges}=inputGraph(graph); let nearest=null,best=maximumDistance;
  for(const edge of edges) {
    const a=nodes.get(edge.source),b=nodes.get(edge.target);
    if (!a || !b || a.floorId!==b.floorId || a.floorId!==beacon.floorId) continue;
    const dx=b.worldX-a.worldX,dy=b.worldY-a.worldY,den=dx*dx+dy*dy;
    if (!den) continue;
    const t=Math.max(0,Math.min(1,((beacon.worldX-a.worldX)*dx+(beacon.worldY-a.worldY)*dy)/den));
    const wx=a.worldX+t*dx,wy=a.worldY+t*dy,d=Math.hypot(wx-beacon.worldX,wy-beacon.worldY);
    if(d<=best){best=d;nearest={...beacon,x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y),worldX:wx,worldY:wy,edgeId:edge.id,edgeOffset:t*edge.distance};}
  }
  return nearest || beacon;
}

export function planBeacons({ graph, floorGeometry = {}, profile = BEACON_PROFILES[0], placementRules = {}, configuration = {}, pois=[] }) {
  const {nodes,edges}=validatePlacementGraph(graph);
  const floors=compileFloorGeometry(floorGeometry);
  const spacing=Number(configuration.spacing ?? profile.defaultBeaconSpacing);
  const minimum=Number(placementRules.minimumSpacing ?? 5),maximum=Number(placementRules.maximumSpacing ?? 6);
  if(![spacing,minimum,maximum].every(Number.isFinite)||spacing<minimum||spacing>maximum||minimum<=0||maximum<minimum) throw new Error("Spacing must be within the configured 5–6 m planning range.");
  if(!Number.isFinite(Number(profile.coverageRadius))||profile.coverageRadius<=0) throw new Error("Coverage radius must be positive.");
  if(!Number.isFinite(Number(profile.recommendedHeight))||profile.recommendedHeight<=0)throw new Error("Mounting height must be positive.");
  if(!["Ceiling","Wall","Pole","Outdoor"].includes(profile.mountType))throw new Error("Choose Ceiling, Wall or Pole mounting.");
  if(!Number.isFinite(Number(profile.rssiPlanningThreshold)))throw new Error("RSSI planning threshold must be finite.");
  const incident=new Map([...nodes.keys()].map(id=>[id,[]]));
  for(const edge of edges){incident.get(edge.source).push(edge);incident.get(edge.target).push(edge);}
  const beacons=[]; const nodeBeacons=new Map(); const cells=new Map(); const dedup=placementRules.duplicateTolerance ?? .25;
  if(!(dedup>0)||!Number.isFinite(dedup))throw new Error("Duplicate tolerance must be positive.");
  function add(input) {
    const cx=Math.floor(input.worldX/dedup),cy=Math.floor(input.worldY/dedup);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const existing of cells.get(`${input.floorId}:${cx+dx}:${cy+dy}`)||[]){
      if(distance(existing,input)<=dedup){if(input.nodeId){nodeBeacons.set(input.nodeId,existing);existing.anchorNodeIds=[...new Set([...(existing.anchorNodeIds||[]),existing.nodeId,input.nodeId].filter(Boolean))];}return existing;}
    }
    const beacon={profileId:profile.id,type:"Navigation",enabled:true,origin:"automatic",...input,id:`beacon-${beacons.length+1}`};
    beacons.push(beacon);const bucket=key(input.floorId,input.worldX,input.worldY,dedup);if(!cells.has(bucket))cells.set(bucket,[]);cells.get(bucket).push(beacon);if(input.nodeId)nodeBeacons.set(input.nodeId,beacon);return beacon;
  }
  const requiredAnchors=[];
  for(const node of nodes.values()) {
    const degree=incident.get(node.id).length;
    const transition=incident.get(node.id).some(e=>nodes.get(e.source).floorId!==nodes.get(e.target).floorId);
    const anchor=(placementRules.anchorTypes?placementRules.anchorTypes.includes(node.type):anchorTypes.has(node.type))||(placementRules.junctionAnchors!==false&&degree>=3)||transition||node.metadata?.anchorRequired||["Food Court","Atrium","Main Entrance","Major Exit"].includes(node.metadata?.category);
    if(anchor)requiredAnchors.push(node.id);
    if(anchor||important.has(node.type)||degree<=1) add({...node,type:"Navigation",nodeId:node.id});
  }
  // Walk degree-two corridor chains so intermediate graph sampling does not create extra beacons.
  const visited=new Set(); const edgeChains=[];
  function walk(startNode,first) {
    const chain=[];let current=startNode,edge=first;
    while(edge&&!visited.has(edge.id)){
      visited.add(edge.id);const next=edge.source===current?edge.target:edge.source;
      chain.push({edge,from:current,to:next});current=next;
      if(nodeBeacons.has(current))break;
      edge=incident.get(current).find(e=>!visited.has(e.id));
    }
    return chain;
  }
  if(configuration.mode!=="manual") {
    for(const nodeId of nodeBeacons.keys())for(const edge of incident.get(nodeId))if(!visited.has(edge.id))edgeChains.push(walk(nodeId,edge));
    for(const edge of edges)if(!visited.has(edge.id)){const a=nodes.get(edge.source);add({...a,nodeId:a.id});edgeChains.push(walk(a.id,edge));}
    for(const chain of edgeChains){
      const sameFloor=chain.filter(s=>nodes.get(s.from).floorId===nodes.get(s.to).floorId);
      const total=sameFloor.reduce((sum,s)=>sum+s.edge.distance,0);
      const least=Math.ceil(total/maximum),most=Math.floor(total/minimum);
      const count=Math.max(1,least<=most?Math.max(least,Math.min(most,Math.round(total/spacing))):Math.round(total/spacing));
      let segmentIndex=0,offset=0;
      for(let i=1;i<count;i++){
        const at=i*total/count;
        while(segmentIndex<sameFloor.length-1&&offset+sameFloor[segmentIndex].edge.distance<at){offset+=sameFloor[segmentIndex++].edge.distance;}
        const segment=sameFloor[segmentIndex];if(!segment)continue;
        const a=nodes.get(segment.from),b=nodes.get(segment.to),t=(at-offset)/segment.edge.distance;
        add({floorId:a.floorId,x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y),worldX:a.worldX+t*(b.worldX-a.worldX),worldY:a.worldY+t*(b.worldY-a.worldY),edgeId:segment.edge.id,edgeOffset:segment.edge.source===a.id?t*segment.edge.distance:(1-t)*segment.edge.distance});
      }
    }
  }
  const topologyResult=configuration.placementStrategy==='centerline'||configuration.beacons!==undefined||configuration.mode==='manual'?null:placeByTopology({graph,floors,beacons,profile,pois,settings:{...placementRules,...configuration,metersPerPixel:floorGeometry.metersPerPixel}});
  const submitted=configuration.beacons !== undefined ? configuration.beacons : configuration.mode==="manual" ? [] : topologyResult?.beacons||beacons;
  const geometryWarnings=[],final=[],finalBins=new Map();let failures=0;
  const finalTolerance=configuration.placementStrategy==='centerline'?dedup:Math.min(minimum,automaticBeaconSeparationMeters);
  for(const floorId of new Set([...nodes.values()].map(n=>n.floorId))){const floor=floors.get(floorId);if(!floor?.boundaries.length||(!floor.walkableAreas.length&&!floor.walkablePaths.length))geometryWarnings.push({code:"incomplete-geometry",floorId,message:`${floorId}: draw an explicit building boundary and walkable area/path before generating a deployment.`});}
  const submittedIds=new Set(),edgeLookup=new Map(edges.map(e=>[e.id,e]));
  for(const original of submitted) {
    if(!original.id||submittedIds.has(original.id))throw new Error("Beacon IDs must be present and unique.");submittedIds.add(original.id);
    if(![original.x,original.y,original.worldX,original.worldY].every(Number.isFinite))throw new Error("Beacon coordinates must be finite.");
    let beacon={type:"Navigation",enabled:true,installationType:profile.mountType==="Outdoor"?"Pole":profile.mountType,mountingHeight:profile.recommendedHeight,orientation:null,notes:"",installationStatus:"Planned",...original,coverageRadius:profile.coverageRadius,profileId:profile.id};
    if(!["Navigation","Anchor"].includes(beacon.type))throw new Error("Invalid beacon type.");
    beacon.type="Navigation";
    if(!["Ceiling","Wall","Pole"].includes(beacon.installationType)||!(beacon.mountingHeight>0)||!Number.isFinite(Number(beacon.mountingHeight)))throw new Error("Invalid beacon installation type or mounting height.");
    if(beacon.orientation!==null&&!Number.isFinite(Number(beacon.orientation)))throw new Error("Orientation must be finite or unset.");
    const attachedNode=nodes.get(beacon.nodeId),attachedEdge=edgeLookup.get(beacon.edgeId);
    const nodeMatches=attachedNode&&attachedNode.floorId===beacon.floorId&&distance(beacon,attachedNode)<1e-7;
    let edgeMatches=false;
    if(attachedEdge){const a=nodes.get(attachedEdge.source),b=nodes.get(attachedEdge.target),t=beacon.edgeOffset/attachedEdge.distance;edgeMatches=a.floorId===beacon.floorId&&b.floorId===beacon.floorId&&t>=0&&t<=1&&Math.hypot(beacon.worldX-a.worldX-t*(b.worldX-a.worldX),beacon.worldY-a.worldY-t*(b.worldY-a.worldY))<1e-7;}
    if(configuration.placementStrategy!=='centerline'&&!geometryConflict({x:beacon.worldX,y:beacon.worldY},floors.get(beacon.floorId)))beacon=referenceBeacon(beacon,{nodes,edges});
    if(configuration.placementStrategy==='centerline'&&beacon.enabled!==false&&!nodeMatches&&!edgeMatches) {
      const snapped=nearestValidGraphPosition(beacon,{nodes,edges},floors);
      if(!snapped){failures++;geometryWarnings.push({code:"geometry-rejected",beaconId:beacon.id,message:`${beacon.id}: no valid graph attachment; beacon omitted.`});continue;}
      beacon=snapped;
      if(distance(original,beacon)>1e-6)geometryWarnings.push({code:"geometry-relocated",beaconId:beacon.id,message:`${beacon.id} snapped ${distance(original,beacon).toFixed(2)} m onto a valid graph position.`});
    }
    const conflict=geometryConflict({x:beacon.worldX,y:beacon.worldY},floors.get(beacon.floorId));
    if(conflict&&beacon.enabled!==false) {
      const moved=nearestValidGraphPosition(beacon,{nodes,edges},floors);
      if(!moved){failures++;geometryWarnings.push({code:"geometry-rejected",beaconId:beacon.id,message:`${beacon.id}: ${conflict}; no valid same-floor graph position. Beacon omitted.`});continue;}
      beacon=moved;geometryWarnings.push({code:"geometry-relocated",beaconId:beacon.id,message:`${beacon.id} moved ${distance(original,beacon).toFixed(2)} m to resolve ${conflict}.`});
    }
    if(configuration.beacons===undefined){let duplicate=null;const cx=Math.floor(beacon.worldX/finalTolerance),cy=Math.floor(beacon.worldY/finalTolerance);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const b of finalBins.get(`${beacon.floorId}:${cx+dx}:${cy+dy}`)||[])if(distance(b,beacon)<finalTolerance-1e-6&&visibleGeometrySegment({x:b.worldX,y:b.worldY},{x:beacon.worldX,y:beacon.worldY},floors.get(beacon.floorId)))duplicate=b;if(duplicate){duplicate.anchorNodeIds=[...new Set([...(duplicate.anchorNodeIds||[]),duplicate.nodeId,duplicate.anchorNodeId,beacon.nodeId,beacon.anchorNodeId].filter(Boolean))];geometryWarnings.push({code:"relocation-deduplicated",message:`${beacon.id} merged with ${duplicate.id} after relocation.`});continue;}const bucket=key(beacon.floorId,beacon.worldX,beacon.worldY,finalTolerance);if(!finalBins.has(bucket))finalBins.set(bucket,[]);finalBins.get(bucket).push(beacon);}
    final.push(beacon);
  }
  const result=analyzePlacement({graph,beacons:final,profile,placementRules:{...placementRules,minimumSpacing:minimum,maximumSpacing:maximum},requiredAnchors,floors,geometryFailures:failures});
  result.warnings.push(...geometryWarnings,...result.quality.warnings);result.statistics.warnings=result.warnings.length;
  if(configuration.placementStrategy!=='centerline'){
    const coverage=analyzeCoverage({graph,floorGeometry,compiledFloors:floors,beacons:final,profile,placementQuality:result.quality,configuration:{...configuration,coverageThreshold:'reliable'}});
    result.coverage={method:coverage.method,estimatedPercent:coverage.graphCoveragePercentage,coveredLength:coverage.graphCoveredLength,totalLength:coverage.totalGraphLength,edges:coverage.graphEdges};result.quality=coverage.quality;
    result.warnings=result.warnings.filter(w=>w.code!=='uncovered-edge');result.warnings.push(...(topologyResult?.warnings||[]),...coverage.warnings);result.statistics.warnings=result.warnings.length;
  }
  return {...result,topology:topologyResult?.topology,configuration:{mode:configuration.mode||"automatic",spacing,placementStrategy:configuration.placementStrategy||'topology'},geometryValidation:{rejected:failures,relocated:geometryWarnings.filter(w=>w.code==="geometry-relocated").length}};
}

export function analyzePlacement({graph,beacons,profile=BEACON_PROFILES[0],placementRules={},requiredAnchors=[],floors=new Map(),geometryFailures=0}) {
  const {nodes,edges}=inputGraph(graph);const warnings=[];const active=beacons.filter(b=>b.enabled!==false);const minimum=placementRules.minimumSpacing??5,maximum=placementRules.maximumSpacing??6;
  if(!nodes.size)warnings.push({code:"empty-graph",message:"Create a navigation graph before generating beacons."});
  const byEdge=new Map(),byNode=new Map();
  for(const beacon of active){if(beacon.placementRole==='area')continue;if(beacon.nodeId)byNode.set(beacon.nodeId,beacon);else if(beacon.edgeId){if(!byEdge.has(beacon.edgeId))byEdge.set(beacon.edgeId,[]);byEdge.get(beacon.edgeId).push(beacon);}}
  const adjacency=new Map([...nodes.keys()].map(id=>[id,[]]));for(const e of edges){adjacency.get(e.source)?.push(e);adjacency.get(e.target)?.push(e);}
  const samples=[];let totalLength=0,coveredLength=0;const edgeCoverage=[];
  // Coverage here is graph-distance proximity, not RF propagation or wall penetration.
  const nodeDistances=new Map();const queue=[];const edgeById=new Map(edges.map(e=>[e.id,e]));
  const validEdges=new Map(edges.map(e=>{const a=nodes.get(e.source),b=nodes.get(e.target);return [e.id,a&&b&&a.floorId===b.floorId?validGraphIntervals({x:a.worldX,y:a.worldY},{x:b.worldX,y:b.worldY},floors.get(a.floorId)):[]];}));
  let geometryBlockedEdges=0;for(const edge of edges){const a=nodes.get(edge.source),b=nodes.get(edge.target);if(a.floorId===b.floorId&&validEdges.get(edge.id).reduce((sum,[lo,hi])=>sum+hi-lo,0)<1-1e-7){geometryBlockedEdges++;warnings.push({code:"graph-geometry-conflict",edgeId:edge.id,message:`Edge ${edge.id} crosses blocked, non-walkable or outside-building geometry. Correct the graph before deployment.`});}}
  for(const b of active){if(b.nodeId){nodeDistances.set(b.nodeId,0);queue.push([b.nodeId,0]);}else if(b.edgeId){const e=edgeById.get(b.edgeId);if(e){const t=b.edgeOffset/e.distance,intervals=validEdges.get(e.id);if(intervals.some(([lo,hi])=>lo<1e-7&&hi>=t))queue.push([e.source,b.edgeOffset]);if(intervals.some(([lo,hi])=>hi>1-1e-7&&lo<=t))queue.push([e.target,e.distance-b.edgeOffset]);}}}
  // Bounded propagation is enough for a radius estimate and avoids a whole-graph shortest-path per beacon.
  for(let i=0;i<queue.length;i++){const [nodeId,d]=queue[i];if(d>profile.coverageRadius || d>(nodeDistances.get(nodeId)??Infinity))continue;nodeDistances.set(nodeId,d);for(const e of adjacency.get(nodeId)||[]){if(validEdges.get(e.id).reduce((s,[a,b])=>s+b-a,0)<1-1e-7)continue;const next=e.source===nodeId?e.target:e.source,nd=d+e.distance;if(nd<=profile.coverageRadius&&nd<(nodeDistances.get(next)??Infinity)){nodeDistances.set(next,nd);queue.push([next,nd]);}}}
  for(const edge of edges){
    const a=nodes.get(edge.source),b=nodes.get(edge.target);if(!a||!b||a.floorId!==b.floorId)continue;
    const positions=(byEdge.get(edge.id)||[]).map(b=>b.edgeOffset).filter(Number.isFinite);
    if(byNode.has(a.id))positions.push(0);if(byNode.has(b.id))positions.push(edge.distance);
    positions.sort((a,b)=>a-b);
    const intervals=[];
    for(const p of positions)for(const [lo,hi] of validEdges.get(edge.id))if(p>=lo*edge.distance-1e-7&&p<=hi*edge.distance+1e-7)intervals.push([Math.max(lo*edge.distance,p-profile.coverageRadius),Math.min(hi*edge.distance,p+profile.coverageRadius)]);
    const da=nodeDistances.get(a.id),db=nodeDistances.get(b.id);
    if(da!==undefined&&da<profile.coverageRadius)for(const [lo,hi] of validEdges.get(edge.id))if(lo<1e-7)intervals.push([0,Math.min(hi*edge.distance,profile.coverageRadius-da)]);
    if(db!==undefined&&db<profile.coverageRadius)for(const [lo,hi] of validEdges.get(edge.id))if(hi>1-1e-7)intervals.push([Math.max(lo*edge.distance,edge.distance-(profile.coverageRadius-db)),edge.distance]);
    const clipped=[];for(const [start,finish] of intervals)for(const [lo,hi] of validEdges.get(edge.id)){const s=Math.max(start,lo*edge.distance),f=Math.min(finish,hi*edge.distance);if(f>s)clipped.push([s,f]);}
    clipped.sort((a,b)=>a[0]-b[0]);let covered=0,end=0;for(const [start,finish] of clipped){covered+=Math.max(0,finish-Math.max(start,end));end=Math.max(end,finish);}
    coveredLength+=covered;totalLength+=edge.distance;edgeCoverage.push({edgeId:edge.id,length:edge.distance,coveredLength:covered});
    if(covered<edge.distance-1e-6)warnings.push({code:"uncovered-edge",edgeId:edge.id,message:`Edge ${edge.id} has ${(edge.distance-covered).toFixed(2)} m outside the planning radius.`});
  }
  const walked=new Set();
  function inspectChain(start,first){let current=start,edge=first,length=0;const positions=[];const located=[];if(byNode.has(start)){positions.push(0);located.push({offset:0,beacon:byNode.get(start)});}
    while(edge&&!walked.has(edge.id)){
      walked.add(edge.id);const forward=edge.source===current,next=forward?edge.target:edge.source;
      if(nodes.get(current).floorId!==nodes.get(next).floorId)break;
      for(const beacon of byEdge.get(edge.id)||[]){const offset=length+(forward?beacon.edgeOffset:edge.distance-beacon.edgeOffset);positions.push(offset);located.push({offset,beacon});}
      length+=edge.distance;if(byNode.has(next)){positions.push(length);located.push({offset:length,beacon:byNode.get(next)});}
      current=next;if((adjacency.get(current)||[]).length!==2||byNode.has(current))break;
      edge=adjacency.get(current).find(e=>!walked.has(e.id));
    }
    located.sort((a,b)=>a.offset-b.offset);positions.sort((a,b)=>a-b);for(let i=1;i<positions.length;i++){const gap=positions[i]-positions[i-1],a=located[i-1].beacon,b=located[i].beacon,location={floorId:a.floorId,x:(a.x+b.x)/2,y:(a.y+b.y)/2,beaconIds:[a.id,b.id]};samples.push(gap);if(gap<minimum-1e-6)warnings.push({code:"spacing-too-small",...location,message:`Spacing ${gap.toFixed(2)} m is below ${minimum} m.`});if(gap>maximum+1e-6)warnings.push({code:"spacing-too-large",...location,message:`Spacing ${gap.toFixed(2)} m exceeds ${maximum} m.`});}
  }
  for(const nodeId of nodes.keys())if(byNode.has(nodeId)||(adjacency.get(nodeId)||[]).length!==2)for(const edge of adjacency.get(nodeId)||[])if(!walked.has(edge.id))inspectChain(nodeId,edge);
  for(const edge of edges)if(!walked.has(edge.id))inspectChain(edge.source,edge);
  let anchorsPresent=0;
  const anchorsByNode=new Map();for(const b of active)for(const id of new Set([b.nodeId,b.anchorNodeId,...(b.anchorNodeIds||[])].filter(Boolean))){if(!anchorsByNode.has(id))anchorsByNode.set(id,[]);anchorsByNode.get(id).push(b);}
  for(const nodeId of requiredAnchors){const node=nodes.get(nodeId);const present=(anchorsByNode.get(nodeId)||[]).some(b=>b.floorId===node.floorId&&distance(b,node)<=(placementRules.anchorTolerance??b.reliableRadius??profile.coverageRadius)&&visibleGeometrySegment({x:b.worldX,y:b.worldY},{x:node.worldX,y:node.worldY},floors.get(node.floorId)));if(present)anchorsPresent++;else warnings.push({code:"missing-anchor",nodeId,message:`Uncovered navigation landmark ${nodeId}.`});}
  const bins=new Map();for(const b of active){const size=placementRules.duplicateTolerance??.25,cx=Math.floor(b.worldX/size),cy=Math.floor(b.worldY/size);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const other of bins.get(`${b.floorId}:${cx+dx}:${cy+dy}`)||[])if(distance(b,other)<size)warnings.push({code:"duplicate-beacons",beaconIds:[b.id,other.id],message:"Duplicate beacon positions."});const k=key(b.floorId,b.worldX,b.worldY,size);if(!bins.has(k))bins.set(k,[]);bins.get(k).push(b);}
  const seen=new Set();let components=0,largestComponent=0;for(const nodeId of nodes.keys())if(!seen.has(nodeId)){components++;let size=0;const stack=[nodeId];seen.add(nodeId);while(stack.length){size++;for(const edge of adjacency.get(stack.pop())||[]){const next=seen.has(edge.source)?edge.target:edge.source;if(!seen.has(next)){seen.add(next);stack.push(next);}}}largestComponent=Math.max(largestComponent,size);}
  if(components>1)warnings.push({code:"disconnected-beacon-chain",message:`Navigation graph has ${components} disconnected components.`});
  const brokenLinks=samples.filter(g=>g>maximum+1e-6).length;if(brokenLinks)warnings.push({code:"disconnected-beacon-chain",message:`${brokenLinks} beacon chain link(s) exceed maximum spacing.`});
  coveredLength=Math.min(totalLength,coveredLength);const coverageScore=totalLength?Math.min(100,100*coveredLength/totalLength):0;
  const duplicateCount=new Set(warnings.filter(w=>w.code==="duplicate-beacons").map(w=>w.beaconIds[0])).size;
  const spacingScore=(samples.length?100*samples.filter(g=>g>=minimum-1e-6&&g<=maximum+1e-6).length/samples.length:active.length?100:0)*(active.length?1-duplicateCount/active.length:0);
  let quality=deploymentQuality({spacingScore,coverageScore,connectivityScore:nodes.size&&active.length?100*largestComponent/nodes.size*(samples.length?1-brokenLinks/samples.length:1)*(edges.length?1-geometryBlockedEdges/edges.length:1):0,anchorPlacementScore:requiredAnchors.length?100*anchorsPresent/requiredAnchors.length:active.length?100:0,geometryFailures});
  let coverage={method:"geometry-clipped-graph-distance-radius",estimatedPercent:coverageScore,coveredLength,totalLength,edges:edgeCoverage};
  const offCenter=active.some(b=>{if(b.placementRole==='area'||b.referenceDistance>1e-7)return true;const n=nodes.get(b.nodeId);if(n)return distance(b,n)>1e-7;const e=edgeById.get(b.edgeId);if(!e)return true;const a=nodes.get(e.source),z=nodes.get(e.target),t=b.edgeOffset/e.distance;return Math.hypot(b.worldX-a.worldX-t*(z.worldX-a.worldX),b.worldY-a.worldY-t*(z.worldY-a.worldY))>1e-7;});
  if(offCenter){
    const actual=analyzeCoverage({graph,floorGeometry:{},compiledFloors:floors,beacons,profile,configuration:{graphOnly:true,coverageThreshold:'reliable'}});
    coverage={method:actual.method,estimatedPercent:actual.graphCoveragePercentage,coveredLength:actual.graphCoveredLength,totalLength:actual.totalGraphLength,edges:actual.graphEdges};quality=deploymentQuality({...quality,coverageScore:actual.graphCoveragePercentage});
    for(let i=warnings.length-1;i>=0;i--)if(warnings[i].code==='uncovered-edge')warnings.splice(i,1);
    for(const gap of actual.gaps)warnings.push({code:'uncovered-edge',edgeId:gap.edgeId,message:`Edge ${gap.edgeId} has ${gap.length.toFixed(2)} m outside actual geometric coverage.`});
  }
  return {beacons,spacingSamples:samples,coverage,warnings,quality,statistics:{navigationBeacons:active.length,totalBeacons:active.length,disabledBeacons:beacons.length-active.length,averageSpacing:samples.length?samples.reduce((a,b)=>a+b,0)/samples.length:0,minimumSpacing:samples.length?samples.reduce((a,b)=>Math.min(a,b),Infinity):0,maximumSpacing:samples.length?samples.reduce((a,b)=>Math.max(a,b),-Infinity):0,warnings:warnings.length}};
}
