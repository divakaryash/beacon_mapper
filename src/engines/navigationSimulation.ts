import { NavigationGraph } from './navigationGraph.js';
import { validatePlacementGraph } from './beaconPlacement.js';
import { compileFloorGeometry, geometryConflict, visibleGeometrySegment, validGraphIntervals } from './floorGeometry.js';

export interface Node {id:string;floorId:string;x:number;y:number;worldX:number;worldY:number;type:string;metadata?:Record<string,unknown>}
export interface Edge {id:string;source:string;target:string;distance:number;edgeType:string;direction:string;accessibility:boolean}
export interface Beacon {id:string;floorId:string;worldX:number;worldY:number;enabled?:boolean;reliableRadius?:number;marginalRadius?:number;coverageRadius:number}
export interface POI {id:string;name:string;floorId:string;worldX:number;worldY:number;metadata?:{nodeId?:string}}
export interface Inputs {graph:{nodes:Node[];edges:Edge[]};floorGeometry:object;beacons:Beacon[];pois:POI[];configuration?:{walkingSpeedMps?:number;sampleStep?:number;accessibleOnly?:boolean;avoidStairs?:boolean;preferLifts?:boolean;algorithm?:string}}
export interface Event {time:number;distance:number;kind:string;message:string;previousBeacon:string|null;currentBeacon:string|null}
interface Point {x:number;y:number;worldX:number;worldY:number;floorId:string;nodeId:string;edgeId:string|null;transition:boolean}
interface Sample extends Point {distance:number;time:number;activeBeacon:string|null;nearestBeacon:string|null;nearestDistance:number|null;signal:number|null;coverageState:string}
interface Section {start:number;end:number;length:number;floorId:string}
interface Segment {start:number;end:number;a:Node;b:Node;edge:Edge;valid:number[][]}
interface Route {nodeIds:string[];nodes:Node[];edgeIds:string[];totalDistance:number;estimatedWalkingTime:number;visited:number;algorithm:string}
interface Statistics {distance:number;walkingTime:number;floorsTraversed:string[];orderedNodes:string[];handovers:number;averageDistanceBetweenHandovers:number;weakCoverageSections:Section[];deadZones:Section[];longestGap:number;coveragePercentage:number;reliabilityScore:number;navigationScore:number;walkingQuality:number;continuousCoverage:boolean;maximumDistanceBetweenActiveBeacons:number;beaconCount:number;approachDistance:number;approachVerified:boolean}

// Pure geometry planning, not radio propagation. Signal is a dimensionless 0–100 proximity score, never dBm.
export class NavigationSimulation {
  inputs:Inputs; graph:NavigationGraph; floors:ReturnType<typeof compileFloorGeometry>; route:Route;
  segments:Segment[]=[]; samples:Sample[]=[]; events:Event[]=[]; statistics:Statistics; warnings:string[]=[];
  beaconsById=new Map<string,Beacon>(); beaconBins=new Map<string,Beacon[]>(); floorBeacons=new Map<string,Beacon[]>(); cellSize=1;
  speed:number;step:number;duration=0;elapsed=0;playbackSpeed=1;status='stopped';
  constructor(inputs:Inputs,startId:string,destinationId:string){
    this.inputs=inputs;validatePlacementGraph(inputs.graph);this.graph=new NavigationGraph(inputs.graph);this.floors=compileFloorGeometry(inputs.floorGeometry);
    this.speed=inputs.configuration?.walkingSpeedMps??1.35;this.step=inputs.configuration?.sampleStep??.25;
    if(!Number.isFinite(this.speed)||this.speed<=0||!Number.isFinite(this.step)||this.step<.05||this.step>1)throw new Error('Walking speed must be positive; route sampling must be 0.05–1 m.');
    if(new Set(inputs.beacons.map(b=>b.id)).size!==inputs.beacons.length)throw new Error('Beacon IDs must be unique.');
    for(const b of inputs.beacons){if(!b.id||!b.floorId||![b.worldX,b.worldY,b.coverageRadius,b.reliableRadius??b.coverageRadius,b.marginalRadius??b.coverageRadius].every(Number.isFinite)||b.coverageRadius<=0||(b.reliableRadius??b.coverageRadius)<=0||(b.marginalRadius??b.coverageRadius)<(b.reliableRadius??b.coverageRadius))throw new Error('Invalid beacon coordinates or radii.');}
    const start=inputs.pois.find(p=>p.id===startId),end=inputs.pois.find(p=>p.id===destinationId);
    if(!start||!end)throw new Error('Choose start and destination POIs.');
    for(const p of [start,end])if(![p.worldX,p.worldY].every(Number.isFinite)||!p.floorId)throw new Error('Invalid POI coordinates or floor.');
    const attach=(p:POI)=>{if(![p.worldX,p.worldY].every(Number.isFinite)||!p.floorId)throw new Error('Invalid POI coordinates or floor.');const explicit=p.metadata?.nodeId&&this.graph.nodes.get(p.metadata.nodeId);if(!explicit)throw new Error('POI graph attachment is missing.');if(explicit.floorId!==p.floorId)throw new Error('POI node is on a different floor.');return explicit;};
    // Existing nearestNode uses worldX/worldY when provided.
    const nearest=(p:POI)=>p.metadata?.nodeId?attach(p):[...this.graph.nodes.values()].filter((n:Node)=>n.floorId===p.floorId).reduce((best:Node|null,n:Node)=>!best||Math.hypot(p.worldX-n.worldX,p.worldY-n.worldY)<Math.hypot(p.worldX-best.worldX,p.worldY-best.worldY)?n:best,null);
    const a=nearest(start),z=nearest(end);if(!a||!z)throw new Error('No graph node on a POI floor.');
    const route=this.graph.route(a.id,z.id,{...inputs.configuration,walkingSpeedMps:this.speed});if(!route)throw new Error('No route satisfies the selected constraints.');this.route=route;
    const approachDistance=Math.hypot(start.worldX-a.worldX,start.worldY-a.worldY)+Math.hypot(end.worldX-z.worldX,end.worldY-z.worldY),approachVerified=approachDistance<=.05;
    if(!approachVerified)this.warnings.push('POIs are attached to nearest graph nodes; off-graph approach distance and coverage are excluded. Full POI-to-POI continuous coverage is unverified.');
    this.duration=this.route.totalDistance/this.speed;
    let distance=0;
    for(let i=0;i<this.route.edgeIds.length;i++){const edge=this.graph.edges.get(this.route.edgeIds[i]),from=this.route.nodes[i],to=this.route.nodes[i+1];if(!(edge.distance>0))throw new Error('Simulation edges must have positive distance.');const same=from.floorId===to.floorId;
      if(same&&Math.abs(edge.distance-Math.hypot(to.worldX-from.worldX,to.worldY-from.worldY))>.01)throw new Error('Same-floor graph distances must match physical geometry.');
      const valid=same?validGraphIntervals({x:from.worldX,y:from.worldY},{x:to.worldX,y:to.worldY},this.floors.get(from.floorId)):[];
      this.segments.push({start:distance,end:distance+edge.distance,a:from,b:to,edge,valid});distance+=edge.distance;
      if(same&&valid.reduce((sum,[a,b])=>sum+b-a,0)<1-1e-7)this.warnings.push(`${edge.id}: route intersects blocked or unavailable floor geometry; affected travel is unverified.`);
      if(!same)this.warnings.push(`${edge.id}: floor-transition travel is conservatively unverified; no cross-floor beacon coverage is assumed.`);
    }
    this.beaconsById=new Map(inputs.beacons.map(b=>[b.id,b]));
    const enabled=inputs.beacons.filter(b=>b.enabled!==false&&!geometryConflict({x:b.worldX,y:b.worldY},this.floors.get(b.floorId)));
    const rejected=inputs.beacons.filter(b=>b.enabled!==false).length-enabled.length;if(rejected)this.warnings.push(`${rejected} enabled beacon(s) are excluded because their floor geometry is invalid or unavailable.`);
    // ponytail: largest-radius bins are simple; use radius-tiered bins if extreme mixed-radius profiles make candidate buckets dense.
    this.cellSize=enabled.reduce((size,b)=>Math.max(size,b.marginalRadius??b.coverageRadius),1);
    for(const b of enabled){const key=this.key(b.floorId,b.worldX,b.worldY);if(!this.beaconBins.has(key))this.beaconBins.set(key,[]);this.beaconBins.get(key)!.push(b);if(!this.floorBeacons.has(b.floorId))this.floorBeacons.set(b.floorId,[]);this.floorBeacons.get(b.floorId)!.push(b);}
    const countEstimate=Math.ceil(distance/this.step);if(countEstimate+this.segments.length>250000)throw new Error('Route exceeds 250,000 samples; shorten the route or increase sampling step.');
    const distances=[...new Set([0,distance,...this.segments.map(s=>s.end),...Array.from({length:countEstimate},(_,i)=>Math.min(distance,i*this.step))])].sort((a,b)=>a-b),count=distances.length-1;
    let previous:string|null=null;
    this.events.push({time:0,distance:0,kind:'start',message:`Started at ${start.name}`,previousBeacon:null,currentBeacon:null});
    const weak:Section[]=[],dead:Section[]=[];let covered=0,reliable=0;
    for(let i=0;i<=count;i++){
      const d=distances[i],position=this.position(d),state=this.coverage(position),sample={...position,...state,distance:d,time:d/this.speed};this.samples.push(sample);
      if(sample.activeBeacon!==previous){this.events.push({time:sample.time,distance:d,kind:previous&&sample.activeBeacon?'handover':sample.activeBeacon?'connect':'lost',message:sample.activeBeacon?`${previous?'Switched':'Connected'} to ${sample.activeBeacon}`:'Coverage lost',previousBeacon:previous,currentBeacon:sample.activeBeacon});previous=sample.activeBeacon;}
      if(i<count){const endDistance=distances[i+1],len=endDistance-d;
        const segment=this.segment(d+len/2);
        const physicallyValid=!segment||segment.valid.some(([s,e])=>s<=(d-segment.start)/(segment.end-segment.start)+1e-9&&e>=(endDistance-segment.start)/(segment.end-segment.start)-1e-9);
        const midpoint=this.coverage(this.position(d+len/2));const stateName=physicallyValid?midpoint.coverageState:'dead';
        if(stateName!=='dead'&&stateName!=='transition')covered+=len;if(stateName==='reliable')reliable+=len;
        if(stateName!=='reliable'){const sections=stateName==='weak'?weak:dead,last=sections.at(-1);if(last&&Math.abs(last.end-d)<1e-7&&last.floorId===position.floorId){last.end=endDistance;last.length+=len;}else sections.push({start:d,end:endDistance,length:len,floorId:position.floorId});}
      }
    }
    for(let i=1;i<this.route.nodes.length-1;i++){const node=this.route.nodes[i];this.events.push({time:this.segments[i-1].end/this.speed,distance:this.segments[i-1].end,kind:'landmark',message:`Passed ${node.metadata?.label||node.id}`,previousBeacon:null,currentBeacon:null});}
    this.events.push({time:this.duration,distance,kind:'arrival',message:`Arrived at ${end.name}`,previousBeacon:previous,currentBeacon:previous});this.events.sort((a,b)=>a.time-b.time);
    const transfers=this.events.filter(e=>e.kind==='handover'),connections=this.events.filter(e=>e.currentBeacon&&['connect','handover'].includes(e.kind));
    const gaps=dead.map(s=>s.length),coverage=distance?100*covered/distance:this.samples[0].coverageState==='reliable'||this.samples[0].coverageState==='weak'?100:0;
    const reliability=distance?100*reliable/distance:this.samples[0].coverageState==='reliable'?100:0,longestGap=gaps.reduce((max,gap)=>Math.max(max,gap),0),navigationScore=Math.min(100,Math.max(0,.7*reliability+.3*coverage-Math.min(30,longestGap*2)));
    const byId=new Map(enabled.map(b=>[b.id,b]));let maxBeaconDistance=0;for(let i=1;i<connections.length;i++){const a=byId.get(connections[i-1].currentBeacon!),b=byId.get(connections[i].currentBeacon!);if(a&&b&&a.floorId===b.floorId)maxBeaconDistance=Math.max(maxBeaconDistance,Math.hypot(a.worldX-b.worldX,a.worldY-b.worldY));}
    this.statistics={distance,walkingTime:this.duration,floorsTraversed:[...new Set(this.route.nodes.map((n:Node)=>n.floorId))],orderedNodes:this.route.nodeIds,handovers:transfers.length,averageDistanceBetweenHandovers:connections.length>1?(connections.at(-1)!.distance-connections[0].distance)/(connections.length-1):0,weakCoverageSections:weak,deadZones:dead,longestGap,coveragePercentage:coverage,reliabilityScore:reliability,navigationScore,walkingQuality:reliability,approachDistance,approachVerified,continuousCoverage:approachVerified&&dead.length===0&&coverage>=100-1e-7&&this.samples.every(s=>['reliable','weak'].includes(s.coverageState)),maximumDistanceBetweenActiveBeacons:maxBeaconDistance,beaconCount:enabled.length};
  }
  key(floor:string,x:number,y:number){return `${floor}:${Math.floor(x/this.cellSize)}:${Math.floor(y/this.cellSize)}`;}
  segment(d:number){let lo=0,hi=this.segments.length;while(lo<hi){const mid=(lo+hi)>>1;if(this.segments[mid].end<=d)lo=mid+1;else hi=mid;}return this.segments[Math.min(lo,this.segments.length-1)];}
  position(d:number):Point {const s=this.segment(d);if(!s){const n=this.route.nodes[0];return {...n,nodeId:n.id,edgeId:null,transition:false};}const t=Math.min(1,Math.max(0,(d-s.start)/(s.end-s.start))),transition=s.a.floorId!==s.b.floorId&&t<1;return {x:s.a.x+t*(s.b.x-s.a.x),y:s.a.y+t*(s.b.y-s.a.y),worldX:s.a.worldX+t*(s.b.worldX-s.a.worldX),worldY:s.a.worldY+t*(s.b.worldY-s.a.worldY),floorId:t===1?s.b.floorId:s.a.floorId,nodeId:t===1?s.b.id:s.a.id,edgeId:s.edge.id,transition};}
  coverage(p:Point){const point={x:p.worldX,y:p.worldY};let nearest:Beacon|undefined,nearestDistance=Infinity,active:Beacon|undefined,best=-Infinity;
    const x=Math.floor(p.worldX/this.cellSize),y=Math.floor(p.worldY/this.cellSize),candidates:Beacon[]=[];
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)candidates.push(...(this.beaconBins.get(`${p.floorId}:${x+dx}:${y+dy}`)||[]));
    // ponytail: nearest physical beacon scans this floor only when local bins are empty; use a k-d tree if sparse-floor gap playback becomes limiting.
    for(const b of candidates.length?candidates:this.floorBeacons.get(p.floorId)||[]){const distance=Math.hypot(p.worldX-b.worldX,p.worldY-b.worldY);if(distance<nearestDistance){nearest=b;nearestDistance=distance;}const radius=b.marginalRadius??b.coverageRadius,signal=100*(1-distance/radius);if(!p.transition&&distance<=radius&&!geometryConflict(point,this.floors.get(p.floorId))&&visibleGeometrySegment(point,{x:b.worldX,y:b.worldY},this.floors.get(p.floorId))&&(signal>best+1e-8||(Math.abs(signal-best)<1e-8&&b.id<(active?.id||'~')))){best=signal;active=b;}}
    if(nearestDistance>this.cellSize)for(const b of this.floorBeacons.get(p.floorId)||[]){const d=Math.hypot(p.worldX-b.worldX,p.worldY-b.worldY);if(d<nearestDistance){nearest=b;nearestDistance=d;}}
    const distance=active?Math.hypot(p.worldX-active.worldX,p.worldY-active.worldY):Infinity;
    return {activeBeacon:active?.id||null,nearestBeacon:nearest?.id||null,nearestDistance:Number.isFinite(nearestDistance)?nearestDistance:null,signal:active?Math.max(0,best):null,coverageState:p.transition?'transition':!active?'dead':distance<=(active.reliableRadius??active.coverageRadius)?'reliable':'weak'};
  }
  stateAt(time:number){if(!Number.isFinite(time))throw new Error('Timeline time must be finite.');const elapsed=Math.max(0,Math.min(this.duration,time)),distance=elapsed*this.speed;let lo=0,hi=this.samples.length;while(lo<hi){const m=(lo+hi)>>1;if(this.samples[m].distance<=distance)lo=m+1;else hi=m;}const index=Math.max(0,lo-1),sample=this.samples[index],transitions=this.events.filter(e=>e.time<=elapsed&&['handover','connect','lost'].includes(e.kind)),last=transitions.at(-1),upcoming=this.events.find(e=>e.time>elapsed&&e.currentBeacon&&['handover','connect'].includes(e.kind));const position=this.position(distance),current=this.coverage(position),active=this.beaconsById.get(sample.activeBeacon!),activeDistance=active?Math.hypot(position.worldX-active.worldX,position.worldY-active.worldY):null;return {...sample,...position,nearestBeacon:current.nearestBeacon,nearestDistance:current.nearestDistance,activeDistance,signal:activeDistance==null?null:Math.max(0,100*(1-activeDistance/(active!.marginalRadius??active!.coverageRadius))),elapsed,distance,status:this.status,previousBeacon:last?.previousBeacon||null,transitionTime:last?.time??null,handovers:transitions.filter(e=>e.kind==='handover').length,upcomingBeacon:upcoming?.currentBeacon||null,visitedNodes:this.route.nodeIds.slice(0,this.route.nodeIds.indexOf(this.position(distance).nodeId)+1)};}
  control(action:string,value?:number){if(action==='speed'){if(![1,2,5,10].includes(value!))throw new Error('Playback speed must be 1x, 2x, 5x or 10x.');this.playbackSpeed=value!;}else if(action==='seek'){this.elapsed=this.stateAt(value!).elapsed;}else if(action==='stop'){this.elapsed=0;this.status='stopped';}else if(action==='pause')this.status='paused';else if(['play','resume','replay'].includes(action)){if(action==='replay'||this.elapsed>=this.duration)this.elapsed=0;this.status='playing';}else throw new Error('Invalid playback command.');return this.stateAt(this.elapsed);}
  advance(seconds:number){if(!Number.isFinite(seconds)||seconds<0)throw new Error('Elapsed time must be non-negative.');if(this.status==='playing'){this.elapsed=Math.min(this.duration,this.elapsed+seconds*this.playbackSpeed);if(this.elapsed>=this.duration)this.status='finished';}return this.stateAt(this.elapsed);}
  report(){return {schemaVersion:1,scope:"graph-route-only",model:'geometry-proximity-not-RF',signalUnits:'dimensionless 0–100; not dBm',sampleStep:this.step,route:this.route,statistics:this.statistics,events:this.events,warnings:this.warnings,isRFSimulation:false};}
}

export function compareSimulationDeployments(inputs:Inputs,start:string,end:string,a:{name:string;beacons:Beacon[]},b:{name:string;beacons:Beacon[]}){
  const first=new NavigationSimulation({...inputs,beacons:a.beacons},start,end).report(),second=new NavigationSimulation({...inputs,beacons:b.beacons},start,end).report();
  const delta=second.statistics.navigationScore-first.statistics.navigationScore;
  return {a:{name:a.name,...first.statistics},b:{name:b.name,...second.statistics},recommendation:Math.abs(delta)<.01?'Equivalent sampled navigation scores; review gaps and installation cost.':`${delta>0?b.name:a.name} has the higher geometry-based navigation score.`,warnings:[...new Set([...first.warnings,...second.warnings])],sameRoute:true};
}
