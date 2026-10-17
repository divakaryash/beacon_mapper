import {geometryConflict,visibleGeometrySegment} from './floorGeometry.js';
const vertical=new Set(['Lift','Escalator','Stairs']);
const distance=(a,b)=>Math.hypot(a.worldX-b.worldX,a.worldY-b.worldY);
export function planPoiBeacons({pois,floors,metersPerPixel,radius=6}){
  if(!(metersPerPixel>0)||!(radius>0)||pois.some(p=>!p.id||!p.floorId||![p.worldX,p.worldY].every(Number.isFinite)))throw new Error('POI placement requires IDs, floors, finite coordinates and positive scale/radius.');
  const groups=[],warnings=[];
  const valid=(p,floor)=>!geometryConflict({x:p.worldX,y:p.worldY},floor);
  const visible=(a,b,floor)=>visibleGeometrySegment({x:a.worldX,y:a.worldY},{x:b.worldX,y:b.worldY},floor);
  for(const poi of [...pois].sort((a,b)=>Number(vertical.has(b.category))-Number(vertical.has(a.category)))){
    const floor=floors.get(poi.floorId);let target=poi;
    if(!valid(target,floor)){
      target=null;
      for(const r of [.3,.6,1,1.5,2]){
        for(let angle=0;angle<16;angle++){const p={...poi,worldX:poi.worldX+r*Math.cos(angle*Math.PI/8),worldY:poi.worldY+r*Math.sin(angle*Math.PI/8)};if(valid(p,floor)){target=p;break;}}
        if(target)break;
      }
      if(!target){warnings.push({code:'poi-no-mount',poiId:poi.id,message:`${poi.name||poi.id}: no free mounting position within 2 m; review this POI.`});continue;}
      warnings.push({code:'poi-offset',poiId:poi.id,message:`${poi.name||poi.id}: mounting position offset ${distance(target,poi).toFixed(1)} m from excluded geometry; verify the access side.`});
    }
    const candidates=groups.filter(g=>g.floorId===poi.floorId&&g.members.every(p=>distance(p.source,poi)<10)).sort((a,b)=>distance(a,target)-distance(b,target));
    let shared=false;
    for(const group of candidates){
      const members=[...group.members,{...target,source:poi}];
      const center={worldX:members.reduce((s,p)=>s+p.worldX,0)/members.length,worldY:members.reduce((s,p)=>s+p.worldY,0)/members.length};
      const position=[center,group,target].find(p=>valid(p,floor)&&members.every(member=>distance(p,member)<=radius&&visible(p,member,floor)));
      if(!position)continue;
      group.worldX=position.worldX;group.worldY=position.worldY;group.members=members;shared=true;break;
    }
    if(!shared)groups.push({...target,members:[{...target,source:poi}]});
  }
  // Adjust within each group's visible coverage footprint toward the 8–10 m spacing target.
  for(let pass=0;pass<2;pass++)for(const group of groups){
    const floor=floors.get(group.floorId),start={worldX:group.worldX,worldY:group.worldY};
    function score(candidate){
      const neighbors=groups.filter(other=>other!==group&&other.floorId===group.floorId).map(other=>({other,distance:distance(candidate,other)})).sort((a,b)=>a.distance-b.distance);
      const nearest=neighbors.find(item=>visible(candidate,item.other,floor));
      if(!nearest)return 0;
      const gap=nearest.distance,penalty=gap<8?(8-gap)**2:gap>10?(gap-10)**2:0;
      return penalty+distance(candidate,start)**2*.02;
    }
    let best=start,bestScore=score(start);
    for(const r of [1,2])for(let angle=0;angle<8;angle++){
      const p={worldX:start.worldX+r*Math.cos(angle*Math.PI/4),worldY:start.worldY+r*Math.sin(angle*Math.PI/4)};
      if(!valid(p,floor)||!group.members.every(member=>distance(p,member)<=radius&&visible(p,member,floor)))continue;
      const value=score(p);if(value<bestScore){best=p;bestScore=value;}
    }
    group.worldX=best.worldX;group.worldY=best.worldY;
  }
  for(const group of groups){
    const nearest=groups.filter(other=>other!==group&&other.floorId===group.floorId).map(other=>({other,distance:distance(group,other)})).sort((a,b)=>a.distance-b.distance).find(item=>visible(group,item.other,floors.get(group.floorId)));
    if(nearest&&(nearest.distance<8-1e-6||nearest.distance>10+1e-6))warnings.push({code:'poi-spacing-review',poiId:group.members[0].id,message:`${group.members[0].name||group.members[0].id}: nearest visible beacon is ${nearest.distance.toFixed(1)} m away; POI visibility/coverage constraints prevent the 8–10 m target here.`});
  }
  const beacons=groups.map(group=>({floorId:group.floorId,x:group.worldX/metersPerPixel,y:group.worldY/metersPerPixel,worldX:group.worldX,worldY:group.worldY,nodeId:`poi-${group.members[0].id}`,anchorNodeIds:group.members.map(p=>`poi-${p.id}`),poiIds:group.members.map(p=>p.id),origin:'automatic',placementStrategy:group.members.some(p=>vertical.has(p.category))?'Floor-change lobby':'Shared POI',notes:group.members.map(p=>p.name||p.id).join(', ')}));
  return {beacons,warnings};
}
