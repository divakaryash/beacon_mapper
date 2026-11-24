import {traceDoorCorners} from './traceDoorCorners.js';
import {pointInPolygon,segmentProjection} from './floorGeometry.js';

function coverage(lines,at,low,high,tolerance){
  const ranges=lines.filter(l=>Math.abs(l.at-at)<=tolerance).map(l=>[Math.max(low,l.lo),Math.min(high,l.hi)])
    .filter(([a,b])=>a<b).sort((a,b)=>a[0]-b[0]);
  let covered=0,end=low;
  for(const [a,b] of ranges){covered+=Math.max(0,b-Math.max(end,a));end=Math.max(end,b);}
  return covered/(high-low);
}

// Test wall-supported enclosures on each side of a printed door swing. This
// recovers a room even when its raster floor leaked into the hall.
export function roomsAtDoorways(portals,nearby,width,height,scale,pageAspect=height/width,wallPaintAt){
  // Fit right angles in sheet coordinates. Independent real-world width and
  // height calibration can otherwise turn a printed square into a rhombus.
  const yFactor=width*pageAspect/height;
  const onSheet=p=>({x:p.x,y:p.y*yFactor});
  const onPlan=p=>({x:p.x,y:p.y/yFactor});
  const query=(origin,radius)=>[...nearby(onPlan(origin),onPlan(origin),radius/Math.min(1,yFactor))].map(l=>{
    const a=onSheet(l.a),b=onSheet(l.b),len=Math.hypot(b.x-a.x,b.y-a.y);
    return {...l,a,b,len,ux:(b.x-a.x)/len,uy:(b.y-a.y)/len};
  });
  height*=yFactor;
  const rooms=[];
  for(const portal of portals){
    if(portal.source)continue;
    const a={x:portal.a.x*width,y:portal.a.y*height},b={x:portal.b.x*width,y:portal.b.y*height};
    const len=Math.hypot(b.x-a.x,b.y-a.y),doorWidth=len*scale;
    if(doorWidth<.6||doorWidth>1.9)continue;
    let ux=(b.x-a.x)/len,uy=(b.y-a.y)/len;
    const origin={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const jambs=query(origin,1/scale).filter(l=>l.support&&Math.abs(ux*l.uy-uy*l.ux)<.14&&
      Math.min(segmentProjection(a,l.a,l.b).distance,segmentProjection(b,l.a,l.b).distance)*scale<.22);
    jambs.sort((l,q)=>q.len-l.len);
    if(jambs.length){ux=jambs[0].ux;uy=jambs[0].uy;}
    const local=p=>({x:((p.x-origin.x)*ux+(p.y-origin.y)*uy)*scale,y:((p.y-origin.y)*ux-(p.x-origin.x)*uy)*scale});
    const point=(x,y)=>({x:origin.x+(x*ux-y*uy)/scale,y:origin.y+(x*uy+y*ux)/scale});
    const vertical=[],horizontal=[],strokes=[],thresholds=[];
    for(const l of query(origin,10/scale)){
      const p=local(l.a),q=local(l.b),dx=q.x-p.x,dy=q.y-p.y;
      strokes.push({p,q,paired:!!l.support});
      if(Math.abs(dx)<.09*Math.abs(dy))vertical.push({at:(p.x+q.x)/2,lo:Math.min(p.y,q.y),hi:Math.max(p.y,q.y),paired:!!l.support});
      if(Math.abs(dy)<.09*Math.abs(dx))horizontal.push({at:(p.y+q.y)/2,lo:Math.min(p.x,q.x),hi:Math.max(p.x,q.x),paired:!!l.support});
    }
    // A room may also have a second door on its side or rear wall.
    for(const door of portals){
      const p=local({x:door.a.x*width,y:door.a.y*height}),q=local({x:door.b.x*width,y:door.b.y*height});
      if(Math.abs(p.x)>11||Math.abs(p.y)>11)continue;
      thresholds.push({p,q});
      if(Math.abs(p.y-q.y)<.13)horizontal.push({at:(p.y+q.y)/2,lo:Math.min(p.x,q.x),hi:Math.max(p.x,q.x)});
      if(Math.abs(p.x-q.x)<.13)vertical.push({at:(p.x+q.x)/2,lo:Math.min(p.y,q.y),hi:Math.max(p.y,q.y)});
    }
    const swing=portal.swingTip&&local({x:portal.swingTip.x*width,y:portal.swingTip.y*height});
    let best;
    for(const sign of [1,-1]){
      if(swing&&swing.y*sign<=0)continue;
      const ys=horizontal.filter(l=>l.at*sign>1.7&&l.at*sign<9&&l.lo<1.5&&l.hi>-1.5)
        .sort((a,b)=>Math.abs(a.at)-Math.abs(b.at)).slice(0,12);
      for(const back of ys){
        const y0=Math.min(0,back.at),y1=Math.max(0,back.at);
        const sides=vertical.filter(l=>l.hi>y0+.3&&l.lo<y1-.3&&Math.abs(l.at)<8);
        const left=sides.filter(l=>l.at<=-doorWidth/2+.15).sort((a,b)=>b.at-a.at).slice(0,10);
        const right=sides.filter(l=>l.at>=doorWidth/2-.15).sort((a,b)=>a.at-b.at).slice(0,10);
        for(const l of left)for(const r of right){
          const w=r.at-l.at,area=w*(y1-y0);
          if(w<1.8||w>10||area<5||area>65)continue;
          if(!back.paired&&!l.paired&&!r.paired)continue;
          // A side-to-side partition inside the proposed box divides two rooms.
          if(vertical.some(v=>v.paired&&v.at>l.at+.4&&v.at<r.at-.4&&
            coverage(vertical,v.at,y0,y1,.13)>.8))continue;
          const scores=[coverage(vertical,l.at,y0,y1,.18),coverage(vertical,r.at,y0,y1,.18),
            coverage(horizontal,0,l.at,r.at,.18),coverage(horizontal,back.at,l.at,r.at,.18)];
          const min=Math.min(...scores),mean=scores.reduce((a,b)=>a+b,0)/4;
          if(min<.74||mean<.90)continue;
          const score=mean+min*.25-area*.004;
          if(!best||score>best.score)best={points:[point(l.at,0),point(r.at,0),point(r.at,back.at),point(l.at,back.at)],score,portal:origin,area};
        }
      }
    }
    if(swing&&Math.abs(swing.y)>.2){
      const painted=wallPaintAt&&(p=>wallPaintAt(onPlan(point(p.x,p.y))));
      const traced=traceDoorCorners(strokes,thresholds,doorWidth,Math.sign(swing.y),painted);
      if(traced)best={...traced,points:traced.points.map(p=>point(p.x,p.y)),portal:origin};
    }
    if(best){
      const center={x:(best.points[0].x+best.points[2].x)/2,y:(best.points[0].y+best.points[2].y)/2};
      if(!rooms.some(r=>pointInPolygon(center,r.points)))rooms.push(best);
    }
  }
  return rooms.map(r=>({...r,points:r.points.map(onPlan),portal:onPlan(r.portal)}));
}
