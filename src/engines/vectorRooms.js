import {paintedEnclosures} from './paintedEnclosures.js';
import {polygonArea} from './geometry.js';
import {pointInPolygon,selfIntersects,segmentProjection} from './floorGeometry.js';
import {fitSupportedEdges,pairedWallIndex} from './vectorWallFaces.js';
import {destinationCategory} from '../models/destinationCategory.js';
import polygonClipping from 'polygon-clipping';

const cross=(ax,ay,bx,by)=>ax*by-ay*bx;
const signed=ring=>ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+cross(a.x,a.y,b.x,b.y);},0)/2;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

// Model-space strokes form a planar subdivision. Split at T junctions and
// intersections before walking each directed edge around its left-hand face.
export function vectorFaces(strokes,portals,width,height,snap){
  const nodes=[],buckets=new Map(),segments=[],seen=new Set(),cells=new Map();
  function node(x,y){
    const bx=Math.floor(x/snap),by=Math.floor(y/snap);
    for(let j=by-1;j<=by+1;j++)for(let i=bx-1;i<=bx+1;i++){
      for(const n of buckets.get(i+','+j)||[])if(Math.hypot(n.x-x,n.y-y)<=snap)return n;
    }
    const n={x,y,id:nodes.length,adj:[]},key=bx+','+by;
    nodes.push(n);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(n);return n;
  }
  function add(x,y,u,v,portal=false){
    const a=node(x*width,y*height),b=node(u*width,v*height);
    const key=Math.min(a.id,b.id)+','+Math.max(a.id,b.id);
    if(a===b||seen.has(key))return;
    seen.add(key);
    segments.push({a,b,portal,cuts:[{t:0,n:a},{t:1,n:b}]});
  }
  for(let i=0;i+3<strokes.length;i+=4)add(strokes[i],strokes[i+1],strokes[i+2],strokes[i+3]);
  for(const p of portals)add(p.a.x,p.a.y,p.b.x,p.b.y,true);
  const bin=Math.max(width,height)/64;
  for(const s of segments){
    const {a,b}=s,dx=b.x-a.x,dy=b.y-a.y,near=new Set(),keys=[];
    for(let y=Math.floor((Math.min(a.y,b.y)-snap)/bin);y<=Math.floor((Math.max(a.y,b.y)+snap)/bin);y++)
      for(let x=Math.floor((Math.min(a.x,b.x)-snap)/bin);x<=Math.floor((Math.max(a.x,b.x)+snap)/bin);x++){
        const k=x+','+y;keys.push(k);for(const item of cells.get(k)||[])near.add(item);
      }
    for(const q of near){
      const ex=q.b.x-q.a.x,ey=q.b.y-q.a.y,den=cross(dx,dy,ex,ey);
      const ox=q.a.x-a.x,oy=q.a.y-a.y;
      if(Math.abs(den)>1e-7){
        const t=cross(ox,oy,ex,ey)/den,u=cross(ox,oy,dx,dy)/den;
        if(t>=0&&t<=1&&u>=0&&u<=1){
          const n=node(a.x+t*dx,a.y+t*dy);
          s.cuts.push({t,n});q.cuts.push({t:u,n});
        }
      }
      for(const [target,points] of [[s,[q.a,q.b]],[q,[a,b]]])for(const n of points){
        const p=segmentProjection(n,target.a,target.b);
        if(p.t>0&&p.t<1&&p.distance<=snap)target.cuts.push({t:p.t,n});
      }
    }
    for(const k of keys){if(!cells.has(k))cells.set(k,[]);cells.get(k).push(s);}
  }
  const edges=[],unique=new Set();
  for(const s of segments){
    s.cuts.sort((a,b)=>a.t-b.t);
    for(let i=1;i<s.cuts.length;i++){
      const a=s.cuts[i-1].n,b=s.cuts[i].n,key=Math.min(a.id,b.id)+','+Math.max(a.id,b.id);
      if(a===b||unique.has(key))continue;
      unique.add(key);
      const ab={from:a,to:b,portal:s.portal},ba={from:b,to:a,portal:s.portal};
      ab.twin=ba;ba.twin=ab;a.adj.push(ab);b.adj.push(ba);edges.push(ab,ba);
    }
  }
  for(const n of nodes){
    n.adj.sort((a,b)=>Math.atan2(a.to.y-n.y,a.to.x-n.x)-Math.atan2(b.to.y-n.y,b.to.x-n.x));
    n.adj.forEach((e,i)=>{e.twin.next=n.adj[(i+n.adj.length-1)%n.adj.length];});
  }
  const faces=[];
  for(const start of edges){
    if(start.visited)continue;
    let e=start;const loop=[];
    do{e.visited=true;if(loop.at(-1)===e.twin)loop.pop();else loop.push(e);e=e.next;}while(e!==start);
    while(loop.length>1&&loop[0]===loop.at(-1).twin){loop.shift();loop.pop();}
    if(loop.length<3||loop.length>240)continue;
    const ring=loop.map(e=>({x:e.from.x,y:e.from.y}));
    const area=signed(ring);
    if(area<=0||new Set(loop.map(e=>e.from.id)).size!==loop.length)continue;
    const points=ring.filter((p,i)=>{
      const a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length];
      return segmentProjection(p,a,b).distance>snap*.12;
    });
    if(points.length<3||selfIntersects(points))continue;
    faces.push({points,area,portals:loop.filter(e=>e.portal).map(e=>({x:(e.from.x+e.to.x)/2,y:(e.from.y+e.to.y)/2}))});
  }
  return faces;
}

const bounds=ring=>({minX:Math.min(...ring.map(p=>p.x)),minY:Math.min(...ring.map(p=>p.y)),maxX:Math.max(...ring.map(p=>p.x)),maxY:Math.max(...ring.map(p=>p.y))});
const overlaps=(a,b)=>a.minX<=b.maxX&&b.minX<=a.maxX&&a.minY<=b.maxY&&b.minY<=a.maxY;
const coordinates=points=>[points.map(p=>[p.x,p.y])];
function intersectionArea(a,b){
  const polygons=polygonClipping.intersection(coordinates(a),coordinates(b));
  return polygons.reduce((sum,rings)=>sum+rings.reduce((area,ring,i)=>{
    const points=ring.map(([x,y])=>({x,y}));
    return area+(i?-1:1)*polygonArea(points);
  },0),0);
}

// Use a single pass over the original outline so a series of small shortcuts
// cannot progressively flatten a curved façade. Work in drawing coordinates.
export function cleanRegionEdges(region,neighbors,lookup,scale,cellSize){
  const ring=region.points,n=ring.length;
  if(n<6)return 0;
  const area=polygonArea(ring),result=[];
  const noise=Math.min(.22/scale,1.8*cellSize);
  // Begin at a long edge so the ring seam is unlikely to split a noisy run.
  let start=0;
  for(let i=1;i<n;i++)if(distance(ring[i],ring[(i+1)%n])>distance(ring[start],ring[(start+1)%n]))start=i;
  const at=i=>ring[(start+i)%n];
  for(let i=0;i<n;){
    const a=at(i);
    result.push(a);
    let advance=1;
    for(let span=Math.min(16,n-i,n-3);span>=2;span--){
      const b=at(i+span),length=distance(a,b);
      if(length*scale<.85||length*scale>12)continue;
      const run=Array.from({length:span-1},(_,j)=>at(i+j+1));
      let depth=0,previous=0,ordered=true;
      for(const p of run){
        const {t,distance:offset}=segmentProjection(p,a,b);
        if((previous-t)*length>.25/scale){ordered=false;break;}
        previous=t;depth=Math.max(depth,offset);
      }
      if(!ordered||depth>Math.min(1.15/scale,.45*length))continue;
      if(depth>noise||depth>.055*length){
        const wall=lookup(a,b);
        if(!wall?.support)continue;
        const pos=p=>(p.x-wall.a.x)*wall.ux+(p.y-wall.a.y)*wall.uy;
        const lo=Math.min(pos(a),pos(b)),hi=Math.max(pos(a),pos(b));
        if(!wall.support.some(([s,e])=>s<=lo+.15/scale&&e>=hi-.15/scale))continue;
      }
      const pocket=[a,...run,b],box=bounds(pocket);
      // Protect voids, columns and the occupied footprint of the other regions.
      const protectedRings=(region.holes||[]).some(h=>overlaps(box,bounds(h))&&intersectionArea(pocket,h)>1e-8);
      if(protectedRings||neighbors.some(({o,box:other})=>o!==region&&overlaps(box,other)&&
        intersectionArea(pocket,o.points)-(o.holes||[]).reduce((sum,h)=>sum+intersectionArea(pocket,h),0)>1e-8))continue;
      advance=span;break;
    }
    i+=advance;
  }
  if(result.length<3||result.length===n||Math.abs(polygonArea(result)/area-1)>.08||selfIntersects(result))return 0;
  region.points=result;
  return n-result.length;
}

// Split a merged raster room only when separate vector faces have independent
// room evidence and together explain the original footprint.
function splitMergedRooms(result,faces,labels,scale){
  const captions=labels.filter(l=>(l.confidence??100)>=80&&
    (destinationCategory(l.text)||/\b(?:room|office|ward|lab)\b/i.test(l.text)))
    .map(l=>({text:l.text,x:l.x+(l.width||0)/2,y:l.y-(l.height||0)/2}));
  let splits=0;
  for(const original of result.objects.filter(o=>o.type==='room'&&!o.holes?.length)){
    const area=polygonArea(original.points),box=bounds(original.points);
    const candidates=[];
    for(const f of faces){
      if(!overlaps(box,f.box)||f.area*scale**2<3||f.area>area*.86)continue;
      const caption=captions.find(c=>pointInPolygon(c,f.points));
      if(!caption&&!f.portals.length)continue;
      if(intersectionArea(original.points,f.points)<f.area*.98)continue;
      candidates.push({f,caption});
    }
    if(candidates.length<2)continue;
    const coverage=candidates.reduce((s,c)=>s+c.f.area,0)/area;
    if(coverage<.88||coverage>1.02||candidates.some(({f},i)=>candidates.slice(i+1).some(({f:q})=>
      overlaps(f.box,q.box)&&intersectionArea(f.points,q.points)>.01*Math.min(f.area,q.area))))continue;
    const parts=candidates.map(({f,caption},i)=>({...original,id:i?original.id+'-vector-'+i:original.id,
      name:caption?.text||'Detected room '+original.id.split('-').at(-1)+'-'+(i+1),points:f.points,
      metadata:{...original.metadata,geometrySource:'PDF vector face',needsReview:true}}));
    const pins=result.objects.filter(o=>o.type==='poi'&&o.metadata?.roomId===original.id);
    for(const pin of pins){
      let room=parts.find(o=>pointInPolygon(pin,o.points));
      if(!room&&pin.category==='Room Door'){
        let best=.5/scale;
        for(const part of parts)for(const [i,p] of part.points.entries()){
          const d=segmentProjection(pin,p,part.points[(i+1)%part.points.length]).distance;
          if(d<best){best=d;room=part;}
        }
      }
      pin.metadata={...pin.metadata,roomId:room?.id,needsReview:true};
      if(pin.category==='Room Door'&&room)pin.name=room.name;
    }
    Object.assign(original,parts[0]);result.objects.push(...parts.slice(1));
    result.analysis.detected.roomCandidates+=parts.length-1;splits++;
  }
  return splits;
}
export function useVectorRooms(result,input,wallLookup){
  const {vectorStrokes,openingSegments=[],drawingWidth,drawingHeight,metersPerPixel}=input;
  if(!vectorStrokes?.length)return result;
  const snap=Math.min(.065/metersPerPixel,Math.max(drawingWidth,drawingHeight)*.0007);
  const faces=vectorFaces(vectorStrokes,openingSegments,drawingWidth,drawingHeight,snap)
    .filter(f=>f.area*metersPerPixel**2>=1.5).map(f=>({...f,box:bounds(f.points)}));
  for(const r of input.doorRooms||[]){
    faces.push({points:r.points,area:polygonArea(r.points),box:bounds(r.points),portals:[r.portal],source:'PDF doorway and wall faces'});
  }
  result.analysis.vectorRoomSplits=splitMergedRooms(result,faces,input.labels||[],metersPerPixel);
  // Keep the fine-print contour available after grid segmentation. Restore
  // its corners only when the room and its neighbors pass the overlap checks.
  for(const face of input.shopFaces||[]){
    if(face.detailed)faces.push({points:face.points,area:polygonArea(face.points),
      box:bounds(face.points),portals:[],source:'Closed printed shop outline'});
  }
  // A legible unit identifier inside an otherwise unassigned closed PDF face
  // can recover a shop even when raster segmentation discarded its interior.
  for(const label of input.labels||[]){
    if(destinationCategory(label.text)!=='Shop unit'||(label.confidence??100)<80)continue;
    const center={x:label.x+(label.width||0)/2,y:label.y-(label.height||0)/2};
    const regions=result.objects.filter(o=>o.type==='room'||o.type==='walkableArea');
    const contains=(o,p)=>pointInPolygon(p,o.points)&&!o.holes?.some(h=>pointInPolygon(p,h));
    if(regions.some(o=>contains(o,center)))continue;
    const face=faces.filter(f=>f.area*metersPerPixel**2>=6&&pointInPolygon(center,f.points))
      .sort((a,b)=>a.area-b.area)[0];
    if(face&&input.labels.some(other=>other!==label&&destinationCategory(other.text)==='Shop unit'&&
      other.text.trim()!==label.text.trim()&&pointInPolygon({x:other.x+(other.width||0)/2,y:other.y-(other.height||0)/2},face.points)))continue;
    if(!face||face.area*metersPerPixel**2>2500||regions.some(o=>overlaps(bounds(o.points),face.box)&&
      intersectionArea(o.points,face.points)-(o.holes||[]).reduce((s,h)=>s+intersectionArea(h,face.points),0)>.01*face.area))continue;
    result.objects.push({id:'auto-unit-'+result.objects.length,type:'room',points:face.points,name:label.text,category:'Shop unit',
      layerId:'rooms',floorId:'floor-1',rotation:0,origin:'automatic',geometryRole:'nonWalkableArea',metadata:{geometrySource:'Labeled PDF vector face',needsReview:true}});
    result.analysis.detected.roomCandidates++;
  }
  const used=new Set(),doors=result.objects.filter(o=>o.category==='Room Door');
  const floorRegions=result.objects.filter(o=>o.type==='room'||o.type==='walkableArea').map(o=>({o,box:bounds(o.points)}));
  const lookup=wallLookup||pairedWallIndex(vectorStrokes,drawingWidth,drawingHeight,metersPerPixel);
  let recovered=0,refined=0,refinedWalls=0;
  for(const room of result.objects.filter(o=>o.type==='room')){
    const box=bounds(room.points),area=polygonArea(room.points),roomDoors=doors.filter(d=>d.metadata?.roomId===room.id);
    let best=null,bestScore=0;
    for(const f of faces){
      const b=f.box,ratio=f.area/area;
      if(f.source==='Closed printed shop outline'){
        if(used.has(f)||!overlaps(b,box)||ratio<.88||ratio>1.15)continue;
        const shared=intersectionArea(room.points,f.points);
        if(shared<.90*Math.max(area,f.area))continue;
        const conflicts=floorRegions.some(({o,box:other})=>o!==room&&overlaps(b,other)&&
          intersectionArea(o.points,f.points)-(o.holes||[]).reduce((sum,h)=>sum+intersectionArea(h,f.points),0)>.01*f.area);
        if(!conflicts&&(!best||bestScore<1)){best=f;bestScore=1;}
        continue;
      }
      if(f.source&&!used.has(f)&&overlaps(b,box)&&ratio>=.92&&ratio<=1.5&&
        intersectionArea(room.points,f.points)>=.97*area&&
        !room.holes?.some(h=>h.some(p=>!pointInPolygon(p,f.points)))){
        const conflicts=floorRegions.some(({o,box:other})=>o!==room&&overlaps(b,other)&&
          intersectionArea(o.points,f.points)>.04*f.area&&!o.holes?.some(h=>f.points.every(p=>pointInPolygon(p,h))));
        if(!conflicts){best=f;bestScore=1;continue;}
      }
      if(used.has(f)||ratio<.82||ratio>1.24||b.maxX<box.minX||b.minX>box.maxX||b.maxY<box.minY||b.minY>box.maxY)continue;
      const tolerance=Math.max(snap*3,Math.min(.42/metersPerPixel,Math.sqrt(area)*.1));
      if(Math.max(...Object.keys(b).map(k=>Math.abs(b[k]-box[k])))>2*tolerance)continue;
      const near=(p,ring)=>ring.some((a,i)=>segmentProjection(p,a,ring[(i+1)%ring.length]).distance<=tolerance);
      if(!room.points.every(p=>near(p,f.points))||!f.points.every(p=>near(p,room.points)))continue;
      if(room.holes?.some(h=>h.some(p=>!pointInPolygon(p,f.points)))||roomDoors.some(p=>!near(p,f.points)))continue;
      const score=Math.min(ratio,1/ratio);if(score>bestScore){best=f;bestScore=score;}
    }
    if(!best){
      if(!room.holes?.length){
        const points=fitSupportedEdges(room.points,lookup,metersPerPixel);
        if(points){
          const candidateBounds=bounds(points);
          const overlapsNeighbor=floorRegions.some(({o})=>{
            if(o===room||o.type!=='room'||!overlaps(candidateBounds,bounds(o.points)))return false;
            const occupied=ring=>intersectionArea(ring,o.points)-
              (o.holes||[]).reduce((sum,hole)=>sum+intersectionArea(ring,hole),0);
            return (occupied(points)-occupied(room.points))*metersPerPixel**2>.02;
          });
          if(!overlapsNeighbor){
            room.points=points;
            room.metadata={...room.metadata,geometrySource:'PDF wall faces and raster'};
            refined++;
          }
        }
      }
      continue;
    }
    room.points=best.points;room.metadata={...room.metadata,geometrySource:best.source||'PDF vector face'};
    used.add(best);recovered++;
    for(const p of best.portals){
      if(doors.some(d=>distance(d,p)*metersPerPixel<.8))continue;
      const pin={...p,id:'auto-vector-door-'+room.id+'-'+doors.length,type:'poi',category:'Room Door',floorId:room.floorId,layerId:'pois',name:room.name,origin:'automatic',metadata:{roomId:room.id,coordinateSource:'PDF doorway on vector face',needsReview:true}};
      result.objects.push(pin);doors.push(pin);result.analysis.detected.labeledLandmarks++;
    }
  }
  // A second enclosure must explain the detailed room and its missing area
  // without swallowing another room or the adjoining circulation space.
  const envelopes=paintedEnclosures(input).map(points=>({points,box:bounds(points),area:polygonArea(points)}));
  let corrected=0;
  for(const entry of floorRegions){
    const room=entry.o;
    if(room.type!=='room'||!envelopes.length)continue;
    const area=polygonArea(room.points);
    for(const face of envelopes){
      if(!overlaps(entry.box,face.box)||face.area<area*1.035||face.area>area*2.25)continue;
      if(intersectionArea(room.points,face.points)<area*.92)continue;
      if(room.holes?.some(h=>h.some(p=>!pointInPolygon(p,face.points))))continue;
      const conflict=floorRegions.some(({o,box})=>{
        if(o===room||!overlaps(box,face.box))return false;
        const overlap=intersectionArea(o.points,face.points);
        if(!overlap)return false;
        const holes=(o.holes||[]).reduce((sum,h)=>sum+intersectionArea(h,face.points),0);
        return (overlap-holes)*metersPerPixel**2>Math.min(.55,.12*polygonArea(o.points)*metersPerPixel**2);
      });
      if(conflict)continue;
      room.points=face.points;
      entry.box=face.box;
      room.metadata={...room.metadata,geometrySource:'PDF wall fills and hatches',needsReview:true};
      corrected++;
      break;
    }
  }
  result.analysis.wallPaintRooms=corrected;
  if(input.annotationOnly){
    const neighbors=floorRegions.map(({o})=>({o,box:bounds(o.points)}));
    const cellSize=Math.min(drawingWidth/input.width,drawingHeight/input.height);
    let removed=0;
    for(const {o} of neighbors)removed+=cleanRegionEdges(o,neighbors,lookup,metersPerPixel,cellSize);
    result.analysis.removedContourVertices=removed;
  }
  result.analysis.vectorRooms=recovered;
  for(const wall of result.objects.filter(o=>o.category==='Wall'&&!o.holes?.length&&o.points.length<100)){
    const points=fitSupportedEdges(wall.points,lookup,metersPerPixel);
    if(points){wall.points=points;wall.metadata={...wall.metadata,geometrySource:'PDF wall faces and raster'};refinedWalls++;}
  }
  const passages=result.objects.filter(o=>o.type==='walkableArea');
  const rooms=result.objects.filter(o=>o.type==='room');
  const contains=(o,p)=>pointInPolygon(p,o.points)&&!o.holes?.some(h=>pointInPolygon(p,h));
  for(const segment of openingSegments.filter(s=>s.swingTip)){
    const a={x:segment.a.x*drawingWidth,y:segment.a.y*drawingHeight},b={x:segment.b.x*drawingWidth,y:segment.b.y*drawingHeight};
    const widthM=distance(a,b)*metersPerPixel;
    if(widthM<.6||widthM>1.9)continue;
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const dx=(segment.swingTip.x*drawingWidth-a.x)*.55,dy=(segment.swingTip.y*drawingHeight-a.y)*.55;
    const inside={x:mid.x+dx,y:mid.y+dy},outside={x:mid.x-dx,y:mid.y-dy};
    const swingingInto=rooms.filter(r=>contains(r,inside)&&!contains(r,outside));
    let pin=doors.find(d=>distance(d,mid)*metersPerPixel<.45);
    if(!pin){
      pin={...mid,id:'auto-swing-'+doors.length,type:'poi',layerId:'pois',floorId:'floor-1',category:'Room Door',name:'Room door',
        origin:'automatic',metadata:{coordinateSource:'door swing and leaf',needsReview:true}};
      doors.push(pin);result.objects.push(pin);result.analysis.detected.labeledLandmarks++;
    }
    if(swingingInto.length===1){
      pin.metadata.roomId=swingingInto[0].id;pin.name=swingingInto[0].name;
      const corridor=passages.filter(p=>contains(p,outside));
      if(corridor.length===1)pin.metadata.passageId=corridor[0].id;
    }else if(!swingingInto.length&&!pin.metadata.passageId){
      // Outward-opening doors place the leaf in the passage. Both probes
      // must agree before assigning the room on the opposite side.
      const opposite=rooms.filter(r=>contains(r,outside)&&!contains(r,inside));
      const corridor=passages.filter(p=>contains(p,inside)&&!contains(p,outside));
      if(opposite.length===1&&corridor.length===1&&(!pin.metadata.roomId||pin.metadata.roomId===opposite[0].id)){
        pin.metadata.roomId=opposite[0].id;
        pin.metadata.passageId=corridor[0].id;
        pin.name=opposite[0].name;
      }
    }
  }
  for(const door of doors){
    const nearby=passages.filter(p=>[p.points,...(p.holes||[])].some(ring=>ring.some((a,i)=>
      segmentProjection(door,a,ring[(i+1)%ring.length]).distance*metersPerPixel<=.45)));
    if(!door.metadata.passageId&&nearby.length===1)door.metadata.passageId=nearby[0].id;
  }
  result.analysis.vectorRefinedRooms=refined;
  result.analysis.vectorRefinedWalls=refinedWalls;
  return result;
}
