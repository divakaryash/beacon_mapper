import { segmentProjection } from './floorGeometry.js';
import { NavigationGraph } from './navigationGraph.js';

const rectangle=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const category=text=>[/\bescalator/i,'Escalator',/\b(lift|elevator)\b/i,'Lift',/\bstair/i,'Stairs',/\bexit\b/i,'Exit',/\bentrance\b/i,'Entrance',/\batrium\b/i,'Atrium',/\b(shop|store|outlet)\b/i,'Store'].reduce((found,value,i,list)=>found||(i%2===0&&value.test(text)?list[i+1]:null),null);

// ponytail: bounded monochrome segmentation, not semantic vision; use a trained detector for coloured plans and unlabeled symbols.
export function analyzeFloorPlan({data,width,height,drawingWidth=width,drawingHeight=height,metersPerPixel,labels=[]}) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<3||height<3||width*height>40000||![drawingWidth,drawingHeight].every(v=>Number.isFinite(v)&&v>0)||!Array.isArray(labels)||data.length!==width*height*4||!(metersPerPixel>0)||!Number.isFinite(metersPerPixel))throw new Error('Invalid analysis raster or scale.');
  const size=width*height,ink=new Uint8Array(size),closed=new Uint8Array(size),outside=new Uint8Array(size),free=new Uint8Array(size),sx=drawingWidth/width,sy=drawingHeight/height;
  const neighbors=i=>[i-width,i+1,i+width,i-1].filter(j=>j>=0&&j<size&&(Math.floor(i/width)===Math.floor(j/width)||i%width===j%width));
  for(let i=0;i<size;i++){const p=i*4,alpha=data[p+3]/255;ink[i]=((.2126*data[p]+.7152*data[p+1]+.0722*data[p+2])*alpha+255*(1-alpha))<180?1:0;}
  // Close one-cell gaps for exterior classification only; real door openings remain walkable.
  const dilated=ink.map((v,i)=>v||neighbors(i).some(j=>ink[j])?1:0);
  for(let i=0;i<size;i++)closed[i]=dilated[i]&&neighbors(i).every(j=>dilated[j])?1:0;
  const queue=[];
  for(let i=0;i<size;i++)if((i<width||i>=size-width||i%width===0||i%width===width-1)&&!closed[i]){outside[i]=1;queue.push(i);}
  for(let k=0;k<queue.length;k++)for(const j of neighbors(queue[k]))if(!closed[j]&&!outside[j]){outside[j]=1;queue.push(j);}
  for(let i=0;i<size;i++)free[i]=!outside[i]&&!ink[i]?1:0;
  // Discard text-sized pockets, retaining disconnected rooms for review rather than routing through walls.
  const seen=new Uint8Array(size),regions=[];
  for(let i=0;i<size;i++)if(free[i]&&!seen[i]){const cells=[i];seen[i]=1;for(let k=0;k<cells.length;k++)for(const j of neighbors(cells[k]))if(free[j]&&!seen[j]){seen[j]=1;cells.push(j);}if(cells.length<9)cells.forEach(j=>free[j]=0);else regions.push(cells);}
  if(!regions.length)throw new Error('No enclosed walkable regions detected. Use a clearer wall drawing or correct the building boundary manually.');
  const objects=[],add=(type,points,extra={})=>objects.push({id:`auto-${type}-${objects.length+1}`,type,points,layerId:type==='walkableArea'?'walkableAreas':type==='room'?'rooms':'walls',floorId:'floor-1',rotation:0,origin:'automatic',...extra});
  function rectangles(mask,type){const active=new Map();for(let y=0;y<height;y++){const row=new Map();for(let x=0;x<width;){if(!mask[y*width+x]){x++;continue;}const start=x;while(x<width&&mask[y*width+x])x++;const key=`${start}:${x}`,prior=active.get(key);row.set(key,prior?{...prior,h:prior.h+1}:{x:start,y,w:x-start,h:1});}for(const [key,r] of active)if(!row.has(key))add(type,rectangle(r.x*sx,r.y*sy,r.w*sx,r.h*sy));active.clear();for(const entry of row)active.set(...entry);}for(const r of active.values())add(type,rectangle(r.x*sx,r.y*sy,r.w*sx,r.h*sy));}
  // Trace the exterior cell contour; wall/void masks keep interior holes out of coverage.
  const segments=new Map(),key=(x,y)=>`${x},${y}`,segment=(x,y,a,b)=>{const k=key(x,y);if(!segments.has(k))segments.set(k,[]);segments.get(k).push([a,b]);};
  const envelope=new Uint8Array(size),interior=regions.flat();
  for(const i of interior)envelope[i]=1;
  for(let k=0;k<interior.length;k++)for(const j of neighbors(interior[k]))if(!outside[j]&&!envelope[j]){envelope[j]=1;interior.push(j);}
  const inside=(x,y)=>x>=0&&y>=0&&x<width&&y<height&&envelope[y*width+x];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(inside(x,y)){if(!inside(x,y-1))segment(x,y,x+1,y);if(!inside(x+1,y))segment(x+1,y,x+1,y+1);if(!inside(x,y+1))segment(x+1,y+1,x,y+1);if(!inside(x-1,y))segment(x,y+1,x,y);}
  while(segments.size){const start=segments.keys().next().value;let current=start;const points=[];do{const [x,y]=current.split(',').map(Number);points.push({x:x*sx,y:y*sy});const next=segments.get(current)?.pop();if(!next)break;if(!segments.get(current).length)segments.delete(current);current=key(...next);}while(current!==start&&points.length<size*4);const simplified=points.filter((p,i)=>{const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];return (p.x-a.x)*(b.y-p.y)!==(p.y-a.y)*(b.x-p.x);});if(simplified.length>=3)add('buildingBoundary',simplified);}
  rectangles(free,'walkableArea');
  rectangles(ink.map((v,i)=>v&&!outside[i]?1:0),'nonWalkableArea');
  for(const object of objects)if(object.type==='nonWalkableArea')object.category='Wall';
  const graph=graphFromWalkableMask({free,width,height,drawingWidth,drawingHeight,metersPerPixel});
  for(const cells of regions){const xs=cells.map(i=>i%width),ys=cells.map(i=>Math.floor(i/width)),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);if(cells.length<Math.max(...regions.map(r=>r.length))&&cells.length/((maxX-minX+1)*(maxY-minY+1))>.7)add('room',rectangle(minX*sx,minY*sy,(maxX-minX+1)*sx,(maxY-minY+1)*sy),{name:'Possible room',category:'Room',geometryRole:'none'});}
  for(const node of graph.nodes.values())if(graph.adjacency.get(node.id).size>=3)node.type='Junction';
  const regionAt=new Int32Array(size).fill(-1);
  regions.forEach((cells,index)=>cells.forEach(i=>regionAt[i]=index));
  for(const label of labels){
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
  return {objects,graph:graph.serialize(),analysis:{method:'bounded-raster-topology',resolution:{width,height},status:'needs-review',warnings:['Geometry is inferred from dark lines and enclosed light regions. Review open boundaries, text artifacts, rooms and door connections.','Lift, escalator, stair, entrance and exit recognition uses PDF/SVG text labels only; unlabeled symbols and raster text require manual confirmation.','Placement is a bounded geometry-based heuristic, not a guaranteed global optimum or RF coverage prediction.'],regions:regions.length,detected:{boundaries:objects.filter(o=>o.type==='buildingBoundary').length,walkableRegions:regions.length,walls:objects.filter(o=>o.category==='Wall').length,roomCandidates:objects.filter(o=>o.type==='room').length,labeledLandmarks:objects.filter(o=>o.type==='poi').length}}};
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
  // Collapse only straight chains; bends remain explicit, so no shortcut crosses a wall.
  for(const node of [...graph.nodes.values()]){const links=[...graph.adjacency.get(node.id)];if(links.length!==2)continue;const ends=links.map(id=>{const e=graph.edges.get(id);return graph.nodes.get(e.source===node.id?e.target:e.source);});const [a,b]=ends;if(Math.abs((node.x-a.x)*(b.y-node.y)-(node.y-a.y)*(b.x-node.x))>1e-6)continue;graph.removeNode(node.id);graph.addEdge({source:a.id,target:b.id,edgeType:'Walkway'});}
  return graph;
}
