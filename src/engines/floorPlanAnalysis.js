import {auditoriumCaption,transportLobbyCaption,destinationCategory,isDestinationCaption,hasShopIdentifiers} from '../models/destinationCategory.js';
import {facilityBlocks} from "./facilityBlocks.js";
import {polygonArea,simplifyContour,straightenPillarNotches} from "./geometry.js";
import { segmentProjection,pointInPolygon,selfIntersects,compileFloorGeometry,geometryConflict,validGraphIntervals } from './floorGeometry.js';
import { NavigationGraph } from './navigationGraph.js';
import {simplifyNarrowContour,straightenRasterStairs} from './rasterStairs.js';

const rectangle=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];

// Close narrow breaks in the building footprint independently of the room and
// wall masks. Larger gaps between buildings stay open.
export function closeFootprint(mask,width,height,radius){
  function neighborhood(source,erode){
    const stride=width+1,sum=new Uint32Array(stride*(height+1));
    for(let y=0;y<height;y++){
      let row=0;
      for(let x=0;x<width;x++){
        row+=source[y*width+x];
        sum[(y+1)*stride+x+1]=row+sum[y*stride+x+1];
      }
    }
    return source.map((_,i)=>{
      const x=i%width,y=Math.floor(i/width),left=Math.max(0,x-radius),top=Math.max(0,y-radius);
      const right=Math.min(width,x+radius+1),bottom=Math.min(height,y+radius+1);
      const count=sum[bottom*stride+right]-sum[top*stride+right]-sum[bottom*stride+left]+sum[top*stride+left];
      return erode?count===(right-left)*(bottom-top):count>0;
    });
  }
  return neighborhood(neighborhood(mask,false),true);
}

function fitRectangularRoom(points,tolerance){
  if(points.length<5)return points;
  // The longest face supplies a local orientation, including diagonal wings.
  let longest=0,ux=1,uy=0;
  for(const [i,a] of points.entries()){
    const b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
    if(length>longest){longest=length;ux=dx/length;uy=dy/length;}
  }
  const local=points.map(p=>({x:p.x*ux+p.y*uy,y:p.y*ux-p.x*uy}));
  const xs=local.map(p=>p.x),ys=local.map(p=>p.y);
  const left=Math.min(...xs),top=Math.min(...ys),w=Math.max(...xs)-left,h=Math.max(...ys)-top;
  if(Math.min(w,h)<6*tolerance||Math.abs(contourArea(points))<.96*w*h)return points;
  const sides=p=>Math.min(p.x-left,left+w-p.x,p.y-top,top+h-p.y);
  for(const [i,p] of local.entries()){
    const q=local[(i+1)%local.length];
    if(sides(p)>tolerance||sides({x:(p.x+q.x)/2,y:(p.y+q.y)/2})>tolerance)return points;
  }
  const box=rectangle(left,top,w,h);
  if(box.some(c=>!local.some(p=>Math.hypot(c.x-p.x,c.y-p.y)<=1.5*tolerance)))return points;
  return box.map(p=>({x:p.x*ux-p.y*uy,y:p.x*uy+p.y*ux}));
}
const category=text=>transportLobbyCaption.test(text)?'Lobby':[/\bescalator/i,'Escalator',/\b(lift|elevator)\b/i,'Lift',/\bstair/i,'Stairs',/\bexit\b/i,'Exit',/\b(?:entrance|entry)\b/i,'Entrance',/\batrium\b/i,'Atrium',/\b(shop|store|outlet)\b/i,'Store'].reduce((found,value,i,list)=>found||(i%2===0&&value.test(text)?list[i+1]:null),null);

// A thin stroke embedded in one space is weak evidence for a raised partition.
// Use the original regions for all decisions so growing a floor cannot move a divider.
function partitionWalls(ink,outside,regions,width,height){
  const owner=new Int32Array(ink.length);
  regions.forEach((cells,index)=>{for(const i of cells)owner[i]=index+1;});
  const walls=new Uint8Array(ink.length),solid=new Uint8Array(ink.length),recover=new Int32Array(ink.length);
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x;
    if(!ink[i])continue;
    let filled=true;
    for(let dy=-1;dy<=1&&filled;dy++)for(let dx=-1;dx<=1;dx++)if(!ink[i+dy*width+dx]){filled=false;break;}
    if(filled)for(let dy=-1;dy<=1;dy++)solid.fill(1,i+dy*width-1,i+dy*width+2);
  }
  const radius=Math.max(3,Math.min(8,Math.round(Math.max(width,height)/200)));
  const directions=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
  for(let i=0;i<ink.length;i++){
    if(!ink[i]||outside[i])continue;
    const x=i%width,y=Math.floor(i/width);
    let region=0,divider=false,exterior=false;
    for(const [dx,dy] of directions){
      for(let step=1;step<=radius;step++){
        const nx=x+dx*step,ny=y+dy*step;
        if(nx<0||ny<0||nx>=width||ny>=height){exterior=true;break;}
        const j=ny*width+nx;
        if(outside[j]){exterior=true;break;}
        if(owner[j]){
          if(region&&region!==owner[j])divider=true;
          region=owner[j];break;
        }
      }
    }
    if(solid[i]||region&&(exterior||divider))walls[i]=1;
    else if(region)recover[i]=region;
  }
  // Isolated short remnants of a line are common at hatch intersections.
  // A compact, filled post still has evidence for a physical footprint.
  const visited=new Uint8Array(ink.length);
  for(let i=0;i<walls.length;i++){
    if(!walls[i]||visited[i])continue;
    const cells=[i];visited[i]=1;
    let left=i%width,right=left,top=Math.floor(i/width),bottom=top,core=false;
    for(let k=0;k<cells.length;k++){
      const p=cells[k],x=p%width,y=Math.floor(p/width);
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);core||=!!solid[p];
      for(const j of [p-width,p+width,p-1,p+1]){
        if(!walls[j]||visited[j]||Math.abs(x-j%width)>1)continue;
        visited[j]=1;cells.push(j);
      }
    }
    const w=right-left+1,h=bottom-top+1;
    if(Math.max(w,h)>radius||core&&Math.min(w,h)>=3&&cells.length>=w*h*.75)continue;
    for(const p of cells)walls[p]=0;
  }
  regions.forEach((cells,index)=>{
    for(let k=0;k<cells.length;k++){
      const i=cells[k];
      for(const j of [i-width,i+width,i-1,i+1]){
        if(recover[j]!==index+1||Math.abs(i%width-j%width)>1)continue;
        recover[j]=0;cells.push(j);
      }
    }
  });
  // Recover small enclosed pockets (for example between hatch strokes) only
  // when every adjoining floor cell belongs to the same retained space.
  regions.forEach((cells,index)=>{for(const i of cells)owner[i]=index+1;});
  for(let i=0;i<ink.length;i++){
    if(owner[i]||ink[i]||outside[i])continue;
    const pocket=[i];owner[i]=-1;
    let adjoining=0,ambiguous=false;
    for(let k=0;k<pocket.length;k++){
      const cell=pocket[k];
      for(const j of [cell-width,cell+width,cell-1,cell+1]){
        if(j<0||j>=ink.length||Math.abs(cell%width-j%width)>1||outside[j])continue;
        if(owner[j]>0){
          if(adjoining&&adjoining!==owner[j])ambiguous=true;
          adjoining=owner[j];
        }else if(!owner[j]&&!ink[j]){
          owner[j]=-1;pocket.push(j);
        }
      }
    }
    if(!ambiguous&&adjoining&&pocket.length<Math.max(9,ink.length*.00035)){
      for(const cell of pocket)regions[adjoining-1].push(cell);
    }
  }
  return walls;
}

// shortcut: raster segmentation cannot distinguish every CAD annotation from a wall; review the draft before deployment.
export function analyzeFloorPlan({data,width,height,drawingWidth=width,drawingHeight=height,metersPerPixel,labels=[],openingSegments=[],doorRooms=[],shopFaces=[],liftBanks=[],vectorWallBands=[],excludeDrawingFrame=false,crossMarksRemoved=false,annotationOnly=false}) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<3||height<3||width*height>(annotationOnly?1000000:400000)||![drawingWidth,drawingHeight].every(v=>Number.isFinite(v)&&v>0)||!Array.isArray(labels)||data.length!==width*height*4||!(metersPerPixel>0)||!Number.isFinite(metersPerPixel))throw new Error('Invalid analysis raster or scale.');
  const size=width*height,ink=new Uint8Array(size),closed=new Uint8Array(size),outside=new Uint8Array(size),free=new Uint8Array(size),sx=drawingWidth/width,sy=drawingHeight/height;
  const neighbors=i=>[i-width,i+1,i+width,i-1].filter(j=>j>=0&&j<size&&(Math.floor(i/width)===Math.floor(j/width)||i%width===j%width));
  // Pale CAD walls can be bright in luminance while retaining contrast in one colour channel.
  for(let i=0;i<size;i++){const p=i*4,alpha=data[p+3]/255;ink[i]=(Math.min(data[p],data[p+1],data[p+2])*alpha+255*(1-alpha))<235?1:0;}
  if(annotationOnly)recoverFaintPartitions(data,ink,width,height);
  if(excludeDrawingFrame){
    stripSheetRules(ink,width,height);
    const columns=[];
    for(let x=0;x<width;x++)if(x<width*.15||x>width*.85){let count=0,branches=0;for(let y=0;y<height;y++)if(ink[y*width+x]){count++;if((x>1&&ink[y*width+x-2])||(x<width-2&&ink[y*width+x+2]))branches++;}if(count>height*.35&&branches<=Math.max(4,height*.025))columns.push(x);}
    const left=columns.find(x=>x<width*.15),right=columns.findLast(x=>x>width*.85);
    if(left!==undefined&&right!==undefined&&right-left>width*.75)for(const x of columns)if(x<=left+2||x>=right-2)for(let y=0;y<height;y++)ink[y*width+x]=0;
    for(let y=0;y<height;y++)if(y<height*.03||y>height*.97)for(let x=0;x<width;){if(!ink[y*width+x]){x++;continue;}const start=x;let branches=0;while(x<width&&ink[y*width+x]){if((y>1&&ink[(y-2)*width+x])||(y<height-2&&ink[(y+2)*width+x]))branches++;x++;}if(x-start>width*.25&&branches<=Math.max(4,width*.04))for(let i=start;i<x;i++)ink[y*width+i]=0;}
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
  // Reinstate the measured thickness of paired PDF wall faces. Fill only their
  // overlapping lengths so real openings remain open in the physical wall mask.
  for(const band of vectorWallBands){
    const xs=band.map(p=>p.x/sx),ys=band.map(p=>p.y/sy);
    const left=Math.max(0,Math.floor(Math.min(...xs))),right=Math.min(width-1,Math.ceil(Math.max(...xs)));
    const top=Math.max(0,Math.floor(Math.min(...ys))),bottom=Math.min(height-1,Math.ceil(Math.max(...ys)));
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)
      if(pointInPolygon({x:(x+.5)*sx,y:(y+.5)*sy},band))ink[y*width+x]=1;
  }
  // Square closing seals tiny annotation gaps; navigation keeps its original exterior-only closing.
  const closingNeighbors=i=>annotationOnly?[...neighbors(i),...[-width-1,-width+1,width-1,width+1].map(d=>i+d).filter(j=>j>=0&&j<size&&Math.abs(i%width-j%width)===1)]:neighbors(i);
  const dilated=ink.map((v,i)=>v||closingNeighbors(i).some(j=>ink[j])?1:0);
  for(let i=0;i<size;i++)closed[i]=dilated[i]&&closingNeighbors(i).every(j=>dilated[j])?1:0;
  const doorwayGaps=[];
  if(annotationOnly){
    const rasterSpan=Math.max(width,height);
    const metricGap=2.4/(metersPerPixel*Math.sqrt(sx*sy));
    // Below sampling resolution the scale supplies no usable doorway width.
    const maxGap=metricGap<1 ? rasterSpan*.006 : Math.min(metricGap,rasterSpan*.01);
    closeDoorGaps(closed,width,height,Math.ceil(maxGap),(x,y,dx,dy,length)=>{
      const metres=length*Math.hypot(dx*sx,dy*sy)*metersPerPixel;
      if(metres>=.65&&metres<=1.8)doorwayGaps.push({x,y,dx,dy});
    });
  }
  const openings=[];
  if(annotationOnly)for(const segment of openingSegments){
    const {a,b}=segment;
    if(!a||!b||![a.x,a.y,b.x,b.y].every(v=>Number.isFinite(v)&&v>=0&&v<1))continue;
    const ax=a.x*width,ay=a.y*height,dx=b.x*width-ax,dy=b.y*height-ay;
    const length=Math.hypot(dx,dy);
    if(length<2||length>Math.max(width,height)*.023)continue;
    // Close the threshold in the region mask only. The wall polygons retain the opening.
    const steps=Math.ceil(length*2);
    // Symbols may end at the jamb centre, between sampled pixels of the wall.
    for(let n=-2;n<=steps+2;n++){
      const x=Math.floor(ax+dx*n/steps),y=Math.floor(ay+dy*n/steps);
      if(x>=0&&x<width&&y>=0&&y<height)closed[y*width+x]=1;
    }
    openings.push({x:(ax+dx/2)*sx,y:(ay+dy/2)*sy,radius:length*Math.max(sx,sy),source:segment.source||'door swing and leaf'});
  }
  // The four fitted wall faces and swing threshold bound a room even if the
  // sampling grid lost its jamb. The threshold stays out of the wall mesh.
  for(const candidate of [...doorRooms,...liftBanks,...shopFaces])for(const [i,a] of candidate.points.entries()){
    const b=candidate.points[(i+1)%candidate.points.length],ax=a.x/sx,ay=a.y/sy,dx=b.x/sx-ax,dy=b.y/sy-ay;
    const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)*2));
    for(let k=0;k<=steps;k++){
      const x=Math.floor(ax+k*dx/steps),y=Math.floor(ay+k*dy/steps);
      if(x>=0&&x<width&&y>=0&&y<height)closed[y*width+x]=1;
    }
  }
  const structuralSeeds=new Map();
  for(const candidate of [...doorRooms,...liftBanks,...shopFaces.filter(f=>f.detailed)]){
    const ring=candidate.points.map(p=>({x:p.x/sx,y:p.y/sy}));
    const xs=ring.map(p=>p.x),ys=ring.map(p=>p.y);
    const x0=Math.max(0,Math.floor(Math.min(...xs))),x1=Math.min(width-1,Math.ceil(Math.max(...xs)));
    const y0=Math.max(0,Math.floor(Math.min(...ys))),y1=Math.min(height-1,Math.ceil(Math.max(...ys)));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const p={x:x+.5,y:y+.5};
      if(pointInPolygon(p,ring)&&ring.every((a,i)=>segmentProjection(p,a,ring[(i+1)%ring.length]).distance>1.15))closed[y*width+x]=0;
    }
    if(candidate.detailed)continue;
    const cx=Math.floor((xs[0]+xs[2])/2),cy=Math.floor((ys[0]+ys[2])/2);
    structuralSeeds.set(cy*width+cx,candidate);
  }
  const queue=[];
  for(let i=0;i<size;i++)if((i<width||i>=size-width||i%width===0||i%width===width-1)&&!closed[i]){outside[i]=1;queue.push(i);}
  for(let k=0;k<queue.length;k++)for(const j of neighbors(queue[k]))if(!closed[j]&&!outside[j]){outside[j]=1;queue.push(j);}
  // Seal one-cell drawing gaps for annotation contours; navigation retains real openings.
  for(let i=0;i<size;i++)free[i]=!outside[i]&&!(annotationOnly?closed[i]:ink[i])?1:0;
  // Discard text-sized pockets, retaining disconnected rooms for review rather than routing through walls.
  const seen=new Uint8Array(size),regions=[];
  const captionCells=new Set(labels.filter(l=>l.source!=='ocr'||l.confidence>=80).filter(l=>
    destinationCategory(l.text)||/\b(?:room|office|ward|lab|lift|stair|store|pantry)\b/i.test(l.text)).map(l=>
    Math.floor((l.y-(l.height||0)/2)/sy)*width+Math.floor((l.x+(l.width||0)/2)/sx)));
  const swingSeeds=new Set();
  for(const {a,b,swingTip} of openingSegments){
    if(!swingTip)continue;
    const x=Math.floor(((a.x+b.x)/2+.45*(swingTip.x-a.x))*width);
    const y=Math.floor(((a.y+b.y)/2+.45*(swingTip.y-a.y))*height);
    if(x>=0&&x<width&&y>=0&&y<height)swingSeeds.add(y*width+x);
  }
  // Perimeter canopy notes are often plotted just beyond the outline, rotated
  // along its edge. Test the printed extent rather than only its text centre.
  const canopyNotes=annotationOnly?labels.filter(l=>/^(?:external |entrance )?canopy(?:$|\s+(?:at|above|over|[+\d]))/i.test(l.text.trim())&&
    (l.confidence??100)>=85&&l.width>0&&l.height>0).map(l=>({
      left:l.x/sx,right:(l.x+l.width)/sx,top:(l.y-l.height)/sy,bottom:l.y/sy,
      vertical:l.height>l.width})): [];
  function alongsideCanopy(cells){
    return canopyNotes.some(note=>{
      const longitudinal=new Set();
      for(const i of cells){
        const x=i%width+.5,y=Math.floor(i/width)+.5;
        const dx=Math.max(0,note.left-x,x-note.right),dy=Math.max(0,note.top-y,y-note.bottom);
        const peripheral=note.vertical?(note.left<width*.08||note.right>width*.92):(note.top<height*.08||note.bottom>height*.92);
        if(dx===0&&dy===0||peripheral&&(note.vertical?dy===0&&dx*sx*metersPerPixel<1.35:dx===0&&dy*sy*metersPerPixel<1.35))
          longitudinal.add(Math.floor(note.vertical?y:x));
      }
      return longitudinal.size*(note.vertical?sy:sx)*metersPerPixel>=.55;
    });
  }
  for(let i=0;i<size;i++)if(free[i]&&!seen[i]){
    const cells=[i];seen[i]=1;
    for(let k=0;k<cells.length;k++)for(const j of neighbors(cells[k]))if(free[j]&&!seen[j]){
      seen[j]=1;cells.push(j);
    }
    const named=annotationOnly&&cells.some(j=>captionCells.has(j)||structuralSeeds.has(j));
    const minimum=(named||cells.some(i=>swingSeeds.has(i)))?Math.max(16,size*.00005):Math.max(9,size*.00035);
    if(cells.length<minimum||(!named&&alongsideCanopy(cells)))cells.forEach(j=>free[j]=0);
    else regions.push(cells);
  }
  if(!regions.length&&excludeDrawingFrame)return analyzeFloorPlan({data,width,height,drawingWidth,drawingHeight,metersPerPixel,labels,openingSegments,doorRooms,shopFaces,liftBanks,vectorWallBands,annotationOnly,excludeDrawingFrame:false});
  if(!regions.length)throw new Error('No enclosed walkable regions detected. Use a clearer wall drawing or correct the building boundary manually.');
  if(!crossMarksRemoved){
    const crosses=crossedEnclosures(regions,width,height);
    if(crosses.length){
      const cleaned=new Uint8ClampedArray(data);
      for(const cross of crosses){
        if(cross.regions){
          const sectors=new Int32Array(size).fill(-1);
          cross.regions.forEach((cells,index)=>cells.forEach(i=>{sectors[i]=index;}));
          for(let i=0;i<size;i++)if(ink[i]){
            const x=i%width,y=Math.floor(i/width);let first=-1,divider=false,exterior=false;
            for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
              if(x+dx<0||x+dx>=width||y+dy<0||y+dy>=height)continue;
              const j=(y+dy)*width+x+dx,sector=sectors[j];
              if(sector<0){if(free[j])exterior=true;continue;}
              if(first>=0&&sector!==first)divider=true;first=sector;
            }
            if(divider&&!exterior){const offset=i*4;cleaned[offset]=cleaned[offset+1]=cleaned[offset+2]=255;}
          }
          continue;
        }
        const {center,corners}=cross;
        for(let i=0;i<size;i++)if(ink[i]){
          const p={x:i%width+.5,y:Math.floor(i/width)+.5};
          if(!pointInPolygon(p,corners)||corners.some((a,j)=>segmentProjection(p,a,corners[(j+1)%corners.length]).distance<2))continue;
          if(corners.some(corner=>segmentProjection(p,center,corner).distance<=4)){
            const offset=i*4;cleaned[offset]=cleaned[offset+1]=cleaned[offset+2]=255;
          }
        }
      }
      return analyzeFloorPlan({data:cleaned,width,height,drawingWidth,drawingHeight,metersPerPixel,labels,openingSegments,doorRooms,shopFaces,liftBanks,vectorWallBands,annotationOnly,excludeDrawingFrame,crossMarksRemoved:true});
    }
  }
  const wallMask=annotationOnly?partitionWalls(ink,outside,regions,width,height):ink.map((v,i)=>v&&!outside[i]?1:0);
  const objects=[],add=(type,points,extra={})=>{if(type==='room'&&!extra.holes?.length){const straight=straightenPillarNotches(points,1.5/metersPerPixel);if(!selfIntersects(straight))points=straight;}objects.push({id:`auto-${type}-${objects.length+1}`,type,points,layerId:type==='walkableArea'?'walkableAreas':type==='room'?'rooms':'walls',floorId:'floor-1',rotation:0,origin:'automatic',...extra});};
  const envelope=new Uint8Array(size),interior=regions.flat();
  for(const i of interior)envelope[i]=1;
  // Only include nearby wall thickness, not an entire connected exterior annotation/frame network.
  let border=interior;for(let pass=0;pass<2;pass++){const next=[];for(const i of border)for(const j of neighbors(i))if(!outside[j]&&!envelope[j]){envelope[j]=1;next.push(j);}border=next;}
  const shell=annotationOnly?closeFootprint(envelope,width,height,Math.min(4,Math.max(1,Math.round(.5/(metersPerPixel*Math.max(sx,sy)))))):envelope;
  for(const contour of maskContours(shell,width,height,sx,sy))if(!contour.hole)add('buildingBoundary',contour.points);
  // Smaller enclosed regions are room candidates; use their contours, never their bounding boxes.
  const largest=Math.max(...regions.map(r=>r.length));
  const sortedAreas=regions.map(cells=>cells.length).sort((a,b)=>a-b);
  const typicalArea=sortedAreas[Math.floor(sortedAreas.length/2)];
  const regionSamples=regions.map(([cell])=>({x:(cell%width+.5)*sx,y:(Math.floor(cell/width)+.5)*sy}));
  const passageLabels=labels.filter(label=>(/\b(?:corridor|passage|hallway)\b/i.test(label.text)||
    /^\s*(?:parking(?:\s+area)?|(?:stp\s+)?ramp(?:\s|\(|$))/i.test(label.text)&&!/\b(?:office|room|store|shaft)\b/i.test(label.text))&&
    (label.source!=='ocr'||label.confidence>=75)).map(label=>({
      x:Math.floor((label.x+(label.width||0)/2)/sx),
      y:Math.floor((label.y-(label.height||0)/2)/sy),
    })).filter(p=>p.x>=0&&p.x<width&&p.y>=0&&p.y<height);
  const regionKind=new Int32Array(size),roomByIndex=[null];
  let roomCount=0;
  const voidLabels=annotationOnly?labels.filter(l=>(l.confidence??100)>=85&&
    /^(?:void|open to below)$/i.test(l.text.trim())):[];
  for(const cells of regions) {
    const mask=new Uint8Array(size);for(const i of cells)mask[i]=1;
    let minX=width,maxX=0,minY=height,maxY=0;
    for(const i of cells){const x=i%width,y=Math.floor(i/width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    const boxArea=(maxX-minX+1)*(maxY-minY+1);
    const enclosedStore=cells.length/interior.length<.55&&cells.length/boxArea>.65;
    // Door closure can split circulation below the largest shop; size alone must not turn it into a room.
    const largeFragment=cells.length>=4*typicalArea&&regions.length>=6;
    const fitted=structuralSeeds.get(cells.find(i=>structuralSeeds.has(i)));
    const fitRatio=fitted?cells.length*sx*sy/polygonArea(fitted.points):0;
    // The closed car and sill can consume a large part of a small shaft on
    // the raster. Its repeated crossed vector enclosure gives the full extent.
    const backed=fitted&&fitRatio>(liftBanks.includes(fitted)?.48:.74)&&fitRatio<1.26&&
      cells.filter(i=>pointInPolygon({x:(i%width+.5)*sx,y:(Math.floor(i/width)+.5)*sy},fitted.points)).length>cells.length*.90?fitted:null;
    const circulation=!backed&&annotationOnly&&(
      (cells.length/boxArea<.5&&(maxX-minX>width*.4||maxY-minY>height*.4))||
      (largeFragment&&resemblesPassage(cells,width))||
      passageLabels.some(p=>mask[p.y*width+p.x])
    );
    const namedRoom=annotationOnly&&cells.some(i=>captionCells.has(i));
    let room=!circulation&&(backed||namedRoom||((cells.length<largest*.6||enclosedStore)&&cells.length>=Math.max(16,size*.0001)));
    const contours=maskContours(mask,width,height,sx,sy,1.25);
    const holes=annotationOnly?contours.filter(contour=>contour.hole):[];
    if(annotationOnly&&!room&&cells.length/boxArea>.25&&contours.length-holes.length===1){
      const outer=contours.find(c=>!c.hole).points;
      const captions=labels.filter(l=>{
        if((l.confidence??100)<78)return false;
        const p={x:l.x+(l.width||0)/2,y:l.y-(l.height||0)/2};
        return pointInPolygon(p,outer)&&!holes.some(h=>pointInPolygon(p,h.points));
      });
      const units=captions.filter(l=>destinationCategory(l.text)==='Shop unit');
      const tenantText=captions.filter(l=>!units.includes(l)&&/[a-z]{3}/i.test(l.text));
      // Several far-apart names around a numbered kiosk describe the shared
      // court. Only use a local caption group to override circulation.
      const namedTenant=units.length===1&&tenantText.length>0&&tenantText.every(l=>{
        const u=units[0],dx=l.x+l.width/2-u.x-u.width/2,dy=l.y-l.height/2-u.y+u.height/2;
        return Math.hypot(dx,dy)<=Math.max(l.height,u.height)*12;
      });
      // Dense seating and shelves fragment the free floor into thin runs.
      // A single enclosed auditorium or storage caption can resolve that
      // shape ambiguity even on floors with many small neighboring rooms.
      const enclosedUse=captions.filter(l=>(l.confidence??100)>=85&&
        (auditoriumCaption.test(l.text)||/^storage(?: room)?$/i.test(l.text.trim())));
      const namedEnclosure=!units.length&&enclosedUse.length===1&&captions.every(l=>
        l===enclosedUse[0]||/^TV$/i.test(l.text.trim()));
      room=((cells.length/boxArea>.38&&units.length===1&&namedTenant)||namedEnclosure)&&
        !captions.some(l=>/\b(?:corridor|lobby|passage|atrium|exit|stair|lift)\b/i.test(l.text));
    }
    for(const contour of contours){
      if(!contour.hole){
        // A printed void can look exactly like an enclosed tenant on the plan.
        // Require the caption inside this face and keep mixed-use faces for review.
        const coversLabel=l=>{
          const center={x:l.x+(l.width||0)/2,y:l.y-(l.height||0)/2};
          return pointInPolygon(center,contour.points)&&!holes.some(h=>pointInPolygon(center,h.points));
        };
        if(room&&voidLabels.some(coversLabel)&&!labels.some(l=>
          !voidLabels.includes(l)&&(l.confidence??100)>=80&&/[a-z]{3}/i.test(l.text)&&coversLabel(l))){
          add('nonWalkableArea',contour.points,{category:'Void',name:'Void',layerId:'restrictedAreas',
            holes:holes.filter(h=>pointInPolygon(h.points[0],contour.points)).map(h=>h.points)});
          continue;
        }
        const properties=room?{name:`Detected room ${++roomCount}`,category:'Room',geometryRole:'nonWalkableArea'}:{};
        const innerRings=holes.filter(hole=>pointInPolygon(hole.points[0],contour.points)).map(hole=>hole.points);
        if(innerRings.length)properties.holes=innerRings;
        const points=annotationOnly&&room&&!innerRings.length?fitRectangularRoom(contour.points,Math.min(1.5*Math.min(sx,sy),.22/metersPerPixel)):contour.points;
        if(backed){
          const shaft=liftBanks.includes(backed);
          if(shaft){properties.category='Lift';properties.name='Lift';}
          properties.metadata={geometrySource:shaft?'Repeated crossed shaft outlines':'PDF doorway and wall faces',needsReview:true};
        }
        add(room?'room':'walkableArea',backed?.points||points,properties);
        if(room)roomByIndex[roomCount]=objects.at(-1);
        if(annotationOnly){
          const multipleOutlines=contours.length-holes.length>1;
          for(const cell of cells){
            if(multipleOutlines&&!pointInPolygon({x:(cell%width+.5)*sx,y:(Math.floor(cell/width)+.5)*sy},contour.points))continue;
            regionKind[cell]=room?roomCount:-1;
          }
        }
        continue;
      }
      if(room||annotationOnly&&regionSamples.some(point=>pointInPolygon(point,contour.points)))continue;
      const facilityHole=facilities.some(block=>contour.points.every(p=>
        p.x>=(block.x-1)*sx&&p.x<=(block.x+block.w+1)*sx&&p.y>=(block.y-1)*sy&&p.y<=(block.y+block.h+1)*sy));
      if(!facilityHole)add('nonWalkableArea',contour.points,{category:'Void',layerId:'restrictedAreas'});
    }
    if(room)for(const i of cells)free[i]=0;
  }
  for(const object of objects)if(object.type==='room'){
    const contained=labels.filter(label=>{
      const center={x:label.x+(label.width||0)/2,y:label.y-(label.height||0)/2};
      return typeof label.text==='string'&&label.text.trim()&&pointInPolygon(center,object.points)&&
        !object.holes?.some(hole=>pointInPolygon(center,hole));
    });
    const meaningful=contained.filter(label=>/[a-z]{2}/i.test(label.text)&&
      !/\b(?:cutouts?|retaining wall|electrical cables)\b|^size\b/i.test(label.text.trim())&&
      !/^(?:[\d., x×-]+(?:mm|m)?|mm (?:wide|height)|f\.?f\.?l\.?|room)$/i.test(label.text.trim()));
    const largestCaption=Math.max(0,...meaningful.map(label=>label.textHeight||label.height||0));
    const names=meaningful.filter(label=>label.source!=='ocr'||(label.confidence>=78&&(destinationCategory(label.text)||(label.textHeight||label.height||0)>=largestCaption*.55)));
    if(names.some(label=>['Lift','Stairs','Escalator'].includes(category(label.text)))){object.category=category(names.find(label=>['Lift','Stairs','Escalator'].includes(category(label.text))).text);object.metadata={sourceType:object.category,groupedAssembly:true};}
    if(names.length)object.name=names.sort((a,b)=>a.y-b.y||a.x-b.x).map(label=>label.text.trim()).filter((name,index,all)=>all.indexOf(name)===index).join(' ');
  }
  const wallContours=maskContours(wallMask,width,height,sx,sy,annotationOnly?1.35:.8);
  const wallPolygons=wallContours.filter(c=>!c.hole).map(c=>({...c,holes:[]}));
  for(const hole of wallContours.filter(c=>c.hole)){
    const containing=wallPolygons.filter(c=>pointInPolygon(hole.points[0],c.points));
    containing.sort((a,b)=>Math.abs(contourArea(a.points))-Math.abs(contourArea(b.points)));
    if(containing[0])containing[0].holes.push(hole.points);
  }
  for(const wall of wallPolygons){
    let interior=0,exterior=0;
    if(annotationOnly)for(const ring of [wall.points,...wall.holes])for(const p of ring){
      const x=Math.floor(p.x/sx),y=Math.floor(p.y/sy);
      for(const [dx,dy] of [[2,0],[-2,0],[0,2],[0,-2]]){
        const xx=x+dx,yy=y+dy;
        if(xx<0||yy<0||xx>=width||yy>=height){exterior++;continue;}
        const i=yy*width+xx;
        if(outside[i])exterior++;
        if(regionKind[i]>0)interior++;
      }
    }
    const wallRole=interior>0&&interior>4*exterior?'room partition':'general wall';
    add('nonWalkableArea',wall.points,{category:'Wall',holes:wall.holes,metadata:{wallRole}});
  }
  for(const object of objects)if(object.type==='nonWalkableArea'&&!object.category)object.category='Wall';
  for(const block of facilities)add('nonWalkableArea',rectangle(block.x*sx,block.y*sy,block.w*sx,block.h*sy),{category:block.type,name:block.name,metadata:{sourceType:block.type,groupedAssembly:true,needsReview:!!block.needsReview}});
  const graph=annotationOnly?new NavigationGraph():graphFromWalkableMask({free,width,height,drawingWidth,drawingHeight,metersPerPixel});
  if(annotationOnly){
    const pins=[];
    const retail=hasShopIdentifiers(labels);
    for(const label of [...labels].sort((a,b)=>(b.confidence||100)-(a.confidence||100))){
      const type=isDestinationCaption(label.text)&&(category(label.text)||destinationCategory(label.text));
      if(!type||type==='Store'||(type==='Shop unit'&&!retail)||(label.source==='ocr'&&label.confidence<80))continue;
      const block=facilities.find(block=>block.label===label);
      const x=block?(block.x+block.w/2)*sx:label.x+(label.width||0)/2;
      const y=block?(block.y+block.h/2)*sy:label.y-(label.height||0)/2;
      if(!(x>=0&&x<drawingWidth&&y>=0&&y<drawingHeight))continue;
      const room=objects.find(o=>o.type==='room'&&pointInPolygon({x,y},o.points)&&!o.holes?.some(h=>pointInPolygon({x,y},h)));
      const duplicate=pins.some(p=>p.category===type&&p.name.toLowerCase()===label.text.trim().toLowerCase()&&
        ((room&&room.id===p.metadata.roomId)||Math.hypot(p.x-x,p.y-y)<2*Math.max(sx,sy)));
      if(duplicate)continue;
      const pin={id:`auto-poi-${objects.length}`,type:'poi',layerId:'pois',floorId:'floor-1',x,y,name:label.text.trim(),category:type,origin:'automatic',rotation:0,
        metadata:{coordinateSource:block?'labeled assembly':label.coordinateSource||'printed label',roomId:room?.id,needsReview:label.source==='ocr'}};
      pins.push(pin);objects.push(pin);
    }
    const rooms=objects.filter(o=>o.type==='room');
    for(const shaft of rooms.filter(o=>o.category==='Lift'&&o.metadata?.geometrySource==='Repeated crossed shaft outlines')){
      if(pins.some(p=>p.category==='Lift'&&p.metadata?.roomId===shaft.id))continue;
      const center={x:(shaft.points[0].x+shaft.points[2].x)/2,y:(shaft.points[0].y+shaft.points[2].y)/2};
      objects.push({...center,id:'auto-lift-'+shaft.id,type:'poi',layerId:'pois',floorId:shaft.floorId,category:'Lift',
        name:shaft.name,origin:'automatic',metadata:{roomId:shaft.id,coordinateSource:'Repeated crossed shaft outlines',needsReview:true}});
    }
    for(const opening of openings){
      let closest=null,distance=Infinity;
      for(const room of rooms)for(const [i,a] of room.points.entries()){
        const projected=segmentProjection(opening,a,room.points[(i+1)%room.points.length]);
        if(projected.distance<distance){distance=projected.distance;closest=room;}
      }
      if(!closest||distance>Math.max(2*Math.max(sx,sy),opening.radius*.42))continue;
      objects.push({id:`auto-door-${objects.length}`,type:'poi',layerId:'pois',floorId:'floor-1',x:opening.x,y:opening.y,
        name:closest.name,category:'Room Door',origin:'automatic',rotation:0,metadata:{coordinateSource:opening.source,roomId:closest.id,needsReview:true}});
    }
    const doors=objects.filter(o=>o.category==='Room Door');
    for(const gap of doorwayGaps){
      const side=sign=>{
        for(let d=1;d<=4;d++){
          const x=Math.floor(gap.x+sign*d*gap.dy),y=Math.floor(gap.y-sign*d*gap.dx);
          if(x<0||x>=width||y<0||y>=height)break;
          const i=y*width+x;
          if(outside[i]||ink[i])break;
          if(regionKind[i])return regionKind[i];
        }
        return 0;
      };
      const a=side(1),b=side(-1);
      if(Math.min(a,b)!==-1||Math.max(a,b)<=0)continue;
      const room=roomByIndex[Math.max(a,b)],x=gap.x*sx,y=gap.y*sy;
      if(doors.some(p=>Math.hypot(p.x-x,p.y-y)*metersPerPixel<.9))continue;
      const pin={id:`auto-door-${objects.length}`,type:'poi',layerId:'pois',floorId:'floor-1',x,y,name:room.name,
        category:'Room Door',origin:'automatic',rotation:0,metadata:{coordinateSource:'wall gap between room and passage',roomId:room.id,needsReview:true}};
      doors.push(pin);objects.push(pin);
    }
  }
  if(!annotationOnly){
  // Smoothed outlines can shift across a raster route; keep routes inside the final editable geometry.
  const floor=compileFloorGeometry({objects,metersPerPixel}).get('floor-1');
  for(const node of [...graph.nodes.values()])if(geometryConflict({x:node.worldX,y:node.worldY},floor))graph.removeNode(node.id);
  for(const edge of [...graph.edges.values()]){
    const a=graph.nodes.get(edge.source),b=graph.nodes.get(edge.target);
    if(validGraphIntervals({x:a.worldX,y:a.worldY},{x:b.worldX,y:b.worldY},floor).reduce((sum,[start,end])=>sum+end-start,0)<.99999)graph.removeEdge(edge.id);
  }
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
  }
  return {objects,graph:graph.serialize(),analysis:{method:'bounded-raster-topology',contourVersion:3,resolution:{width,height},status:'needs-review',warnings:['Boundaries and regions are traced from structural lines. Closed rooms and voids block beacon placement. Review ambiguous room outlines and door connections.','Landmark pins use positioned labels. Review unlabeled stair assemblies and doorway locations.','Placement is a bounded geometry-based heuristic, not a guaranteed global optimum or RF coverage prediction.'],regions:regions.length,detected:{boundaries:objects.filter(o=>o.type==='buildingBoundary').length,walkableRegions:objects.filter(o=>o.type==='walkableArea').length,walls:objects.filter(o=>o.category==='Wall').length,roomCandidates:objects.filter(o=>o.type==='room').length,labeledLandmarks:objects.filter(o=>o.type==='poi').length}}};
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
    if(simplified.length>=3){
      const signed=contourArea(simplified);
      const fitted=straightenRasterStairs(simplified,sx,sy);
      const smoothed=simplifyContour(fitted,tolerance*Math.min(sx,sy));
      // Smoothing narrow CAD recesses must not introduce crossing edges.
      const valid=ring=>Math.abs(contourArea(ring)/signed-1)<=.15&&!selfIntersects(ring);
      let points=smoothed;
      if(points===fitted||!valid(points)){
        const local=simplifyNarrowContour(simplified,tolerance*Math.min(sx,sy));
        points=valid(local)?local:fitted!==simplified&&valid(fitted)?fitted:simplified;
      }
      contours.push({points,hole:signed<0});
    }
    }
  }
  return contours;
}

function contourArea(points){return points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2;}


// shortcut: nearby pointed pockets identify X symbols; ambiguous partitions still require review.
function crossedEnclosures(regions,width,height){
  const turn=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const chain=points=>{const result=[];for(const p of points){while(result.length>1&&turn(result.at(-2),result.at(-1),p)<=0)result.pop();result.push(p);}return result;};
  const hull=points=>{const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);return [...chain(sorted).slice(0,-1),...chain([...sorted].reverse()).slice(0,-1)];};
  // Remove raster bevels even at the contour's starting vertex.
  const outline=(points,tolerance=4)=>{
    const result=hull(points);
    for(let i=0;i<result.length&&result.length>3;i++)if(segmentProjection(result[i],result[(i+result.length-1)%result.length],result[(i+1)%result.length]).distance<=tolerance){result.splice(i,1);i=-1;}
    return result;
  };
  const candidates=[],triangles=[];
  for(const cells of regions){
    const mask=new Uint8Array(width*height);for(const i of cells)mask[i]=1;
    for(const contour of maskContours(mask,width,height))if(!contour.hole){
      const points=outline(contour.points);
      if(points.length<=8&&cells.length>=Math.abs(contourArea(points))*.3){
        const candidate={points,cells};candidates.push(candidate);
        if(points.length===3)triangles.push(candidate);
      }
    }
  }
  const crosses=[],used=new Set();
  for(const triangle of triangles)if(!used.has(triangle))for(const vertex of triangle.points){
    const group=triangles.filter(t=>!used.has(t)&&t.points.some(p=>Math.hypot(p.x-vertex.x,p.y-vertex.y)<=16));
    if(group.length!==4)continue;
    const centers=group.map(t=>t.points.reduce((a,b)=>Math.hypot(a.x-vertex.x,a.y-vertex.y)<Math.hypot(b.x-vertex.x,b.y-vertex.y)?a:b));
    const center={x:centers.reduce((n,p)=>n+p.x,0)/4,y:centers.reduce((n,p)=>n+p.y,0)/4};
    const outer=group.flatMap(t=>t.points.filter(p=>Math.hypot(p.x-center.x,p.y-center.y)>16)).sort((a,b)=>a.x-b.x||a.y-b.y);
    const corners=outline(outer,8);
    if(corners.length!==4||!pointInPolygon(center,corners))continue;
    if(segmentProjection(center,corners[0],corners[2]).distance>4||segmentProjection(center,corners[1],corners[3]).distance>4)continue;
    const area=Math.abs(contourArea(corners)),total=group.reduce((sum,t)=>sum+t.cells.length,0);
    if(total<area*.65||total>area*1.05)continue;
    crosses.push({center,corners});group.forEach(t=>used.add(t));break;
  }
  // A bent footprint can share sectors between several X marks; keep its concave perimeter.
  const joined=new Set();
  for(const triangle of triangles)for(const vertex of triangle.points)for(const radius of [8,12,16,24]){
    const group=candidates.filter(t=>t.points.some(p=>Math.hypot(p.x-vertex.x,p.y-vertex.y)<=radius));
    if(group.length!==4||group.filter(t=>t.points.length===3).length<2||group.every(t=>used.has(t)))continue;
    const key=group.map(t=>candidates.indexOf(t)).sort((a,b)=>a-b).join(',');
    if(joined.has(key))continue;
    joined.add(key);crosses.push({regions:group.map(t=>t.cells)});
  }
  return crosses;
}

// Some CAD exports draw one dimension rule as several paint operations. At raster
// resolution it is still a nearly continuous rule spanning a sheet margin.
function stripSheetRules(ink,width,height){
  for(const vertical of [false,true]){
    const lines=vertical?width:height,span=vertical?height:width;
    for(let line=0;line<lines;line++){
      const fraction=line/lines;
      if(vertical?fraction>.035&&fraction<.965:fraction>.13&&fraction<.85)continue;
      const index=p=>vertical?p*width+line:line*width+p;
      let start=0,last=-5;
      for(let p=0;p<=span+3;p++){
        if(p<span&&ink[index(p)]){
          if(p-last>3)start=p;
          last=p;
        }else if(p-last===3&&last-start>span*(vertical?.72:.88)){
          for(let i=start;i<=last;i++)ink[index(i)]=0;
        }
      }
    }
  }
}

// Measure in the region's orientation so that a rectangular room in a rotated wing
// stays compact. A branching passage occupies little of even its tightest box.
function resemblesPassage(cells,width){
  let minArea=Infinity,aspect=1;
  for(let angle=0;angle<Math.PI/2-.001;angle+=Math.PI/16){
    const cos=Math.cos(angle),sin=Math.sin(angle);
    let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
    for(const i of cells){
      const x=i%width,y=Math.floor(i/width),u=x*cos+y*sin,v=y*cos-x*sin;
      minU=Math.min(minU,u);maxU=Math.max(maxU,u);
      minV=Math.min(minV,v);maxV=Math.max(maxV,v);
    }
    const w=maxU-minU+1,h=maxV-minV+1;
    if(w*h<minArea){minArea=w*h;aspect=Math.max(w/h,h/w);}
  }
  return cells.length/minArea<.55||aspect>=5;
}

export function closeDoorGaps(mask,width,height,maxGap,onGap){
  const source=mask.slice();
  function scan(x,y,dx,dy){
    const step=dy*width+dx,limit=maxGap/Math.hypot(dx,dy);
    let wall=0,gap=0,supportBefore=0;
    for(;x>=0&&x<width&&y<height;x+=dx,y+=dy){
      const i=y*width+x;
      if(!source[i]){
        if(wall){supportBefore=wall;gap=0;wall=0;}
        gap++;
        continue;
      }
      wall++;
      const required=Math.max(6,Math.ceil(gap*1.2));
      if(gap>0&&gap<=limit&&supportBefore>=required&&wall===required){
        onGap?.(x+.5-(wall+(gap-1)/2)*dx,y+.5-(wall+(gap-1)/2)*dy,dx,dy,gap);
        for(let j=0;j<gap;j++)mask[i-(wall+j)*step]=1;
      }
    }
  }
  for(let x=0;x<width;x++){scan(x,0,0,1);scan(x,0,1,1);scan(x,0,-1,1);}
  for(let y=0;y<height;y++){
    scan(0,y,1,0);
    if(y>0){scan(0,y,1,1);scan(width-1,y,-1,1);}
  }
}

// Follow narrow pale ridges between existing structural strokes. A uniform pale
// room fill cannot satisfy the cross-line contrast test.
function recoverFaintPartitions(data,ink,width,height){
  const tone=new Uint8Array(ink.length);
  for(let i=0;i<tone.length;i++){
    const p=4*i,alpha=data[p+3]/255;
    tone[i]=255-(255-Math.min(data[p],data[p+1],data[p+2]))*alpha;
  }
  const strong=ink.slice();
  for(const [dx,dy] of [[1,0],[0,1],[1,1],[-1,1]]){
    const step=dy*width+dx,across=2*(dx*width-dy);
    function scan(x,y){
      let start=-1,count=0,anchored=false;
      for(;x>=2&&x<width-2&&y>=2&&y<height-2;x+=dx,y+=dy){
        const i=y*width+x;
        if(!strong[i]&&tone[i]<=249&&tone[i]+5<=Math.min(tone[i-across],tone[i+across])){
          if(!count){start=i;anchored=!!strong[i-step];}
          count++;
        }else{
          if(anchored&&strong[i]&&count>=4)for(let n=0;n<count;n++)ink[start+n*step]=1;
          count=0;
        }
      }
    }
    if(dy)for(let x=2;x<width-2;x++)scan(x,2);
    if(dx)for(let y=dy?3:2;y<height-2;y++)scan(dx>0?2:width-3,y);
  }
}
