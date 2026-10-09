import {facilityBlocks} from "./facilityBlocks.js";
import {simplifyContour} from "./geometry.js";
import { segmentProjection,pointInPolygon } from './floorGeometry.js';
import { NavigationGraph } from './navigationGraph.js';

const rectangle=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const category=text=>[/\bescalator/i,'Escalator',/\b(lift|elevator)\b/i,'Lift',/\bstair/i,'Stairs',/\bexit\b/i,'Exit',/\bentrance\b/i,'Entrance',/\batrium\b/i,'Atrium',/\b(shop|store|outlet)\b/i,'Store'].reduce((found,value,i,list)=>found||(i%2===0&&value.test(text)?list[i+1]:null),null);

// ponytail: bounded monochrome segmentation, not semantic vision; use a trained detector for coloured plans and unlabeled symbols.
export function analyzeFloorPlan({data,width,height,drawingWidth=width,drawingHeight=height,metersPerPixel,labels=[],excludeDrawingFrame=false,crossMarksRemoved=false}) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<3||height<3||width*height>400000||![drawingWidth,drawingHeight].every(v=>Number.isFinite(v)&&v>0)||!Array.isArray(labels)||data.length!==width*height*4||!(metersPerPixel>0)||!Number.isFinite(metersPerPixel))throw new Error('Invalid analysis raster or scale.');
  const size=width*height,ink=new Uint8Array(size),closed=new Uint8Array(size),outside=new Uint8Array(size),free=new Uint8Array(size),sx=drawingWidth/width,sy=drawingHeight/height;
  const neighbors=i=>[i-width,i+1,i+width,i-1].filter(j=>j>=0&&j<size&&(Math.floor(i/width)===Math.floor(j/width)||i%width===j%width));
  for(let i=0;i<size;i++){const p=i*4,alpha=data[p+3]/255;ink[i]=((.2126*data[p]+.7152*data[p+1]+.0722*data[p+2])*alpha+255*(1-alpha))<180?1:0;}
  if(excludeDrawingFrame){
    const columns=[];
    for(let x=0;x<width;x++)if(x<width*.15||x>width*.85){let count=0,branches=0;for(let y=0;y<height;y++)if(ink[y*width+x]){count++;if((x>1&&ink[y*width+x-2])||(x<width-2&&ink[y*width+x+2]))branches++;}if(count>height*.35&&branches<=Math.max(4,height*.025))columns.push(x);}
    const left=columns.find(x=>x<width*.15),right=columns.findLast(x=>x>width*.85);
    if(left!==undefined&&right!==undefined&&right-left>width*.75)for(const x of columns)if(x<=left+2||x>=right-2)for(let y=0;y<height;y++)ink[y*width+x]=0;
    for(let y=0;y<height;y++)if(y<height*.03||y>height*.97)for(let x=0;x<width;){if(!ink[y*width+x]){x++;continue;}const start=x;let branches=0;while(x<width&&ink[y*width+x]){if((y>1&&ink[(y-2)*width+x])||(y<height-2&&ink[(y+2)*width+x]))branches++;x++;}if(x-start>width*.25&&branches<=Math.max(4,width*.025))for(let i=start;i<x;i++)ink[y*width+i]=0;}
  }
  // Reject isolated glyph-sized strokes; retain solid columns and long structural lines.
  const glyphCandidates=[];
  const inkSeen=new Uint8Array(size),strokeSpan=Math.max(3,Math.max(width,height)/64);
  for(let i=0;i<size;i++)if(ink[i]&&!inkSeen[i]){
    const cells=[i];inkSeen[i]=1;let minX=i%width,maxX=minX,minY=Math.floor(i/width),maxY=minY;
    for(let k=0;k<cells.length;k++)for(const j of neighbors(cells[k]))if(ink[j]&&!inkSeen[j]){inkSeen[j]=1;cells.push(j);minX=Math.min(minX,j%width);maxX=Math.max(maxX,j%width);minY=Math.min(minY,Math.floor(j/width));maxY=Math.max(maxY,Math.floor(j/width));}
    const w=maxX-minX+1,h=maxY-minY+1,solid=cells.length>=4&&w>=2&&h>=2&&w/h>.5&&w/h<2&&cells.length/(w*h)>.8;
    const printedLabel=!solid&&labels.some(label=>label.source==='ocr'&&label.width>0&&label.height>0&&minX*sx>=label.x-sx&&maxX*sx<=label.x+label.width+sx&&minY*sy>=label.y-label.height-sy&&maxY*sy<=label.y+sy);
    if(printedLabel)for(const j of cells)ink[j]=0;
    else if(!solid&&Math.max(w,h)<strokeSpan)for(const j of cells)ink[j]=0;
    else if(!solid&&h<=Math.max(width,height)/24&&h>=3&&w<=h*1.5)glyphCandidates.push({cells,minX,maxX,minY,maxY,w,h});
  }
  // Text-sized characters on a shared baseline form words, not structural polygons.
  glyphCandidates.sort((a,b)=>a.minX-b.minX);
  const glyphSeen=new Set();
  for(const glyph of glyphCandidates)if(!glyphSeen.has(glyph)){
    const word=[glyph];glyphSeen.add(glyph);
    for(let k=0;k<word.length;k++)for(const other of glyphCandidates){
      const current=word[k],height=Math.max(current.h,other.h);
      if(glyphSeen.has(other)||Math.min(current.h,other.h)<height*.65||Math.abs(current.maxY-other.maxY)>height*.25)continue;
      const gap=Math.max(current.minX,other.minX)-Math.min(current.maxX,other.maxX)-1;
      if(gap>=0&&gap<=height){word.push(other);glyphSeen.add(other);}
    }
    if(word.length>=3)for(const character of word)for(const i of character.cells)ink[i]=0;
  }
  const facilities=facilityBlocks(ink,width,height,labels,sx,sy);
  for(const block of facilities)for(let y=block.y;y<block.y+block.h;y++)for(let x=block.x;x<block.x+block.w;x++)ink[y*width+x]=1;
  // Close one-cell gaps for exterior classification only; real door openings remain walkable.
  const dilated=ink.map((v,i)=>v||neighbors(i).some(j=>ink[j])?1:0);
  for(let i=0;i<size;i++)closed[i]=dilated[i]&&neighbors(i).every(j=>dilated[j])?1:0;
  const queue=[];
  for(let i=0;i<size;i++)if((i<width||i>=size-width||i%width===0||i%width===width-1)&&!closed[i]){outside[i]=1;queue.push(i);}
  for(let k=0;k<queue.length;k++)for(const j of neighbors(queue[k]))if(!closed[j]&&!outside[j]){outside[j]=1;queue.push(j);}
  for(let i=0;i<size;i++)free[i]=!outside[i]&&!ink[i]?1:0;
  // Discard text-sized pockets, retaining disconnected rooms for review rather than routing through walls.
  const seen=new Uint8Array(size),regions=[];
  for(let i=0;i<size;i++)if(free[i]&&!seen[i]){const cells=[i];seen[i]=1;for(let k=0;k<cells.length;k++)for(const j of neighbors(cells[k]))if(free[j]&&!seen[j]){seen[j]=1;cells.push(j);}if(cells.length<Math.max(9,size*.00035))cells.forEach(j=>free[j]=0);else regions.push(cells);}
  if(!regions.length&&excludeDrawingFrame)return analyzeFloorPlan({data,width,height,drawingWidth,drawingHeight,metersPerPixel,labels,excludeDrawingFrame:false});
  if(!regions.length)throw new Error('No enclosed walkable regions detected. Use a clearer wall drawing or correct the building boundary manually.');
  if(!crossMarksRemoved){
    const crosses=crossedEnclosures(regions,width,height);
    if(crosses.length){
      const cleaned=new Uint8ClampedArray(data);
      for(const {center,corners} of crosses)for(let i=0;i<size;i++)if(ink[i]){
        const p={x:i%width+.5,y:Math.floor(i/width)+.5};
        if(!pointInPolygon(p,corners)||corners.some((a,j)=>segmentProjection(p,a,corners[(j+1)%corners.length]).distance<2))continue;
        if(corners.some(corner=>segmentProjection(p,center,corner).distance<=2)){
          const offset=i*4;cleaned[offset]=cleaned[offset+1]=cleaned[offset+2]=255;
        }
      }
      return analyzeFloorPlan({data:cleaned,width,height,drawingWidth,drawingHeight,metersPerPixel,labels,excludeDrawingFrame,crossMarksRemoved:true});
    }
  }
  const objects=[],add=(type,points,extra={})=>objects.push({id:`auto-${type}-${objects.length+1}`,type,points,layerId:type==='walkableArea'?'walkableAreas':type==='room'?'rooms':'walls',floorId:'floor-1',rotation:0,origin:'automatic',...extra});
  const envelope=new Uint8Array(size),interior=regions.flat();
  for(const i of interior)envelope[i]=1;
  // Only include nearby wall thickness, not an entire connected exterior annotation/frame network.
  let border=interior;for(let pass=0;pass<2;pass++){const next=[];for(const i of border)for(const j of neighbors(i))if(!outside[j]&&!envelope[j]){envelope[j]=1;next.push(j);}border=next;}
  for(const contour of maskContours(envelope,width,height,sx,sy))if(!contour.hole)add('buildingBoundary',contour.points);
  // Smaller enclosed regions are room candidates; use their contours, never their bounding boxes.
  const largest=Math.max(...regions.map(r=>r.length));
  let roomCount=0;
  for(const cells of regions) {
    const mask=new Uint8Array(size);for(const i of cells)mask[i]=1;
    let minX=width,maxX=0,minY=height,maxY=0;
    for(const i of cells){const x=i%width,y=Math.floor(i/width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    const boxArea=(maxX-minX+1)*(maxY-minY+1);
    const enclosedStore=cells.length/interior.length<.55&&cells.length/boxArea>.65;
    const room=(cells.length<largest*.6||enclosedStore)&&cells.length>=Math.max(16,size*.0001);
    for(const contour of maskContours(mask,width,height,sx,sy,1.25)){
      if(!contour.hole)add(room?'room':'walkableArea',contour.points,room?{name:`Detected room ${++roomCount}`,category:'Room',geometryRole:'nonWalkableArea'}:{});
      else if(!room&&!facilities.some(block=>contour.points.every(p=>p.x>=(block.x-1)*sx&&p.x<=(block.x+block.w+1)*sx&&p.y>=(block.y-1)*sy&&p.y<=(block.y+block.h+1)*sy)))add('nonWalkableArea',contour.points,{category:'Void',layerId:'restrictedAreas'});
    }
    if(room)for(const i of cells)free[i]=0;
  }
  for(const object of objects)if(object.type==='room'){
    const contained=labels.filter(label=>typeof label.text==='string'&&label.text.trim()&&[label.x,label.y].every(Number.isFinite)&&pointInPolygon({x:label.x+(label.width||0)/2,y:label.y-(label.height||0)/2},object.points));
    const largestCaption=Math.max(0,...contained.map(label=>label.height||0));
    const names=contained.filter(label=>label.source!=='ocr'||(label.confidence>=75&&(label.height||0)>=largestCaption*.65));
    if(names.some(label=>['Lift','Stairs','Escalator'].includes(category(label.text)))){object.category=category(names.find(label=>['Lift','Stairs','Escalator'].includes(category(label.text))).text);object.metadata={sourceType:object.category,groupedAssembly:true};}
    if(names.length)object.name=names.sort((a,b)=>a.y-b.y||a.x-b.x).map(label=>label.text.trim()).join(' ');
  }
  const wallContours=maskContours(ink.map((v,i)=>v&&!outside[i]?1:0),width,height,sx,sy);
  const wallPolygons=wallContours.filter(c=>!c.hole).map(c=>({...c,holes:[]}));
  for(const hole of wallContours.filter(c=>c.hole)){
    const containing=wallPolygons.filter(c=>pointInPolygon(hole.points[0],c.points));
    containing.sort((a,b)=>Math.abs(contourArea(a.points))-Math.abs(contourArea(b.points)));
    if(containing[0])containing[0].holes.push(hole.points);
  }
  for(const wall of wallPolygons)add('nonWalkableArea',wall.points,{category:'Wall',holes:wall.holes});
  for(const object of objects)if(object.type==='nonWalkableArea'&&!object.category)object.category='Wall';
  for(const block of facilities)add('nonWalkableArea',rectangle(block.x*sx,block.y*sy,block.w*sx,block.h*sy),{category:block.type,name:block.name,metadata:{sourceType:block.type,groupedAssembly:true,needsReview:!!block.needsReview}});
  const graph=graphFromWalkableMask({free,width,height,drawingWidth,drawingHeight,metersPerPixel});
  for(const node of graph.nodes.values())if(graph.adjacency.get(node.id).size>=3)node.type='Junction';
  for(const block of facilities){
    const x=(block.x+block.w/2)*sx,y=(block.y+block.h/2)*sy;
    let nearest=null;for(const node of graph.nodes.values())if(!nearest||Math.hypot(node.x-x,node.y-y)<Math.hypot(nearest.x-x,nearest.y-y))nearest=node;
    if(nearest&&Math.hypot(nearest.x-x,nearest.y-y)*metersPerPixel<=6){nearest.type=block.needsReview?"Stairs":block.type;nearest.metadata={category:block.type,needsReview:!!block.needsReview};objects.push({id:`auto-facility-poi-${objects.length}`,type:'poi',layerId:'pois',floorId:'floor-1',x:nearest.x,y:nearest.y,name:block.name,category:block.type,origin:'automatic',rotation:0});}
  }
  const regionAt=new Int32Array(size).fill(-1);
  regions.forEach((cells,index)=>cells.forEach(i=>{if(free[i])regionAt[i]=index;}));
  for(const label of labels){
    if(facilities.some(block=>block.label===label))continue;
    const type=typeof label.text==='string'?category(label.text):null;if(!type||![label.x,label.y].every(Number.isFinite))continue;
    const lx=Math.floor(label.x/sx),ly=Math.floor(label.y/sy);let region=-1,nearest=Infinity;
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const x=lx+dx,y=ly+dy,i=y*width+x;if(x<0||y<0||x>=width||y>=height||regionAt[i]<0)continue;const distance=dx*dx+dy*dy;if(distance<nearest){nearest=distance;region=regionAt[i];}}
    if(region<0)continue;
    let best=null;
    for(const edge of graph.edges.values()){
      const a=graph.nodes.get(edge.source),b=graph.nodes.get(edge.target),p=segmentProjection(label,a,b),cell=Math.floor(p.y/sy)*width+Math.floor(p.x/sx);
      if(regionAt[cell]===region&&(!best||p.distance<best.p.distance))best={edge,p};
    }
    if(!best||best.p.distance>Math.max(drawingWidth,drawingHeight)/4)continue;
    const node=best.p.t<.001?graph.nodes.get(best.edge.source):best.p.t>.999?graph.nodes.get(best.edge.target):graph.splitEdge(best.edge.id,{id:`auto-label-${objects.length}`,ratio:best.p.t}).node;
    node.type=type==='Store'?'Room Entrance':['Atrium'].includes(type)?'Landmark':type;
    node.metadata={category:type,label:label.text};
    objects.push({id:`auto-poi-${objects.length}`,type:'poi',layerId:'pois',floorId:'floor-1',x:node.x,y:node.y,name:label.text,category:type,origin:'automatic',rotation:0});
  }
  if(!graph.edges.size)throw new Error('Detected regions are too small to generate navigation paths. Use a higher-resolution source.');
  return {objects,graph:graph.serialize(),analysis:{method:'bounded-raster-topology',contourVersion:2,resolution:{width,height},status:'needs-review',warnings:['Boundaries and regions are traced from structural lines. Closed rooms and voids block beacon placement. Review ambiguous room outlines and door connections.','Lift, escalator, stair, entrance and exit recognition uses PDF/SVG text labels only; unlabeled symbols and raster text require manual confirmation.','Placement is a bounded geometry-based heuristic, not a guaranteed global optimum or RF coverage prediction.'],regions:regions.length,detected:{boundaries:objects.filter(o=>o.type==='buildingBoundary').length,walkableRegions:objects.filter(o=>o.type==='walkableArea').length,walls:objects.filter(o=>o.category==='Wall').length,roomCandidates:objects.filter(o=>o.type==='room').length,labeledLandmarks:objects.filter(o=>o.type==='poi').length}}};
}

export function graphFromWalkableMask({free,width,height,drawingWidth,drawingHeight,metersPerPixel}) {
  const size=width*height,sx=drawingWidth/width,sy=drawingHeight/height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<3||height<3||size>400000||free.length!==size||![drawingWidth,drawingHeight,metersPerPixel].every(v=>Number.isFinite(v)&&v>0))throw new Error('Invalid walkable mask dimensions or scale.');
  // Zhang-Suen thinning preserves the connectivity of the inferred walkable mask.
  const skeleton=free.slice(),offsets=[-width,-width+1,1,width+1,width,width-1,-1,-width-1];
  let changed=true;
  while(changed){changed=false;for(let pass=0;pass<2;pass++){const remove=[];for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=y*width+x;if(!skeleton[i])continue;const p=offsets.map(d=>skeleton[i+d]),n=p.reduce((a,b)=>a+b,0),transitions=p.reduce((sum,v,j)=>sum+(!v&&p[(j+1)%8]?1:0),0);if(n>=2&&n<=6&&transitions===1&&(pass===0?(!p[0]||!p[2]||!p[4])&&(!p[2]||!p[4]||!p[6]):(!p[0]||!p[2]||!p[6])&&(!p[0]||!p[4]||!p[6])))remove.push(i);}for(const i of remove)skeleton[i]=0;if(remove.length)changed=true;}}
  const graph=new NavigationGraph(),ids=new Map();
  for(let i=0;i<size;i++)if(skeleton[i]){const x=(i%width+.5)*sx,y=(Math.floor(i/width)+.5)*sy;const {node}=graph.addNode({id:`auto-node-${i}`,x,y,worldX:x*metersPerPixel,worldY:y*metersPerPixel,floorId:'floor-1',type:'Corridor'});ids.set(i,node.id);}
  for(const [i,id] of ids)for(const d of [1,width,width+1,width-1]){const j=i+d;if(!ids.has(j)||Math.abs(j%width-i%width)>1)continue;const diagonal=Math.abs(j%width-i%width)===1&&Math.floor(j/width)!==Math.floor(i/width);if(diagonal&&(!free[i+(j%width-i%width)]||!free[i+width]))continue;if(diagonal&&(ids.has(i+width)||ids.has(i+(j%width-i%width))))continue;graph.addEdge({source:id,target:ids.get(j),edgeType:'Walkway'});}
  // A large square open area thins to one point; retain a usable central route across it.
  if(!graph.edges.size){
    let best=null;
    for(let y=0;y<height;y++)for(let x=0;x<width;){if(!free[y*width+x]){x++;continue;}const start=x;while(x<width&&free[y*width+x])x++;const length=x-start;if(length>1&&(!best||length>best.length||(length===best.length&&Math.abs(y-height/2)<Math.abs(best.y-height/2))))best={start,end:x-1,y,length};}
    if(best){for(const id of [...graph.nodes.keys()])graph.removeNode(id);const endpoints=[best.start,best.end].map((x,i)=>graph.addNode({id:`auto-open-${i}`,x:(x+.5)*sx,y:(best.y+.5)*sy,worldX:(x+.5)*sx*metersPerPixel,worldY:(best.y+.5)*sy*metersPerPixel,floorId:'floor-1',type:'Corridor'}).node);graph.addEdge({source:endpoints[0].id,target:endpoints[1].id,edgeType:'Walkway'});}
  }
  // Collapse only straight chains; bends remain explicit, so no shortcut crosses a wall.
  for(const node of [...graph.nodes.values()]){const links=[...graph.adjacency.get(node.id)];if(links.length!==2)continue;const ends=links.map(id=>{const e=graph.edges.get(id);return graph.nodes.get(e.source===node.id?e.target:e.source);});const [a,b]=ends;if(Math.abs((node.x-a.x)*(b.y-node.y)-(node.y-a.y)*(b.x-node.x))>1e-6)continue;graph.removeNode(node.id);graph.addEdge({source:a.id,target:b.id,edgeType:'Walkway'});}
  return graph;
}

// Trace directed cell edges; right turns keep diagonal contacts as separate simple polygons.
export function maskContours(mask,width,height,sx=1,sy=1,tolerance=.8) {
  const edges=new Map(),key=(x,y)=>`${x},${y}`;
  const add=(x,y,a,b)=>{const k=key(x,y);if(!edges.has(k))edges.set(k,[]);edges.get(k).push([a,b]);};
  const inside=(x,y)=>x>=0&&y>=0&&x<width&&y<height&&mask[y*width+x];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(inside(x,y)){
    if(!inside(x,y-1))add(x,y,x+1,y);
    if(!inside(x+1,y))add(x+1,y,x+1,y+1);
    if(!inside(x,y+1))add(x+1,y+1,x,y+1);
    if(!inside(x-1,y))add(x,y+1,x,y);
  }
  const contours=[];
  while(edges.size){
    const start=edges.keys().next().value;let current=start,previous=null;const points=[];
    do {
      const [x,y]=current.split(',').map(Number);points.push({x:x*sx,y:y*sy});
      const choices=edges.get(current);if(!choices?.length)throw new Error('Could not close detected geometry contour.');
      let index=0;
      if(previous&&choices.length>1){const dx=x-previous[0],dy=y-previous[1];index=choices.findIndex(([a,b])=>dx*(b-y)-dy*(a-x)>0);if(index<0)index=0;}
      const [next]=choices.splice(index,1);if(!choices.length)edges.delete(current);previous=[x,y];current=key(...next);
    }while(current!==start);
    const loops=[points];
    for(let loopIndex=0;loopIndex<loops.length;loopIndex++){
      const loop=loops[loopIndex],visited=new Map();let split=false;
      for(let i=0;i<loop.length;i++){
        const k=key(loop[i].x,loop[i].y);
        if(visited.has(k)){const first=visited.get(k);loops[loopIndex]=loop.slice(first,i);loops.push([...loop.slice(0,first),...loop.slice(i)]);loopIndex--;split=true;break;}
        visited.set(k,i);
      }
      if(split)continue;
    const simplified=loop.filter((p,i)=>{const a=loop[(i+loop.length-1)%loop.length],b=loop[(i+1)%loop.length];return Math.abs((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x))>1e-8;});
    if(simplified.length>=3){const signed=simplified.reduce((sum,p,i)=>{const n=simplified[(i+1)%simplified.length];return sum+p.x*n.y-n.x*p.y;},0);contours.push({points:simplifyContour(simplified,tolerance*Math.min(sx,sy)),hole:signed<0});}
    }
  }
  return contours;
}

function contourArea(points){return points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2;}


// shortcut: four triangular pockets identify an X symbol; ambiguous partitions remain for review.
function crossedEnclosures(regions,width,height){
  const turn=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const chain=points=>{const result=[];for(const p of points){while(result.length>1&&turn(result.at(-2),result.at(-1),p)<=0)result.pop();result.push(p);}return result;};
  const hull=points=>{const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);return [...chain(sorted).slice(0,-1),...chain([...sorted].reverse()).slice(0,-1)];};
  const triangles=[];
  for(const cells of regions){
    const mask=new Uint8Array(width*height);for(const i of cells)mask[i]=1;
    for(const contour of maskContours(mask,width,height))if(!contour.hole){
      const points=simplifyContour(hull(contour.points),1.6);
      if(points.length===3&&cells.length>=Math.abs(contourArea(points))*.3)triangles.push({points,cells});
    }
  }
  const crosses=[],used=new Set();
  for(const triangle of triangles)if(!used.has(triangle))for(const vertex of triangle.points){
    const group=triangles.filter(t=>!used.has(t)&&t.points.some(p=>Math.hypot(p.x-vertex.x,p.y-vertex.y)<=5));
    if(group.length!==4)continue;
    const centers=group.map(t=>t.points.reduce((a,b)=>Math.hypot(a.x-vertex.x,a.y-vertex.y)<Math.hypot(b.x-vertex.x,b.y-vertex.y)?a:b));
    const center={x:centers.reduce((n,p)=>n+p.x,0)/4,y:centers.reduce((n,p)=>n+p.y,0)/4};
    const outer=group.flatMap(t=>t.points.filter(p=>Math.hypot(p.x-center.x,p.y-center.y)>5)).sort((a,b)=>a.x-b.x||a.y-b.y);
    const corners=simplifyContour(hull(outer),2);
    if(corners.length!==4||!pointInPolygon(center,corners))continue;
    const area=Math.abs(contourArea(corners)),total=group.reduce((sum,t)=>sum+t.cells.length,0);
    if(total<area*.65||total>area*1.05)continue;
    crosses.push({center,corners});group.forEach(t=>used.add(t));break;
  }
  return crosses;
}
