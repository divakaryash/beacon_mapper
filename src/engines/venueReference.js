import { graphFromWalkableMask } from './floorPlanAnalysis.js';
import { compileFloorGeometry, geometryConflict, validGraphIntervals, segmentProjection } from './floorGeometry.js';

const CATEGORIES={'Main Entry':'Entrance','Exit Only':'Exit','Store':'Store','Outlet':'Outlet','Lift':'Lift','Escalator':'Escalator','Escalator-up':'Escalator','Escalator-down':'Escalator','Stairs':'Stairs','Steps':'Stairs','Male Washroom':'Washroom','Female Washroom':'Washroom','Reception':'Reception'};
export function analyzeVenueReference(reference,{drawingWidth,drawingHeight,cellSize=.6}={}) {
  const {alignment}=reference;
  if(!alignment||!Array.isArray(reference.features)||reference.features.length>10000||![drawingWidth,drawingHeight,cellSize,alignment.widthMeters].every(n=>Number.isFinite(n)&&n>0))throw new Error('Invalid venue reference or drawing dimensions.');
  const matrix=alignment.geoToNormalizedPdf,origin=alignment.origin;
  if(!Array.isArray(matrix)||matrix.length!==3||matrix.some(row=>!Array.isArray(row)||row.length!==2||row.some(n=>!Number.isFinite(n)))||!Array.isArray(origin)||origin.length!==2||origin.some(n=>!Number.isFinite(n)))throw new Error('Reference requires a finite geographic-to-drawing alignment.');
  const scale=alignment.widthMeters/drawingWidth,floorId='floor-1';
  function project(coordinates){
    if(!Array.isArray(coordinates)||coordinates.length!==2||coordinates.some(n=>!Number.isFinite(n))||Math.abs(coordinates[0])>180||Math.abs(coordinates[1])>90)throw new Error('Invalid geographic coordinate in venue reference.');
    const lon=coordinates[0]-origin[0],lat=coordinates[1]-origin[1];
    return {x:(lon*matrix[0][0]+lat*matrix[1][0]+matrix[2][0])*drawingWidth,y:(lon*matrix[0][1]+lat*matrix[1][1]+matrix[2][1])*drawingHeight};
  }
  const boundary=alignment.boundary?.map(p=>({x:p[0]*drawingWidth,y:p[1]*drawingHeight}));
  if(!boundary||boundary.length<3||boundary.some(p=>![p.x,p.y].every(Number.isFinite)))throw new Error('Reference has no usable aligned building boundary.');
  const objects=[{id:'reference-boundary',type:'buildingBoundary',layerId:'walls',points:boundary,floorId,origin:'reference'},{id:'reference-public-floor',type:'walkableArea',layerId:'walkableAreas',points:boundary,floorId,category:'Public floor',origin:'reference'}],warnings=[],ids=new Set(),counts={},pois=[];
  for(const feature of reference.features){
    const properties=feature.properties||{},type=properties.type,geometry=feature.geometry;
    if(Number(properties.floor??properties.level)!==Number(reference.floor)||type==='Centroid'||type==='Boundary')continue;
    if(typeof feature.id!=='string'||!feature.id||ids.has(feature.id))throw new Error('Reference feature IDs must be present and unique.');ids.add(feature.id);
    if(!geometry||!['Point','Polygon'].includes(geometry.type))throw new Error(`Unsupported reference geometry: ${feature.id}`);
    const metadata={sourceId:feature.id,sourceType:type,associatedPolygons:properties.associatedPolygons||[],associatedPoints:properties.associatedPoints||[],entryDirection:properties.entryDirection},name=properties.outletName?`${properties.name} · ${properties.outletName}`:properties.name||type;
    if(geometry.type==='Polygon'){
      if(geometry.coordinates.length!==1)throw new Error(`Polygon holes require explicit exclusion geometry: ${feature.id}`);
      const points=geometry.coordinates[0].map(project).filter((p,i,array)=>!i||Math.hypot(p.x-array[i-1].x,p.y-array[i-1].y)>1e-7);
      if(points.length>1&&Math.hypot(points[0].x-points.at(-1).x,points[0].y-points.at(-1).y)<1e-7)points.pop();
      const role=properties.isWalkable===true?'walkableArea':type==='Restricted Area'?'restrictedArea':'nonWalkableArea';
      objects.push({id:`reference-${feature.id}`,type:['Store','Outlet'].includes(type)?'room':role,geometryRole:role,points,name,category:type,layerId:type==='Wall'?'walls':['Store','Outlet'].includes(type)?'rooms':role==='walkableArea'?'walkableAreas':'restrictedAreas',floorId,origin:'reference',metadata});
      counts[type]=(counts[type]||0)+1;
    }else if(CATEGORIES[type]){
      const position=project(geometry.coordinates),poi={id:`reference-${feature.id}`,type:'poi',layerId:'pois',floorId,name,category:CATEGORIES[type],...position,origin:'reference',metadata:{...metadata,coordinateSource:'API Point geometry; not centroid or stale local coordinates'}};
      pois.push(poi);objects.push(poi);
    }
  }
  const floors=compileFloorGeometry({objects,metersPerPixel:scale}),floor=floors.get(floorId);
  // ponytail: bounded 0.6-metre mask extracts route topology; exact API polygons validate routes and all placements.
  const width=Math.ceil(alignment.widthMeters/cellSize),height=Math.ceil(drawingHeight*scale/cellSize),free=new Uint8Array(width*height);
  if(width*height>400000)throw new Error('Reference raster exceeds analysis limit; increase cell size.');
  function fill(polygon,value){
    const points=polygon.map(p=>({x:p.x/drawingWidth*width,y:p.y/drawingHeight*height}));
    const first=Math.max(0,Math.ceil(Math.min(...points.map(p=>p.y))-.5)),last=Math.min(height-1,Math.floor(Math.max(...points.map(p=>p.y))-.5));
    for(let y=first;y<=last;y++){
      const cuts=[],scan=y+.5;
      for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if((a.y>scan)!==(b.y>scan))cuts.push(a.x+(scan-a.y)*(b.x-a.x)/(b.y-a.y));}
      cuts.sort((a,b)=>a-b);
      for(let i=0;i+1<cuts.length;i+=2){const lo=Math.max(0,Math.ceil(cuts[i]-.5)),hi=Math.min(width,Math.ceil(cuts[i+1]-.5));free.fill(value,y*width+lo,y*width+hi);}
    }
  }
  fill(boundary,1);
  for(const object of objects)if(['restrictedArea','nonWalkableArea'].includes(object.geometryRole||object.type))fill(object.points,0);
  const graph=graphFromWalkableMask({free,width,height,drawingWidth,drawingHeight,metersPerPixel:scale});
  const valid=(a,b)=>validGraphIntervals({x:a.x*scale,y:a.y*scale},{x:b.x*scale,y:b.y*scale},floor).reduce((sum,[lo,hi])=>sum+hi-lo,0)>1-1e-7;
  let rejectedEdges=0;
  for(const edge of [...graph.edges.values()])if(!valid(graph.nodes.get(edge.source),graph.nodes.get(edge.target))){graph.removeEdge(edge.id);rejectedEdges++;}
  for(const node of [...graph.nodes.values()])if(!graph.adjacency.get(node.id).size)graph.removeNode(node.id);
  // Reduce raster stair-steps only where the straight replacement remains fully walkable.
  for(const node of [...graph.nodes.values()]){
    const links=[...graph.adjacency.get(node.id)];if(links.length!==2)continue;
    const ends=links.map(id=>{const edge=graph.edges.get(id);return graph.nodes.get(edge.source===node.id?edge.target:edge.source);}),[a,b]=ends;
    if(a.id===b.id||Math.hypot(a.worldX-b.worldX,a.worldY-b.worldY)>6||!valid(a,b))continue;
    graph.removeNode(node.id);graph.addEdge({source:a.id,target:b.id,edgeType:'Walkway'});
  }
  // Join sampling fragments only across an exact, unobstructed walkable segment.
  const parent=new Map([...graph.nodes.keys()].map(id=>[id,id]));
  function root(id){let current=id;while(parent.get(current)!==current)current=parent.get(current);return current;}
  for(const edge of graph.edges.values())parent.set(root(edge.source),root(edge.target));
  const bins=new Map(),reach=3;
  for(const node of graph.nodes.values()){
    const x=Math.floor(node.worldX/reach),y=Math.floor(node.worldY/reach);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const other of bins.get(`${x+dx}:${y+dy}`)||[]){
      if(root(node.id)===root(other.id)||Math.hypot(node.worldX-other.worldX,node.worldY-other.worldY)>reach||!valid(node,other))continue;
      graph.addEdge({source:node.id,target:other.id,edgeType:'Walkway'});parent.set(root(node.id),root(other.id));
    }
    const key=`${x}:${y}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(node);
  }
  for(const node of graph.nodes.values())if(graph.adjacency.get(node.id).size>=3)node.type='Junction';
  let attached=0;
  for(const poi of pois){
    if(geometryConflict({x:poi.x*scale,y:poi.y*scale},floor)){warnings.push(`${poi.name}: API point lies on excluded geometry; marker preserved, corridor access needs review.`);continue;}
    const nearby=[...graph.edges.values()].map(edge=>({edge,projection:segmentProjection(poi,graph.nodes.get(edge.source),graph.nodes.get(edge.target))})).filter(item=>item.projection.distance*scale<=12).sort((a,b)=>a.projection.distance-b.projection.distance);
    const access=nearby.find(item=>valid(poi,item.projection));
    if(!access){warnings.push(`${poi.name}: no visible corridor connection within 12 m; marker preserved without a fabricated entrance.`);continue;}
    const {edge,projection}=access;
    const target=projection.t<.001?graph.nodes.get(edge.source):projection.t>.999?graph.nodes.get(edge.target):graph.splitEdge(edge.id,{id:`reference-projection-${poi.metadata.sourceId}`,ratio:projection.t}).node;
    const nodeType=['Store','Outlet'].includes(poi.category)?'Room Entrance':['Reception','Washroom'].includes(poi.category)?'Landmark':poi.category;
    const node=graph.addNode({id:`reference-access-${poi.metadata.sourceId}`,...{x:poi.x,y:poi.y},worldX:poi.x*scale,worldY:poi.y*scale,floorId,type:nodeType,metadata:{category:poi.category,label:poi.name,sourceId:poi.metadata.sourceId}},{snapDistance:.05}).node;
    if(target.id!==node.id)graph.addEdge({source:node.id,target:target.id,edgeType:'Walkway'});
    poi.metadata.nodeId=node.id;attached++;
  }
  // Do not deploy into disconnected facade slivers with no referenced access point.
  for(const component of graph.components())if(!component.some(id=>graph.nodes.get(id).metadata.sourceId))for(const id of component)graph.removeNode(id);
  const components=graph.components().length;
  if(components>1)warnings.push(`${components} referenced navigation components remain disconnected; review their door/lobby connections.`);
  if(!graph.edges.size)throw new Error('Reference geometry produced no safe navigation paths.');
  return {objects,graph:graph.serialize(),widthMeters:alignment.widthMeters,heightMeters:drawingHeight*scale,analysis:{method:'aligned-venue-reference',status:'needs-review',scaleAssumed:false,referenceName:reference.name,referenceFloor:reference.floor,resolution:{width,height,cellSize},counts,detected:{boundaries:1,walkableRegions:1,walls:counts.Wall||0,roomCandidates:(counts.Store||0)+(counts.Outlet||0),labeledLandmarks:pois.length},attachedAccessPoints:attached,rejectedEdges,components,warnings:[alignment.boundarySource,'API geographic coordinates aligned to this exact PDF. Local coordinates and Centroid features are intentionally excluded.','Public walkable space is inferred from the reviewed outer facade minus shops, walls, shafts, greenery and restricted footprints. The API supplies no corridor graph.', 'Physical scale is estimated from API geographic distances; confirm it against the drawing/site survey.',...warnings]}};
}
