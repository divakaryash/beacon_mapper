// Temporary comparison implementation of beacon_optimizer_v12's ordered passes.
// maxD is a coverage radius here, not the model's consecutive spacing limit.
export function htmlPlacementDemo({graph, floorGeometry={}, floors=new Map(), pois=[], options={}}) {
  const settings={minD:5,maxD:8,poiR:3,sampleStep:3,juncD:3,useLOS:true,...options};
  const {minD,maxD,poiR,sampleStep,juncD,useLOS}=settings;
  if (![minD,maxD,poiR,sampleStep,juncD].every(v=>Number.isFinite(v)&&v>0) || !Number.isInteger(juncD) || typeof useLOS !== 'boolean') throw new Error('HTML demo distances and sampling must be positive; junction degree must be an integer.');
  const nodes=graph.nodes, map=new Map(nodes.map(n=>[n.id,n])), links=new Map(nodes.map(n=>[n.id,[]]));
  const edges=graph.edges.filter(e=>map.get(e.source)?.floorId===map.get(e.target)?.floorId);
  for(const e of edges){links.get(e.source).push(e);links.get(e.target).push(e);}
  // The reference uses 2-core edges for connector fallback preference.
  // Sample weighting instead uses edges whose endpoints both have degree >= 2.
  const degree=new Map(nodes.map(n=>[n.id,links.get(n.id).length])), removed=new Set(), queue=nodes.filter(n=>degree.get(n.id)<2).map(n=>n.id);
  for(let i=0;i<queue.length;i++){const id=queue[i];if(removed.has(id))continue;removed.add(id);for(const e of links.get(id)){const next=e.source===id?e.target:e.source;degree.set(next,degree.get(next)-1);if(degree.get(next)<2&&!removed.has(next))queue.push(next);}}
  const main=e=>!removed.has(e.source)&&!removed.has(e.target);
  const dist=(a,b)=>Math.hypot(a.worldX-b.worldX,a.worldY-b.worldY);
  const wallSegments=new Map();
  const record=(floorId,points,closed=false)=>{if(!wallSegments.has(floorId))wallSegments.set(floorId,[]);for(let i=1;i<points.length;i++)wallSegments.get(floorId).push([points[i-1],points[i]]);if(closed&&points.length>2)wallSegments.get(floorId).push([points.at(-1),points[0]]);};
  for(const [id,f] of floors)for(const wall of f.walls||[])record(id,wall.points);
  const scale=floorGeometry.metersPerPixel||1;
  for(const o of floorGeometry.objects||[])if(o.type!=='wall'&&/^(wall|piller|pillar)$/i.test(o.metadata?.sourceType||o.category||''))record(o.floorId||floorGeometry.defaultFloorId||'floor-1',(o.points||[]).map(p=>({x:p.x*scale,y:p.y*scale})),true);
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const wallBlocks=(a,b)=>(wallSegments.get(a.floorId)||[]).some(([c,d])=>{const p={x:a.worldX,y:a.worldY},q={x:b.worldX,y:b.worldY};return cross(c,d,p)*cross(c,d,q)<0&&cross(p,q,c)*cross(p,q,d)<0;});
  const beacons=[], reports=[];
  let inferredPriorities=0;
  for(const floorId of new Set(nodes.map(n=>n.floorId))){
    const fn=nodes.filter(n=>n.floorId===floorId), fe=edges.filter(e=>map.get(e.source).floorId===floorId), placed=[];
    const canPlace=n=>placed.every(b=>dist(b,n)>=minD-1e-6||(useLOS&&wallBlocks(n,b)));
    const covered=(n,r)=>placed.some(b=>dist(b,n)<=r+1e-6);
    const nearest=n=>fn.reduce((best,p)=>!best||dist(p,n)<dist(best,n)?p:best,null);
    const priority=p=>{const v=Number(p.pri??p.priority??p.metadata?.pri??p.metadata?.priority);if(Number.isFinite(v)&&v>0)return v;inferredPriorities++;return /lift|stair|ramp|escalator|entrance|entry/i.test(p.category||p.type||'')?1:/reception|counter|pharmacy/i.test(p.category||p.type||'')?2:3;};
    const fp=pois.filter(p=>p.floorId===floorId).map(p=>({...p,pri:priority(p)}));
    const type=p=>p.category||p.type||'Room';
    function bestNearby(target,r){return fn.filter(n=>dist(n,target)<=r&&canPlace(n)).sort((a,b)=>dist(a,target)-dist(b,target))[0];}
    function place(n,rule,target=n){if(!n||!canPlace(n))return false;placed.push({...n,id:`HTML${String(beacons.length+placed.length+1).padStart(3,'0')}`,nodeId:n.id,type:'Navigation',enabled:true,origin:'demo',coverageRadius:maxD,reliableRadius:maxD,marginalRadius:maxD,placementRule:rule,placementStrategy:`HTML · ${rule}`,placementReason:`HTML demo · ${rule}: ${target.name||target.id}. Waypoint ${n.id}; target offset ${dist(n,target).toFixed(2)} m.`,servedTargets:[{id:target.id,rule}]});return true;}
    // Include graph connector/entry nodes when POIs do not carry their identities.
    const connectors=[...fp.filter(p=>/^(lift|stairs?|ramp|escalator)$/i.test(type(p))),...fn.filter(n=>/^(lift|stairs?|ramp|escalator)$/i.test(n.type||''))];
    for(const c of connectors){if(covered(c,poiR))continue;const snap=map.get(c.metadata?.nodeId||c.nodeId)||nearest(c);if(place(snap,'Floor connector',c))continue;const nbrs=(links.get(snap?.id)||[]).slice().sort((a,b)=>Number(main(b))-Number(main(a))).map(e=>map.get(e.source===snap.id?e.target:e.source));for(const n of nbrs)if(place(n,'Floor connector',c))break;}
    const entries=[...fp.filter(p=>/^(main entry|main entrance|entrance|exit)$/i.test(type(p))),...fn.filter(n=>/^(main entry|entrance|exit)$/i.test(n.type||''))];
    for(const p of entries){if(covered(p,poiR))continue;const snap=map.get(p.metadata?.nodeId||p.nodeId)||nearest(p);if(!place(snap,'Main entrance',p))place(bestNearby(p,poiR+2),'Main entrance',p);}
    const junctions=fn.filter(n=>links.get(n.id).length>=juncD).sort((a,b)=>links.get(b.id).length-links.get(a.id).length);
    for(const n of junctions){if(covered(n,maxD))continue;if(!place(n,'Junction'))place(bestNearby(n,maxD*.8),'Junction',n);}
    for(const p of fp.filter(p=>p.pri<=2&&!/^(main entry|main entrance|entrance|exit)$/i.test(type(p))))if(!covered(p,poiR))place(bestNearby(p,poiR+3),'Priority POI',p);
    const dead=fn.filter(n=>links.get(n.id).length===1);
    for(const n of dead)if(!covered(n,maxD))place(bestNearby(n,maxD),'Dead end',n);
    for(const p of fp.filter(p=>p.pri>=3))if(!covered(p,maxD))place(bestNearby(p,maxD),'Room POI',p);
    const samples=[];
    for(const e of fe){const a=map.get(e.source),b=map.get(e.target),count=Math.max(1,Math.ceil(e.distance/sampleStep));for(let i=0;i<=count;i++){const t=i/count;samples.push({floorId,worldX:a.worldX+(b.worldX-a.worldX)*t,worldY:a.worldY+(b.worldY-a.worldY)*t,isMain:links.get(e.source).length>=2&&links.get(e.target).length>=2});}}
    function fill(limit,nlos=false){let additions=0;for(;additions<limit;additions++){const uncovered=samples.filter(s=>!covered(s,maxD));if(!uncovered.length)break;let best=null,bestScore=0;const choose=(candidates,weighted)=>{for(const n of candidates){if(!canPlace(n))continue;let score=0;for(const s of uncovered)if(dist(n,s)<=maxD)score += weighted && !s.isMain ? .3 : 1;if(score>bestScore){best=n;bestScore=score;}}};if(nlos)choose(fn,false);else{choose(fn.filter(n=>links.get(n.id).length>=2),true);if(!best)choose(fn,false);}if(!best)break;place(best,nlos?'NLOS gap':links.get(best.id).length>=2?'Corridor gap':'Branch gap');}return additions===limit;}
    const limitReached=fill(300);if(useLOS)fill(200,true);
    reports.push({floorId,beacons:placed.length,junctions:junctions.length,coveredJunctions:junctions.filter(n=>covered(n,maxD)).length,deadEnds:dead.length,coveredDeadEnds:dead.filter(n=>covered(n,maxD)).length,samples:samples.length,coveredSamples:samples.filter(s=>covered(s,maxD)).length,limitReached});
    beacons.push(...placed);
  }
  return {beacons,reports,settings,inferredPriorities,temporary:true};
}
