import { objectPoints, boundsOf, rotatedPoint,polygonArea } from "./geometry.js";

const EPS = 1e-8;
const cross = (a,b) => a.x*b.y-a.y*b.x;
const subtract = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
export function segmentProjection(point,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,lengthSquared=dx*dx+dy*dy;
  const t=lengthSquared ? Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/lengthSquared)) : 0;
  return {t,x:a.x+t*dx,y:a.y+t*dy,distance:Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy)};
}
export function pointInPolygon(point,polygon) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[j],b=polygon[i];
    if(segmentProjection(point,a,b).distance<EPS)return true;
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
const inPolygons=(point,polygons)=>polygons.some(p=>pointInPolygon(point,p));
const inPaths=(point,paths)=>paths.some(path=>path.points.slice(1).some((b,i)=>segmentProjection(point,path.points[i],b).distance<=path.width/2+EPS));
function selfIntersects(polygon) {
  const points=polygon.length>3&&Math.hypot(polygon[0].x-polygon.at(-1).x,polygon[0].y-polygon.at(-1).y)<EPS?polygon.slice(0,-1):polygon;
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++) {
    if(j===i+1||(i===0&&j===points.length-1))continue;
    const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length],r=subtract(b,a),s=subtract(d,c),delta=subtract(c,a),den=cross(r,s);
    if(Math.abs(den)>EPS){const t=cross(delta,s)/den,u=cross(delta,r)/den;if(t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS)return true;}
    else if(Math.abs(cross(delta,r))<EPS&&[segmentProjection(c,a,b).distance,segmentProjection(d,a,b).distance,segmentProjection(a,c,d).distance,segmentProjection(b,c,d).distance].some(d=>d<EPS))return true;
  }
  return false;
}

// Engine inputs are metres. This adapter is the only place drawing pixels are converted.
export function compileFloorGeometry(input={}) {
  const floors=new Map();
  if(input.floors)for(const f of input.floors)floors.set(f.floorId,{boundaries:[],walkableAreas:[],restrictedAreas:[],nonWalkableAreas:[],walls:[],walkablePaths:[],...f});
  else if(input.objects) {
    const scale=Number(input.metersPerPixel);
    if(!Number.isFinite(scale)||scale<=0)throw new Error("Floor geometry requires a positive metres-per-pixel scale.");
    for(const object of input.objects) {
      const role=object.geometryRole||object.type;
      if(!["buildingBoundary","walkableArea","restrictedArea","nonWalkableArea","wall","walkablePath"].includes(role))continue;
      const floorId=object.floorId||input.defaultFloorId||"floor-1";
      if(!floors.has(floorId))floors.set(floorId,{floorId,boundaries:[],walkableAreas:[],restrictedAreas:[],nonWalkableAreas:[],walls:[],walkablePaths:[]});
      const floor=floors.get(floorId),bounds=boundsOf(object),center={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
      const points=objectPoints(object).map(p=>rotatedPoint(p,center,object.rotation||0)).map(p=>({x:p.x*scale,y:p.y*scale}));
      if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error("Geometry coordinates must be finite.");
      if(role==="wall"||role==="walkablePath") {
        const width=Number(role==="wall" ? object.thicknessMeters??.2 : object.widthMeters??2);
        if(!(width>0)||!Number.isFinite(width)||points.length<2)throw new Error("Walls and walkable paths require a positive width and two points.");
        floor[role==="wall"?"walls":"walkablePaths"].push({points,width});
      } else {
        if(points.length<3)throw new Error("Area geometry requires at least three points.");
        floor[{buildingBoundary:"boundaries",walkableArea:"walkableAreas",restrictedArea:"restrictedAreas",nonWalkableArea:"nonWalkableAreas"}[role]].push(points);
      }
    }
  }
  for(const floor of floors.values()) {
    for(const polygons of [floor.boundaries,floor.walkableAreas,floor.restrictedAreas,floor.nonWalkableAreas])for(const polygon of polygons)if(polygon.length<3||polygonArea(polygon)<=EPS||polygon.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))||selfIntersects(polygon))throw new Error("Invalid, self-intersecting or zero-area floor polygon.");
    for(const path of [...floor.walls,...floor.walkablePaths])if(path.points.length<2||!(path.width>0)||!Number.isFinite(path.width)||path.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error("Invalid floor path width or coordinates.");
  }
  return floors;
}
export function geometryConflict(point,floor,{requireWalkable=true}={}) {
  if(!floor?.boundaries.length)return "missing-building-boundary";
  if(!inPolygons(point,floor.boundaries))return "outside-building";
  if(inPaths(point,floor.walls))return "inside-wall";
  if(inPolygons(point,floor.restrictedAreas))return "restricted-area";
  if(inPolygons(point,floor.nonWalkableAreas))return "non-walkable-area";
  if(requireWalkable) {
    if(!floor.walkableAreas.length&&!floor.walkablePaths.length)return "missing-walkable-geometry";
    if(!inPolygons(point,floor.walkableAreas)&&!inPaths(point,floor.walkablePaths))return "non-walkable-area";
  }
  return null;
}
function lineCuts(a,b,c,d,cuts) {
  const r=subtract(b,a),s=subtract(d,c),den=cross(r,s),delta=subtract(c,a);
  if(Math.abs(den)>EPS) {
    const t=cross(delta,s)/den,u=cross(delta,r)/den;
    if(t>=0&&t<=1&&u>=0&&u<=1)cuts.push(t);
  } else if(Math.abs(cross(delta,r))<EPS) {
    cuts.push(segmentProjection(c,a,b).t,segmentProjection(d,a,b).t);
  }
}
function circleCuts(a,b,center,radius,cuts) {
  const d=subtract(b,a),f=subtract(a,center),aa=d.x*d.x+d.y*d.y;
  if(!aa)return;
  const bb=2*(f.x*d.x+f.y*d.y),cc=f.x*f.x+f.y*f.y-radius*radius,disc=bb*bb-4*aa*cc;
  if(disc<0)return;
  for(const t of [(-bb-Math.sqrt(disc))/(2*aa),(-bb+Math.sqrt(disc))/(2*aa)])if(t>=0&&t<=1)cuts.push(t);
}
// Split at polygon and capsule boundaries, then classify intervals. No sampling can miss a thin wall.
export function validGraphIntervals(a,b,floor,{requireWalkable=true}={}) {
  if(!floor?.boundaries.length)return [];
  const cuts=[0,1];
  for(const polygons of [floor.boundaries,floor.walkableAreas,floor.restrictedAreas,floor.nonWalkableAreas])for(const polygon of polygons)for(let i=0;i<polygon.length;i++)lineCuts(a,b,polygon[i],polygon[(i+1)%polygon.length],cuts);
  for(const path of [...floor.walls,...floor.walkablePaths])for(let i=1;i<path.points.length;i++) {
    const c=path.points[i-1],d=path.points[i],length=Math.hypot(d.x-c.x,d.y-c.y),r=path.width/2;
    circleCuts(a,b,c,r,cuts);circleCuts(a,b,d,r,cuts);
    if(length) {
      const normal={x:-(d.y-c.y)*r/length,y:(d.x-c.x)*r/length};
      for(const sign of [-1,1])lineCuts(a,b,{x:c.x+sign*normal.x,y:c.y+sign*normal.y},{x:d.x+sign*normal.x,y:d.y+sign*normal.y},cuts);
    }
  }
  cuts.sort((a,b)=>a-b);const unique=cuts.filter((t,i)=>!i||t-cuts[i-1]>EPS),intervals=[];
  for(let i=1;i<unique.length;i++) {
    const start=unique[i-1],end=unique[i],t=(start+end)/2;
    if(end-start>EPS&&!geometryConflict({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)},floor,{requireWalkable})){const previous=intervals.at(-1);if(previous&&Math.abs(previous[1]-start)<EPS)previous[1]=end;else intervals.push([start,end]);}
  }
  return intervals;
}
export function visibleGeometrySegment(a,b,floor) {
  if(Math.hypot(b.x-a.x,b.y-a.y)<EPS)return !geometryConflict(a,floor,{requireWalkable:false});
  const intervals=validGraphIntervals(a,b,floor,{requireWalkable:false});
  return intervals.reduce((sum,[start,end])=>sum+end-start,0)>=1-1e-7;
}
export function nearestValidGraphPosition(beacon,graph,floors) {
  const nodes=graph.nodes instanceof Map?graph.nodes:new Map(graph.nodes.map(n=>[n.id,n]));
  const edges=graph.edges instanceof Map?[...graph.edges.values()]:graph.edges;
  let best=null,bestDistance=Infinity;
  const point={x:beacon.worldX,y:beacon.worldY},floor=floors.get(beacon.floorId);
  if(!floor?.boundaries.length||(!floor.walkableAreas.length&&!floor.walkablePaths.length))return null;
  for(const node of nodes.values())if(node.floorId===beacon.floorId&&!geometryConflict({x:node.worldX,y:node.worldY},floor)){const d=Math.hypot(point.x-node.worldX,point.y-node.worldY);if(d<bestDistance){bestDistance=d;best={...beacon,x:node.x,y:node.y,worldX:node.worldX,worldY:node.worldY,nodeId:node.id,edgeId:undefined,edgeOffset:undefined,anchorNodeId:beacon.anchorNodeId||beacon.nodeId};}}
  for(const edge of edges) {
    const a=nodes.get(edge.source),b=nodes.get(edge.target);
    if(!a||!b||a.floorId!==beacon.floorId||b.floorId!==beacon.floorId)continue;
    const start={x:a.worldX,y:a.worldY},end={x:b.worldX,y:b.worldY};
    const projected=segmentProjection(point,start,end),length=Math.hypot(end.x-start.x,end.y-start.y);
    for(const [lo,hi] of validGraphIntervals(start,end,floor)) {
      const margin=Math.min((hi-lo)/4,1e-5/Math.max(length,1e-5));
      const t=Math.max(lo+margin,Math.min(hi-margin,projected.t)),worldX=start.x+t*(end.x-start.x),worldY=start.y+t*(end.y-start.y),d=Math.hypot(point.x-worldX,point.y-worldY);
      if(d<bestDistance&&!geometryConflict({x:worldX,y:worldY},floor)){bestDistance=d;best={...beacon,x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y),worldX,worldY,edgeId:edge.id,edgeOffset:t*edge.distance,nodeId:undefined,anchorNodeId:beacon.anchorNodeId||beacon.nodeId};}
    }
  }
  return best;
}
