import {analyzeCoverage} from './coverage.js';
import {compileFloorGeometry,geometryConflict,beaconGeometryConflict,visibleGeometrySegment,segmentProjection} from './floorGeometry.js';

// Preview only: proposed beacons never change the saved deployment.
export function suggestWaypointCoverage({graph,floorGeometry,beacons,profile,configuration={},coverage}){
  const floors=compileFloorGeometry({...floorGeometry,allowVoidBeacons:configuration.allowVoidBeacons===true});
  const scale=floorGeometry.metersPerPixel||1,nodes=new Map(graph.nodes.map(n=>[n.id,n])),edges=new Map(graph.edges.map(e=>[e.id,e]));
  const active=beacons.filter(b=>b.enabled!==false),suggestions=[];
  const radius=configuration.coverageThreshold==='marginal'?configuration.marginalRadius:configuration.coverageThreshold==='reliable'?configuration.reliableRadius:profile.coverageRadius;
  if(!(radius>0)||!Number.isFinite(radius))throw new Error('A valid coverage radius is required for suggestions.');
  const pointFor=gap=>({x:(gap.x1+gap.x2)*scale/2,y:(gap.y1+gap.y2)*scale/2});
  const reasons=(coverage?.gaps||[]).map(gap=>{
    const point=pointFor(gap),floor=floors.get(gap.floorId);
    const near=active.filter(b=>b.floorId===gap.floorId&&!beaconGeometryConflict({x:b.worldX,y:b.worldY},floor)&&Math.hypot(b.worldX-point.x,b.worldY-point.y)<=Number(b[configuration.coverageThreshold==='marginal'?'marginalRadius':configuration.coverageThreshold==='reliable'?'reliableRadius':'coverageRadius']??b.coverageRadius??profile.coverageRadius));
    return {...gap,reason:geometryConflict(point,floor)?'Waypoint crosses blocked or non-walkable geometry.':near.length?'Walls or restricted geometry block beacon visibility.':'Outside the coverage radius of enabled beacons.'};
  });
  const analyze=()=>analyzeCoverage({graph,floorGeometry,compiledFloors:floors,beacons:[...active,...suggestions],profile,configuration:{...configuration,graphOnly:true}});
  let result=analyze();
  // shortcut: bounded greedy search of gap midpoints, expand candidate search for complex mounting constraints.
  for(let iteration=0;iteration<50&&result.gaps.length;iteration++){
    let candidate=null;
    for(const gap of [...result.gaps].sort((a,b)=>b.length-a.length)){
      const floor=floors.get(gap.floorId),edge=edges.get(gap.edgeId),a=nodes.get(edge?.source),b=nodes.get(edge?.target);
      if(!a||!b)continue;
      const length=Math.hypot(b.worldX-a.worldX,b.worldY-a.worldY)||1,nx=-(b.worldY-a.worldY)/length,ny=(b.worldX-a.worldX)/length;
      for(const t of [.5,.25,.75]){
        const point={x:(gap.x1+(gap.x2-gap.x1)*t)*scale,y:(gap.y1+(gap.y2-gap.y1)*t)*scale};
        if(geometryConflict(point,floor))continue;
        for(const offset of [0,.5,-.5,1,-1,2,-2]){
          const p={x:point.x+nx*offset,y:point.y+ny*offset};
          if(beaconGeometryConflict(p,floor)||!visibleGeometrySegment(p,point,floor))continue;
          if(floor?.walls.some(w=>w.points.slice(1).some((end,i)=>segmentProjection(p,w.points[i],end).distance-w.width/2<(configuration.wallClearance??.3))))continue;
          if([...active,...suggestions].some(s=>s.floorId===gap.floorId&&Math.hypot(s.worldX-p.x,s.worldY-p.y)<(configuration.minimumSpacing??5)))continue;
          candidate={id:`S${suggestions.length+1}`,floorId:gap.floorId,x:p.x/scale,y:p.y/scale,worldX:p.x,worldY:p.y,coverageRadius:profile.coverageRadius,reliableRadius:configuration.reliableRadius??profile.coverageRadius,marginalRadius:configuration.marginalRadius??profile.coverageRadius,enabled:true};
          break;
        }
        if(candidate)break;
      }
      if(candidate)break;
    }
    if(!candidate)break;
    suggestions.push(candidate);
    const next=analyze();
    if(next.graphCoveredLength<=result.graphCoveredLength+1e-7){suggestions.pop();break;}
    result=next;
  }
  return {suggestions,reasons,projectedPercentage:result.graphCoveragePercentage,remainingLength:Math.max(0,result.totalGraphLength-result.graphCoveredLength),limitReached:suggestions.length===50};
}
