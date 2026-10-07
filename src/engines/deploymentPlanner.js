import { BEACON_PROFILES, planBeacons, analyzePlacement, snapBeaconToGraph, validatePlacementGraph } from "./beaconPlacement.js";
import { compileFloorGeometry, geometryConflict, nearestValidGraphPosition, segmentProjection, visibleGeometrySegment } from "./floorGeometry.js";
import { analyzeCoverage } from "./coverage.js";
import { deploymentQuality } from "./deploymentQuality.js";

export const DEFAULT_PLANNING_SETTINGS = {
  defaultProfileId: BEACON_PROFILES[0].id, spacing: 5.5, reliableRadius: 6, marginalRadius: 8,
  planningMode: "hybrid", coverageThreshold: "reliable", coverageTarget: 90,
  anchorTypes: ["Lift", "Escalator", "Stairs", "Entrance", "Exit"], junctionAnchors: true,
  wallClearance: .3, installationCost: 0, currency: "INR", cellSize: .5, beaconPrefix: "IW", nextBeaconNumber: 1,
};
const dist = (a,b) => Math.hypot(a.worldX-b.worldX,a.worldY-b.worldY);
const coverageFields = b => JSON.stringify([b.floorId,b.worldX,b.worldY,b.enabled,b.coverageRadius,b.reliableRadius,b.marginalRadius]);

export function validatePlanningSettings(settings, profiles) {
  if(typeof settings.beaconPrefix!=="string"||! /^[A-Za-z][A-Za-z0-9_-]{0,19}$/.test(settings.beaconPrefix))throw new Error("Beacon prefix must start with a letter and contain up to 20 letters, digits, underscores or hyphens.");
  if(!Number.isSafeInteger(settings.nextBeaconNumber)||settings.nextBeaconNumber<1)throw new Error("Invalid next beacon number.");
  if (!profiles.some(p=>p.id===settings.defaultProfileId)) throw new Error("Default beacon profile not found.");
  if (!Number.isFinite(settings.spacing)||!(settings.spacing>=5 && settings.spacing<=6)) throw new Error("Spacing must be 5–6 m.");
  for (const key of ["reliableRadius","marginalRadius","cellSize"]) if (!(settings[key]>0) || !Number.isFinite(settings[key])) throw new Error(`${key} must be positive and finite.`);
  if (settings.marginalRadius<settings.reliableRadius) throw new Error("Marginal radius must be at least the reliable radius.");
  if (!Number.isFinite(settings.installationCost)||settings.installationCost<0||!Number.isFinite(settings.wallClearance)||settings.wallClearance<0) throw new Error("Cost and wall clearance must be non-negative.");
  if (!Number.isFinite(settings.coverageTarget)||settings.coverageTarget<0||settings.coverageTarget>100) throw new Error("Coverage target must be 0–100%.");
  if (!["reliable","marginal","nominal"].includes(settings.coverageThreshold)||!["automatic","manual","hybrid"].includes(settings.planningMode)) throw new Error("Invalid planning mode or coverage threshold.");
  if (!Array.isArray(settings.anchorTypes)||settings.anchorTypes.some(t=>!BEACON_ANCHOR_TYPES.includes(t))) throw new Error("Invalid anchor rules.");
}
export const BEACON_ANCHOR_TYPES = ["Lift","Escalator","Stairs","Entrance","Exit","Room Entrance","Junction","Landmark"];

// Pure planning session: no React, DOM, storage or UI state. Caches are disposable.
export class DeploymentPlanner {
  constructor({graph,floorGeometry,profiles=BEACON_PROFILES,settings={},beacons=[],pois=[]}) {
    validatePlacementGraph(graph);
    for(const p of profiles)planBeacons({graph:{nodes:[],edges:[]},profile:p});
    this.graph=graph; this.floorGeometry=floorGeometry; this.floors=compileFloorGeometry(floorGeometry);
    this.profiles=profiles; this.settings={...DEFAULT_PLANNING_SETTINGS,...settings}; this.pois=pois;
    validatePlanningSettings(this.settings,profiles);
    this.nodes=new Map(graph.nodes.map(n=>[n.id,n])); this.edges=new Map(graph.edges.map(e=>[e.id,e]));this.regions=[]; this.nodeRegion=new Map(); this.results=new Map();
    this.adjacency=new Map(graph.nodes.map(n=>[n.id,[]]));
    for(const e of graph.edges){if(!this.nodes.has(e.source)||!this.nodes.has(e.target))throw new Error("Graph edge has a missing endpoint.");this.adjacency.get(e.source).push(e);this.adjacency.get(e.target).push(e);}
    const localLinks=id=>this.adjacency.get(id).filter(e=>this.nodes.get(e.source).floorId===this.nodes.get(e.target).floorId),walked=new Set();
    const boundary=id=>localLinks(id).length!==2||this.adjacency.get(id).length!==2;
    const addRegion=(start,first)=>{
      const ids=new Set([start]),edges=[];let current=start,edge=first;
      while(edge&&!walked.has(edge.id)){walked.add(edge.id);edges.push(edge);current=edge.source===current?edge.target:edge.source;ids.add(current);if(boundary(current))break;edge=localLinks(current).find(e=>!walked.has(e.id));}
      const region={id:`region-${this.regions.length}`,floorId:this.nodes.get(start).floorId,nodes:[...ids].map(id=>this.nodes.get(id)),edges};this.regions.push(region);
      for(const id of ids){if(!this.nodeRegion.has(id))this.nodeRegion.set(id,new Set());this.nodeRegion.get(id).add(region.id);}
    };
    for(const n of graph.nodes)if(boundary(n.id)){const links=localLinks(n.id);if(!links.length)addRegion(n.id);else for(const e of links)if(!walked.has(e.id))addRegion(n.id,e);}
    for(const e of graph.edges)if(!walked.has(e.id)&&this.nodes.get(e.source).floorId===this.nodes.get(e.target).floorId)addRegion(e.source,e);
    this.regionMap=new Map(this.regions.map(r=>[r.id,r]));this.members=new Map(this.regions.map(r=>[r.id,new Map()]));
    this.edgeRegion=new Map(this.regions.flatMap(r=>r.edges.map(e=>[e.id,r.id])));
    // Cross-floor links connect components, but never provide cross-floor radius coverage.
    const visited=new Set();let largest=0;
    for(const n of graph.nodes)if(!visited.has(n.id)){let count=0,stack=[n.id];visited.add(n.id);while(stack.length){count++;for(const e of this.adjacency.get(stack.pop())){const id=visited.has(e.source)?e.target:e.source;if(!visited.has(id)){visited.add(id);stack.push(id);}}}largest=Math.max(largest,count);}
    this.componentRatio=graph.nodes.length?largest/graph.nodes.length:0;
    this.beacons=beacons.map(b=>this.normalize(b));this.issuedIds=new Set(beacons.map(b=>b.id));
    for(const b of beacons){const suffix=b.id.startsWith(this.settings.beaconPrefix)?b.id.slice(this.settings.beaconPrefix.length):"";if(/^\d+$/.test(suffix))this.settings.nextBeaconNumber=Math.max(this.settings.nextBeaconNumber,Number(suffix)+1);}
    this.evaluate();
  }
  allocateId(){
    let number=this.settings.nextBeaconNumber,id;
    do{if(!Number.isSafeInteger(number+1))throw new Error("Beacon numbering limit reached.");id=`${this.settings.beaconPrefix}${String(number++).padStart(3,"0")}`;}while(this.issuedIds.has(id));
    this.issuedIds.add(id);this.settings={...this.settings,nextBeaconNumber:number};return id;
  }
  profile(id){const p=this.profiles.find(p=>p.id===id);if(!p)throw new Error(`Unknown beacon profile: ${id}`);return p;}
  normalize(b){
    const p=this.profile(b.profileId||this.settings.defaultProfileId);
    const next={type:"Navigation",enabled:true,locked:false,installationType:p.installationType||(p.mountType==="Outdoor"?"Pole":p.mountType),mountingHeight:p.recommendedHeight,notes:"",installationStatus:"Planned",...b,profileId:p.id,coverageRadius:b.coverageRadius??p.coverageRadius,reliableRadius:b.reliableRadius??this.settings.reliableRadius,marginalRadius:b.marginalRadius??this.settings.marginalRadius};
    if(!next.id||!next.floorId||![next.x,next.y,next.worldX,next.worldY,next.coverageRadius,next.reliableRadius,next.marginalRadius,next.mountingHeight].every(Number.isFinite))throw new Error("Beacon IDs, floor and finite coordinates/radii/height are required.");
    if(!["Navigation","Anchor"].includes(next.type)||!["Ceiling","Wall","Pole"].includes(next.installationType)||Math.min(next.coverageRadius,next.reliableRadius,next.marginalRadius,next.mountingHeight)<=0||next.marginalRadius<next.reliableRadius)throw new Error("Invalid beacon type, mounting or radii.");
    if(next.orientation!=null&&!Number.isFinite(next.orientation))throw new Error("Orientation must be finite or unset.");
    if(typeof next.enabled!=="boolean"||typeof next.locked!=="boolean")throw new Error("Enabled and locked must be boolean.");
    return next;
  }
  regionsFor(b){return this.nodeRegion.get(b.nodeId)||new Set([this.edgeRegion.get(b.edgeId)||this.regions.find(r=>r.floorId===b.floorId)?.id].filter(Boolean));}
  attached(b){const n=this.nodes.get(b.nodeId);if(n&&n.floorId===b.floorId&&dist(b,n)<1e-6)return true;const edge=this.edges.get(b.edgeId);if(!edge)return false;const a=this.nodes.get(edge.source),z=this.nodes.get(edge.target),t=b.edgeOffset/edge.distance;return a.floorId===b.floorId&&z.floorId===b.floorId&&t>=0&&t<=1&&Math.hypot(b.worldX-a.worldX-t*(z.worldX-a.worldX),b.worldY-a.worldY-t*(z.worldY-a.worldY))<1e-6;}
  requiredAnchors(){return this.graph.nodes.filter(n=>{const links=this.adjacency.get(n.id);return this.settings.anchorTypes.includes(n.type)||(this.settings.junctionAnchors&&links.length>=3)||links.some(e=>this.nodes.get(e.source).floorId!==this.nodes.get(e.target).floorId)||n.metadata?.anchorRequired||["Food Court","Atrium","Main Entrance","Major Exit"].includes(n.metadata?.category);}).map(n=>n.id);}
  evaluate(changed=null) {
    if(new Set(this.beacons.map(b=>b.id)).size!==this.beacons.length)throw new Error("Beacon IDs must be unique.");
    const start=performance.now(),required=this.requiredAnchors(),affected=changed?new Set(changed.flatMap(b=>[...this.regionsFor(b)])):new Set(this.regions.map(r=>r.id));
    const anchorBins=new Map();for(const id of required){const n=this.nodes.get(id),key=`${n.floorId}:${Math.floor(n.worldX)}:${Math.floor(n.worldY)}`;if(!anchorBins.has(key))anchorBins.set(key,[]);anchorBins.get(key).push(n);}
    const nearbyAnchors=b=>{const ids=[];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const n of anchorBins.get(`${b.floorId}:${Math.floor(b.worldX)+dx}:${Math.floor(b.worldY)+dy}`)||[])if(dist(b,n)<=1)ids.push(n.id);return ids;};
    if(!changed){for(const group of this.members.values())group.clear();for(const b of this.beacons)for(const id of this.regionsFor(b))this.members.get(id)?.set(b.id,b);}
    else {const byId=new Map(this.beacons.map(b=>[b.id,b]));for(const b of changed)for(const id of this.regionsFor(b))this.members.get(id)?.delete(b.id);for(const id of new Set(changed.map(b=>b.id))){const b=byId.get(id);if(b)for(const regionId of this.regionsFor(b))this.members.get(regionId)?.set(b.id,b);}}
    let recomputedRegions=0;
    for(const id of affected){const region=this.regionMap.get(id);if(!region)continue;
      const list=[...this.members.get(region.id).values()];
      const mapped=list.map(b=>b.type==="Anchor"?{...b,anchorNodeIds:[...new Set([...(b.anchorNodeIds||[]),...nearbyAnchors(b)])]}:b);
      const result=analyzePlacement({graph:region,beacons:mapped,profile:this.profile(this.settings.defaultProfileId),floors:this.floors});
      this.results.set(region.id,result);recomputedRegions++;
    }
    const parts=[...this.results.values()],samples=parts.flatMap(p=>p.spacingSamples),active=this.beacons.filter(b=>b.enabled!==false),warnings=parts.flatMap(p=>p.warnings.filter(w=>!["duplicate-beacons","disconnected-beacon-chain"].includes(w.code)));
    const present=new Set();for(const b of active)if(b.type==="Anchor")for(const id of nearbyAnchors(b))present.add(id);
    for(const id of required)if(!present.has(id))warnings.push({code:"missing-anchor",nodeId:id,message:`Missing anchor within 1 m of ${id}.`});
    const bins=new Map();for(const b of active){const x=Math.floor(b.worldX/.25),y=Math.floor(b.worldY/.25);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const other of bins.get(`${b.floorId}:${x+dx}:${y+dy}`)||[])if(dist(b,other)<.25)warnings.push({code:"duplicate-beacons",beaconIds:[b.id,other.id],message:"Duplicate beacon positions."});const key=`${b.floorId}:${x}:${y}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(b);}
    let geometryFailures=0;
    for(const b of this.beacons){const point={x:b.worldX,y:b.worldY},floor=this.floors.get(b.floorId),conflict=geometryConflict(point,floor);
      if(!this.attached(b)){if(b.enabled!==false)geometryFailures++;warnings.push({code:"off-graph",beaconId:b.id,message:`${b.id}: graph attachment is missing or stale. Recalculate this beacon.`});}
      if(conflict){if(b.enabled!==false)geometryFailures++;warnings.push({code:conflict,beaconId:b.id,message:`${b.id}: ${conflict}. ${b.locked?"Locked beacon was not moved.":"Move or recalculate this beacon."}`});}
      if(!conflict&&floor?.walls.some(w=>w.points.slice(1).some((end,i)=>segmentProjection(point,w.points[i],end).distance-w.width/2<this.settings.wallClearance)))warnings.push({code:"too-close-to-wall",beaconId:b.id,message:`${b.id} is within ${this.settings.wallClearance} m of a wall surface.`});
    }
    const duplicateIds=new Set(warnings.filter(w=>w.code==="duplicate-beacons").map(w=>w.beaconIds[0]));
    const brokenLinks=samples.filter(g=>g>6+1e-6).length,blocked=warnings.filter(w=>w.code==="graph-geometry-conflict").length,localEdgeCount=this.regions.reduce((sum,r)=>sum+r.edges.length,0);
    if(brokenLinks)warnings.push({code:"disconnected-beacon-chain",message:`${brokenLinks} beacon chain link(s) exceed maximum spacing.`});if(this.componentRatio<1)warnings.push({code:"disconnected-graph",message:"Navigation graph has disconnected components."});
    const quality=deploymentQuality({spacingScore:(samples.length?100*samples.filter(g=>g>=5-1e-6&&g<=6+1e-6).length/samples.length:active.length?100:0)*(active.length?1-duplicateIds.size/active.length:0),connectivityScore:active.length?100*this.componentRatio*(samples.length?1-brokenLinks/samples.length:1)*(localEdgeCount?1-blocked/localEdgeCount:1):0,anchorPlacementScore:required.length?100*present.size/required.length:active.length?100:0,geometryFailures});
    const currentById=new Map(this.beacons.map(b=>[b.id,b])),previousById=new Map((this.lastBeacons||[]).map(b=>[b.id,b]));
    const coverageChanges=changed?.filter(b=>{const now=currentById.get(b.id),old=previousById.get(b.id);return !now||!old||coverageFields(now)!==coverageFields(old);});
    const coverage=analyzeCoverage({graph:this.graph,floorGeometry:this.floorGeometry,compiledFloors:this.floors,beacons:this.beacons,profile:this.profile(this.settings.defaultProfileId),placementQuality:quality,configuration:this.settings,previous:this.coverage,changes:coverageChanges});
    if(coverage.totalArea&&coverage.coveragePercentage<this.settings.coverageTarget)warnings.push({code:"coverage-target",message:`Coverage ${coverage.coveragePercentage.toFixed(1)}% is below target ${this.settings.coverageTarget}%.`});
    const scale=this.floorGeometry.metersPerPixel||1;
    for(const gap of coverage.gaps)warnings.push({code:"coverage-gap",edgeId:gap.edgeId,floorId:gap.floorId,x:(gap.x1+gap.x2)/2,y:(gap.y1+gap.y2)/2,message:`${gap.edgeId}: ${gap.length.toFixed(2)} m coverage gap.`});
    const byId=new Map(this.beacons.map(b=>[b.id,b])),edgeById=new Map(this.graph.edges.map(e=>[e.id,e]));
    for(const w of warnings){const b=byId.get(w.beaconId||w.beaconIds?.[0]),n=this.nodes.get(w.nodeId),e=edgeById.get(w.edgeId),a=e&&this.nodes.get(e.source),z=e&&this.nodes.get(e.target);if(w.x===undefined){const source=b||n;if(source)Object.assign(w,{floorId:source.floorId,x:source.x,y:source.y});else if(a&&z)Object.assign(w,{floorId:a.floorId,x:(a.x+z.x)/2,y:(a.y+z.y)/2});}}
    warnings.push(...coverage.quality.warnings);
    const totalLength=parts.reduce((s,p)=>s+p.coverage.totalLength,0),coveredLength=parts.reduce((s,p)=>s+p.coverage.coveredLength,0);
    const plan={beacons:this.beacons,quality:coverage.quality,warnings,configuration:{mode:this.settings.planningMode,spacing:this.settings.spacing},geometryValidation:{rejected:0,relocated:0},coverage:{method:"geometry-clipped-graph-distance-radius",estimatedPercent:totalLength?100*coveredLength/totalLength:0,totalLength,coveredLength,edges:parts.flatMap(p=>p.coverage.edges)},statistics:{navigationBeacons:active.filter(b=>b.type!=="Anchor").length,anchorBeacons:active.filter(b=>b.type==="Anchor").length,totalBeacons:this.beacons.length,activeBeacons:active.length,disabledBeacons:this.beacons.length-active.length,averageSpacing:samples.length?samples.reduce((s,g)=>s+g,0)/samples.length:0,minimumSpacing:samples.reduce((s,g)=>Math.min(s,g),samples.length?Infinity:0),maximumSpacing:samples.reduce((s,g)=>Math.max(s,g),0),coveragePercent:coverage.coveragePercentage,deadZonePercent:coverage.totalArea?100*coverage.deadZoneArea/coverage.totalArea:0,overlapPercent:coverage.overlapPercentage,maximumGap:coverage.gaps.reduce((s,g)=>Math.max(s,g.length),0),minimumGap:coverage.gaps.reduce((s,g)=>Math.min(s,g.length),coverage.gaps.length?Infinity:0),deploymentQuality:coverage.quality.overallScore,installationCost:active.length*this.settings.installationCost,warnings:warnings.length}};
    this.coverage=coverage;this.lastBeacons=this.beacons.map(b=>({...b}));this.output={plan,coverage,settings:this.settings,work:{...coverage.work,recomputedRegions,regions:this.regions.length,elapsedMs:performance.now()-start},scale};return this.output;
  }
  edit(action,data={}) {
    if(!["insert","move","patch","delete","duplicate"].includes(action))throw new Error("Invalid beacon command.");
    const old=this.beacons.find(b=>b.id===data.id);if(action!=="insert"&&!old)throw new Error("Select a beacon first.");
    if(old?.locked&&["move","delete"].includes(action))throw new Error("Unlock the beacon before moving or deleting it.");
    let next;
    if(action==="delete"){this.beacons=this.beacons.filter(b=>b.id!==old.id);return this.evaluate([old]);}
    if(action==="duplicate"||action==="insert"){
      const newId=data.newId||this.allocateId();
      if(this.beacons.some(b=>b.id===newId))throw new Error("Beacon IDs must be unique.");
      const profile=this.profile(this.settings.defaultProfileId);
      next=this.normalize(action==="duplicate"?{...old,id:newId,locked:false,origin:"manual"}:{...data,id:newId,profileId:profile.id,origin:"manual"});
    }else {
      const allowed=["type","profileId","installationType","mountingHeight","orientation","notes","installationStatus","coverageRadius","reliableRadius","marginalRadius","enabled","locked"];
      if(action==="patch"&&Object.keys(data.patch||{}).some(key=>!allowed.includes(key)))throw new Error("Use Move to edit beacon position.");
      const position={floorId:data.floorId||old.floorId,x:data.x,y:data.y,worldX:data.worldX,worldY:data.worldY};
      next=this.normalize({...old,...(action==="move"?{...position,origin:"manual"}:data.patch),id:old.id});
    }
    if(action==="move"||action==="insert"){
      const snapped=nearestValidGraphPosition(next,this.graph,this.floors);if(!snapped)throw new Error("No valid graph position on this floor.");next=snapped;
    }
    this.beacons=action==="duplicate"||action==="insert"?[...this.beacons,next]:this.beacons.map(b=>b.id===old.id?next:b);
    return this.evaluate([...(old?[old]:[]),next]);
  }
  recalculate(scope="project",id) {
    if(!["selected","floor","project"].includes(scope))throw new Error("Invalid recalculation scope.");
    const selected=this.beacons.find(b=>b.id===id);
    if(scope!=="project"&&!selected)throw new Error("Select a beacon first.");
    const changed=[];this.beacons=this.beacons.map(b=>{
      if(b.locked||(scope==="selected"&&b.id!==id)||(scope==="floor"&&b.floorId!==selected.floorId))return b;
      const valid=this.attached(b)&&!geometryConflict({x:b.worldX,y:b.worldY},this.floors.get(b.floorId));
      const moved=valid?b:nearestValidGraphPosition(b,this.graph,this.floors)||b;changed.push(b,moved);return moved;
    });return this.evaluate(changed);
  }
  configure(patch) {
    const settings={...this.settings,...patch};validatePlanningSettings(settings,this.profiles);const oldSettings=this.settings;this.settings=settings;
    const before=this.beacons;
    try{this.beacons=this.beacons.map(b=>this.normalize({...b,...("reliableRadius" in patch?{reliableRadius:settings.reliableRadius}:{}),...("marginalRadius" in patch?{marginalRadius:settings.marginalRadius}:{})}));}catch(error){this.settings=oldSettings;throw error;}
    const placementChanged=["defaultProfileId","reliableRadius","marginalRadius","anchorTypes","junctionAnchors","wallClearance"].some(key=>key in patch);
    return this.evaluate(placementChanged?[...before,...this.beacons]:[]); // Reuse geometry/coverage for metadata-only settings.
  }
  generate() {
    const profile=this.profile(this.settings.defaultProfileId);
    if(this.settings.planningMode==="manual")return this.evaluate();
    const result=planBeacons({graph:this.graph,floorGeometry:this.floorGeometry,profile,placementRules:this.settings,configuration:{mode:this.settings.planningMode,spacing:this.settings.spacing}});
    const locked=this.beacons.filter(b=>b.locked),manual=this.settings.planningMode==="hybrid"?this.beacons.filter(b=>b.origin==="manual"&&!b.locked):[],preserved=[...locked,...manual],ids=new Set(preserved.map(b=>b.id));
    const positionKey=b=>`${b.floorId}:${b.worldX.toFixed(6)}:${b.worldY.toFixed(6)}`,existing=new Map(this.beacons.map(b=>[positionKey(b),b.id]));
    this.beacons=[...preserved,...result.beacons.filter(b=>!preserved.some(p=>p.floorId===b.floorId&&dist(p,b)<.25)).map(b=>{let id=existing.get(positionKey(b));if(!id||ids.has(id))id=this.allocateId();ids.add(id);return this.normalize({...b,id});})];return this.evaluate();
  }
  inspector(id) {
    const beacon=this.beacons.find(b=>b.id===id);if(!beacon)return null;
    const point={x:beacon.worldX,y:beacon.worldY},floor=this.floors.get(beacon.floorId),radius=beacon[this.settings.coverageThreshold==="reliable"?"reliableRadius":this.settings.coverageThreshold==="marginal"?"marginalRadius":"coverageRadius"];
    let contribution=0,footprint=0;
    if(beacon.enabled!==false&&!geometryConflict(point,floor))for(const cell of this.coverage.floorReports.find(f=>f.floorId===beacon.floorId)?.cells||[])if(Math.hypot(cell.x-point.x,cell.y-point.y)<=radius&&visibleGeometrySegment(point,cell,floor)){footprint+=this.coverage.resolution.cellSize**2;if(cell.count===1)contribution+=this.coverage.resolution.cellSize**2;}
    const nearestEdge=snapBeaconToGraph(beacon,this.graph),nearestPoi=this.pois.filter(p=>p.floorId===beacon.floorId).reduce((best,p)=>!best||dist(beacon,p)<dist(beacon,best)?p:best,null);
    return {...beacon,profileName:this.profile(beacon.profileId).modelName,nearestEdge:nearestEdge.edgeId?{id:nearestEdge.edgeId,distance:dist(beacon,nearestEdge)}:null,nearestPoi:nearestPoi?{id:nearestPoi.id,name:nearestPoi.name,distance:dist(beacon,nearestPoi)}:null,coverageContribution:contribution,coverageFootprint:footprint,warnings:this.output.plan.warnings.filter(w=>w.beaconId===id||w.beaconIds?.includes(id)||(w.code==="missing-anchor"&&w.floorId===beacon.floorId&&Math.hypot(w.x-beacon.x,w.y-beacon.y)*this.output.scale<=1))};
  }
}
