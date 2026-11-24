import {auditoriumCaption} from '../models/destinationCategory.js';
import clipping from 'polygon-clipping';
import {polygonArea} from './geometry.js';
import {pointInPolygon} from './floorGeometry.js';

// Recover a seating bank only when a numbered hall label, repeated rows, side
// walls and a closing wall beyond the label all agree in the local row frame.
export function auditoriumEnclosures(labels,nearby,scale,surfaces=[]){
  const halls=labels.filter(l=>(l.confidence??100)>=78&&auditoriumCaption.test(l.text))
    .map(l=>({name:l.text,x:l.x+(l.width||0)/2,y:l.y-(l.height||0)/2}));
  const rooms=[];
  for(const label of halls){
    const lines=[...nearby(label,label,32/scale)];
    const aisle=surfaces.find(o=>o.type==='room'&&o.name===label.name&&pointInPolygon(label,o.points));
    let best,segmentedBank;
    for(const row of lines){
      const width=row.len*scale;
      if(width<5||width>27)continue;
      const origin=row.a,ux=row.ux,uy=row.uy;
      const across=p=>((p.x-origin.x)*ux+(p.y-origin.y)*uy)*scale;
      const depth=p=>((p.y-origin.y)*ux-(p.x-origin.x)*uy)*scale;
      const cx=across(label),cy=depth(label),sign=Math.sign(cy);
      if(cx<.12*width||cx>.88*width||Math.abs(cy)<4||Math.abs(cy)>30)continue;
      const rows=[],ends=[],sides=[],front=[],seatBands=new Map();
      for(const l of lines){
        const x=across(l.a),u=across(l.b),y=depth(l.a)*sign,v=depth(l.b)*sign;
        const lo=Math.min(x,u),hi=Math.max(x,u),mid=(y+v)/2;
        // Curved rows can be plotted as individual chair edges. Count their
        // lateral distribution so overprinted copies of one chair count once.
        if(lo>=0&&hi<=width&&mid>.6&&mid<Math.abs(cy)-1&&Math.abs(y-v)<.18&&hi-lo>.35&&hi-lo<width*.45){
          const tier=Math.round(mid/.25);
          if(!seatBands.has(tier))seatBands.set(tier,new Set());
          seatBands.get(tier).add(Math.floor(6*(lo+hi)/(2*width)));
        }
        if(Math.abs(y-v)<.25&&hi-lo>1&&mid>Math.abs(cy)+.22&&mid<Math.abs(cy)+5)front.push({lo,hi,mid});
        if(Math.abs(y-v)<.13&&hi-lo>width*.8){
          if(Math.abs(lo)<.35&&Math.abs(hi-width)<.35&&mid>=-.12&&mid<Math.abs(cy))rows.push(mid);
          if(mid>Math.abs(cy)+.22&&mid<Math.abs(cy)+5&&lo<.6&&hi>width-.6)ends.push(mid);
        }
        if(Math.abs(x-u)<.18&&Math.abs(y-v)>1)sides.push({x:(x+u)/2,lo:Math.min(y,v),hi:Math.max(y,v)});
      }
      // Seat rows recur at roughly the same pitch. Closely paired wall faces
      // alone cannot satisfy the three-row requirement.
      const regular=rows.some(r=>r>.55&&r<2.1&&rows.some(t=>Math.abs(t-2*r)<.18));
      const tiers=[...seatBands].filter(([,sectors])=>sectors.size>=3).map(([tier])=>tier);
      const chairs=aisle&&tiers.length>=8&&(Math.max(...tiers)-Math.min(...tiers))*.25>5;
      if(!regular&&!chairs)continue;
      // A curved cinema screen may be drawn as several short chords. Use
      // the existing front aisle to finish the hall when these chords span it.
      let segmented=false;
      if(!ends.length&&aisle){
        const span=Math.max(...aisle.points.map(p=>depth(p)*sign));
        const chords=front.filter(l=>Math.abs(l.mid-span)<.48).sort((a,b)=>a.lo-b.lo);
        let covered=0;
        for(const l of chords)if(l.lo<=covered+.25)covered=Math.max(covered,l.hi);
        if(chords.some(l=>l.lo<.3&&l.hi>0)&&covered>=width-.3){
          ends.push(Math.abs(cy));segmented=true;
        }
      }
      if(!regular){
        const screen=front.some(l=>Math.min(l.hi,width)-Math.max(l.lo,0)>width*.72);
        if(!screen)continue;
        ends.splice(0,ends.length,Math.abs(cy));segmented=true;
      }
      for(const end of ends){
        const wallAt=x=>{
          const spans=sides.filter(l=>Math.abs(l.x-x)<.5&&l.hi>0&&l.lo<end).sort((a,b)=>a.lo-b.lo);
          let length=0,until=0;
          for(const l of spans){length+=Math.max(0,Math.min(end,l.hi)-Math.max(until,l.lo));until=Math.max(until,l.hi);}
          return length/end;
        };

        const world=(x,y)=>({x:origin.x+(x*ux-y*sign*uy)/scale,y:origin.y+(x*uy+y*sign*ux)/scale});
        const extent=aisle?.points.map(across)||[0,width];
        // The seat rows may stop at an aisle. Extend only to a wall that runs
        // alongside the bank and meets the already detected aisle footprint.
        const sideAt=(edge,limit)=>{
          if(Math.abs(limit-edge)<.7||Math.abs(limit-edge)>width*.28)return edge;
          const supported=sides.filter(s=>Math.abs(s.x-limit)<.6&&wallAt(s.x)>.65);
          return supported.sort((a,b)=>Math.abs(a.x-limit)-Math.abs(b.x-limit))[0]?.x??edge;
        };
        const left=sideAt(0,Math.min(0,...extent)),right=sideAt(width,Math.max(width,...extent));
        if(Math.min(wallAt(segmented?left:0),wallAt(segmented?right:width))<.52)continue;
        const points=[world(left,0),world(right,0),world(right,end),world(left,end)];
        if(halls.some(other=>other!==label&&pointInPolygon(other,points)))continue;
        const score=width*end;
        const candidate={name:label.name,label,points,score};
        if(regular){if(!best||score>best.score)best=candidate;}
        else if(!segmentedBank||score>segmentedBank.score)segmentedBank=candidate;
      }
    }
    if(best||segmentedBank)rooms.push(best||segmentedBank);
  }
  return rooms;
}

const coordinates=r=>r.map(p=>[p.x,p.y]);
const polygon=o=>[o.points,...(o.holes||[])].map(coordinates);
const shape=rings=>{
  const points=r=>r.slice(0,-1).map(([x,y])=>({x,y}));
  return {points:points(rings[0]),holes:rings.slice(1).map(points)};
};

// Reconcile the seating bank locally. The global region-size classifier has
// already run, so an enlarged hall cannot reclassify unrelated shops.
export function addAuditoriumSeating(result,halls,metersPerPixel=1){
  for(const pin of result.objects){
    if(pin.category!=='Auditorium'||!auditoriumCaption.test(pin.name))continue;
    const room=result.objects.find(o=>o.type==='room'&&o.id===pin.metadata?.roomId&&o.name===pin.name);
    if(room&&pointInPolygon(pin,room.points)&&!room.holes?.some(h=>pointInPolygon(pin,h)))room.category='Auditorium';
  }
  for(const hall of halls){
    const surfaces=result.objects.filter(o=>o.type==='room'||o.type==='walkableArea');
    const target=surfaces.find(o=>o.type==='room'&&o.name===hall.name&&pointInPolygon(hall.label,o.points));
    if(!target)continue;
    let bank=[coordinates(hall.points)];
    const protectedRooms=surfaces.filter(o=>o!==target&&o.type==='room'&&o.name&&!/^Detected room\b/i.test(o.name));
    for(const room of protectedRooms){
      const overlap=clipping.intersection(bank,polygon(room));
      if(!overlap.length)continue;
      const area=overlap.reduce((sum,r)=>sum+polygonArea(shape(r).points),0);
      if(area>Math.min(polygonArea(hall.points)*.015,polygonArea(room.points)*.08))continue;
      const trimmed=clipping.difference(bank,polygon(room));
      if(trimmed.length===1)bank=trimmed[0];
    }
    const combined=clipping.union(polygon(target),bank);
    if(combined.length!==1)continue;
    const edits=[];
    let valid=true;
    for(const other of surfaces){
      if(other===target)continue;
      const original=polygon(other);
      if(!clipping.intersection(original,bank).length)continue;
      if(other.type==='room'&&other.name&&!/^Detected room\b/i.test(other.name)){valid=false;break;}
      const remainder=clipping.difference(original,bank);
      // Preserve the identity of corridors and the room/passage links on doors.
      if(remainder.length>1){
        if(other.type!=='room'||result.objects.some(o=>o.metadata?.roomId===other.id)){valid=false;break;}
        const pieces=remainder.map(shape).sort((a,b)=>polygonArea(b.points)-polygonArea(a.points));
        // Clipping can leave a tiny disconnected triangle behind the wall.
        const extra=pieces.slice(1).filter(piece=>{
          const area=polygonArea(piece.points)-piece.holes.reduce((sum,ring)=>sum+polygonArea(ring),0);
          return area*metersPerPixel**2>=.1;
        });
        edits.push([other,pieces[0],extra]);
        continue;
      }
      if(!remainder.length&&other.type==='walkableArea'){valid=false;break;}
      edits.push([other,remainder.length?shape(remainder[0]):null]);
    }
    if(!valid)continue;
    Object.assign(target,shape(combined[0]),{category:'Auditorium',metadata:{...target.metadata,geometrySource:'Auditorium walls and seating rows',needsReview:true}});
    for(const [other,remainder,extra=[]] of edits){
      for(const [i,piece] of extra.entries()){
        result.objects.push({...other,...piece,id:other.id+'-split-'+target.id+'-'+i});
        result.analysis.detected.roomCandidates++;
      }
      if(remainder){Object.assign(other,remainder);continue;}
      result.objects.splice(result.objects.indexOf(other),1);
      result.analysis.detected.roomCandidates--;
      for(const pin of result.objects.filter(o=>o.type==='poi'&&o.metadata?.roomId===other.id)){
        pin.metadata={...pin.metadata,roomId:target.id,needsReview:true};
        if(pin.category==='Room Door')pin.name=target.name;
      }
    }
  }
}
