import polygonClipping from 'polygon-clipping';
import {polygonArea} from './geometry.js';
import {pointInPolygon,segmentProjection} from './floorGeometry.js';

const ringCoordinates=r=>r.map(({x,y})=>[x,y]);
const points=ring=>ring.slice(0,-1).map(([x,y])=>({x,y}));

// Look for repeated divider walls ending at the same counter frontage.
// All distances in this local frame are metres, including for rotated rows.
function rowAt(seed,lines,scale,parent){
  const ux=seed.ux,uy=seed.uy;
  const local=p=>({x:((p.x-seed.a.x)*uy-(p.y-seed.a.y)*ux)*scale,
    y:((p.x-seed.a.x)*ux+(p.y-seed.a.y)*uy)*scale});
  const world=(x,y)=>({x:seed.a.x+(x*uy+y*ux)/scale,y:seed.a.y+(-x*ux+y*uy)/scale});
  const depth=seed.len*scale,dividers=[],rails=[];
  for(const line of lines){
    const a=local(line.a),b=local(line.b);
    if(Math.abs(a.x-b.x)<.085&&Math.abs(Math.min(a.y,b.y))<.65&&
      Math.abs(Math.max(a.y,b.y)-depth)<.65)dividers.push((a.x+b.x)/2);
    if(Math.abs(a.y-b.y)<.12)rails.push({y:(a.y+b.y)/2,l:Math.min(a.x,b.x),r:Math.max(a.x,b.x)});
  }
  const columns=[];
  for(const x of dividers.sort((a,b)=>a-b)){
    if(!columns.length||x-columns.at(-1).end>.24)columns.push({start:x,end:x});
    else columns.at(-1).end=x;
  }
  for(let i=columns.length-1;i>=0;i--)if(columns[i].end-columns[i].start<.055)columns.splice(i,1);
  const cells=[];
  function cell(left,right){
    const width=right-left;
    if(width<1.5||width>4.5)return;
    function rail(end){
      return rails.filter(s=>Math.abs(s.y-end)<.57)
        .map(s=>({y:s.y,coverage:Math.max(0,Math.min(right,s.r)-Math.max(left,s.l))/width}))
        .sort((a,b)=>(b.coverage-a.coverage)||Math.abs(a.y-end)-Math.abs(b.y-end))[0];
    }
    const a=rail(0),b=rail(depth);
    if(!a||!b||Math.min(a.coverage,b.coverage)<.39||Math.max(a.coverage,b.coverage)<.82)return;
    const ring=[world(left,a.y),world(right,a.y),world(right,b.y),world(left,b.y)];
    if(!pointInPolygon(world((left+right)/2,(a.y+b.y)/2),parent.points))return;
    return ring;
  }
  for(let i=0;i+2<columns.length;i++){
    const group=[columns[i],columns[i+1],columns[i+2]],pitch=group[1].start-group[0].end;
    if(Math.abs(group[2].start-group[1].end-pitch)>.28)continue;
    const a=cell(group[0].end,group[1].start),b=cell(group[1].end,group[2].start);
    if(!a||!b)continue;
    cells.push(a,b);
    // At a perimeter wall a raster contour can supply the angled outer side.
    // Accept an end bay only when both rail evidence and that wall are present.
    for(const [start,sign] of [[group[0].start,-1],[group[2].end,1]]){
      const edge=start+sign*pitch,outer=cell(Math.min(edge,start),Math.max(edge,start));
      if(!outer)continue;
      const middle=world(edge,depth/2);
      if(parent.points.some((p,j)=>segmentProjection(middle,p,parent.points[(j+1)%parent.points.length]).distance*scale<.38))cells.push(outer);
    }
  }
  return cells;
}

export function splitDeskRows(result,nearby,scale,labels=[]){
  let added=0;
  for(const room of result.objects.filter(o=>o.type==='room'&&(!o.category||o.category==='Room'))){
    const area=polygonArea(room.points)*scale**2;
    if(area<25||area>600)continue;
    const xs=room.points.map(p=>p.x),ys=room.points.map(p=>p.y);
    const lines=[...nearby({x:Math.min(...xs),y:Math.min(...ys)},{x:Math.max(...xs),y:Math.max(...ys)},.6/scale)];
    const parent=[room.points,...room.holes||[]].map(ringCoordinates);
    const parts=[],centers=[],holes=[];
    for(const line of lines){
      if(!line.support||line.len*scale<1.8||line.len*scale>5.5)continue;
      for(const candidate of rowAt(line,lines,scale,room)){
        const center={x:(candidate[0].x+candidate[2].x)/2,y:(candidate[0].y+candidate[2].y)/2};
        if(centers.some(p=>Math.hypot(center.x-p.x,center.y-p.y)*scale<.5))continue;
        const shape=polygonClipping.intersection(parent,[ringCoordinates(candidate)]);
        if(shape.length!==1)continue;
        const ring=points(shape[0][0]);
        if(polygonArea(ring)<.72*polygonArea(candidate))continue;
        if(parts.some(part=>polygonClipping.intersection([ringCoordinates(part)],shape).some(poly=>polygonArea(points(poly[0]))*scale**2>.05)))continue;
        centers.push(center);parts.push(ring);holes.push(shape[0].slice(1).map(points));
      }
    }
    if(parts.length<2)continue;
    const remainder=polygonClipping.difference(parent,...parts.map(r=>[ringCoordinates(r)]));
    if(!remainder.length)continue;
    remainder.sort((a,b)=>polygonArea(points(b[0]))-polygonArea(points(a[0])));
    const [main,...fragments]=remainder;
    const fromPoly=poly=>({points:points(poly[0]),holes:poly.slice(1).map(points)});
    Object.assign(room,fromPoly(main));
    const children=parts.map((ring,i)=>{
      const caption=labels.find(l=>(l.confidence??100)>=80&&/\b(room|desk|office)\b/i.test(l.text)&&pointInPolygon({x:l.x+(l.width||0)/2,y:l.y-(l.height||0)/2},ring));
      return {...room,id:room.id+'-bay-'+(i+1),name:caption?.text||'Detected room '+room.id.split('-').at(-1)+'-'+(i+1),category:'Room',points:ring,holes:holes[i],
        metadata:{geometrySource:'Repeated PDF partitions and frontage',needsReview:true}};
    });
    for(const [i,f] of fragments.entries()){
      if(polygonArea(points(f[0]))*scale**2<.5)continue;
      children.push({...room,...fromPoly(f),id:room.id+'-section-'+i,name:'Detected room '+room.id.split('-').at(-1)+' section '+(i+1)});
    }
    result.objects.push(...children);
    for(const pin of result.objects.filter(o=>o.type==='poi'&&o.metadata?.roomId===room.id)){
      const owner=[room,...children].find(o=>pointInPolygon(pin,o.points)&&!o.holes?.some(h=>pointInPolygon(pin,h)));
      pin.metadata={...pin.metadata,roomId:owner?.id,needsReview:true};
      if(owner&&pin.category==='Room Door')pin.name=owner.name;
    }
    result.analysis.detected.roomCandidates+=children.length;
    added+=parts.length;
  }
  result.analysis.partitionBays=added;
}
