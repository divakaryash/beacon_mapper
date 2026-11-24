import {segmentProjection,selfIntersects} from './floorGeometry.js';
import {polygonArea} from './geometry.js';

// Index long PDF strokes and require a second parallel face at wall thickness.
// The same index is queried by both rooms sharing a divider.
export function pairedWallIndex(coords,width,height,scale,onGap,onIndex,onWall){
  const bins=new Map(),size=5/scale,lines=[];
  function visit(a,b,pad,cb){
    for(let y=Math.floor((Math.min(a.y,b.y)-pad)/size);y<=Math.floor((Math.max(a.y,b.y)+pad)/size);y++)
      for(let x=Math.floor((Math.min(a.x,b.x)-pad)/size);x<=Math.floor((Math.max(a.x,b.x)+pad)/size);x++)cb(x+','+y);
  }
  const nearby=(a,b,pad)=>{
    const found=new Set();visit(a,b,pad,k=>{for(const l of bins.get(k)||[])found.add(l);});return found;
  };
  for(let i=0;i<coords.length;i+=4){
    const a={x:coords[i]*width,y:coords[i+1]*height},b={x:coords[i+2]*width,y:coords[i+3]*height};
    const len=Math.hypot(b.x-a.x,b.y-a.y);
    if(len*scale<.8)continue;
    const l={a,b,len,ux:(b.x-a.x)/len,uy:(b.y-a.y)/len};
    l.id=lines.length;lines.push(l);visit(a,b,0,k=>{if(!bins.has(k))bins.set(k,[]);bins.get(k).push(l);});
  }
  for(const l of lines)for(const q of nearby(l.a,l.b,.5/scale)){
    if(q===l||Math.abs(l.ux*q.uy-l.uy*q.ux)>.018)continue;
    const ax=q.a.x-l.a.x,ay=q.a.y-l.a.y,offset=Math.abs(ax*l.uy-ay*l.ux)*scale;
    if(offset<.075||offset>.45)continue;
    const p=ax*l.ux+ay*l.uy,t=(q.b.x-l.a.x)*l.ux+(q.b.y-l.a.y)*l.uy;
    const overlap=Math.min(l.len,Math.max(p,t))-Math.max(0,Math.min(p,t));
    if(overlap<.65*Math.min(l.len,q.len))continue;
    const lo=Math.max(0,Math.min(p,t)),hi=Math.min(l.len,Math.max(p,t));
    (l.support||=[]).push([lo,hi]);
    if(onWall&&l.id<q.id&&overlap*scale>=1){
      const a={x:l.a.x+lo*l.ux,y:l.a.y+lo*l.uy},b={x:l.a.x+hi*l.ux,y:l.a.y+hi*l.uy};
      onWall([a,b,segmentProjection(b,q.a,q.b),segmentProjection(a,q.a,q.b)]);
    }
  }
  if(onGap){
    const gaps=[],emitted=new Set();
    for(const l of lines.filter(l=>l.support))for(const [tip,sign] of [[l.a,-1],[l.b,1]]){
      const end=sign<0?0:l.len;
      if(!l.support.some(([lo,hi])=>lo-.25/scale<=end&&hi+.25/scale>=end))continue;
      for(const q of nearby(tip,tip,1.85/scale)){
        if(q===l||!q.support||Math.abs(l.ux*q.uy-l.uy*q.ux)>.025)continue;
        const other=(l.ux*q.ux+l.uy*q.uy)*sign>0?q.a:q.b;
        const pos=other===q.a?0:q.len;
        if(!q.support.some(([lo,hi])=>lo-.25/scale<=pos&&hi+.25/scale>=pos))continue;
        const dx=other.x-tip.x,dy=other.y-tip.y,widthM=(dx*l.ux+dy*l.uy)*scale*sign;
        if(widthM<.7||widthM>1.65||Math.abs(dx*l.uy-dy*l.ux)*scale>.065)continue;
        const mid={x:(tip.x+other.x)/2,y:(tip.y+other.y)/2};
        if([...nearby(mid,mid,.12/scale)].some(w=>w!==l&&w!==q&&segmentProjection(mid,w.a,w.b).distance*scale<.065))continue;
        const key=Math.round(mid.x*scale*40)+','+Math.round(mid.y*scale*40);
        if(!emitted.has(key)){emitted.add(key);gaps.push({a:tip,b:other,mid,ux:l.ux,uy:l.uy,widthM});}
      }
    }
    const paired=new Set();
    for(let i=0;i<gaps.length;i++){
      if(paired.has(i))continue;
      const g=gaps[i];
      for(let j=i+1;j<gaps.length;j++){
        const h=gaps[j],dx=(h.mid.x-g.mid.x)*scale,dy=(h.mid.y-g.mid.y)*scale,offset=Math.abs(dx*g.uy-dy*g.ux);
        if(paired.has(j)||offset<.075||offset>.45||Math.abs(dx*g.ux+dy*g.uy)>.17||
          Math.abs(g.ux*h.uy-g.uy*h.ux)>.03||Math.abs(g.widthM-h.widthM)>.18)continue;
        // Strokes on both outer faces can be interrupted by a column or hatch
        // while a continuous wall line still spans the proposed opening.
        const blocked=[...nearby(g.a,g.b,.5/scale)].some(line=>{
          // A divider meeting the middle of the gap makes a T-junction.
          // Confirm the transverse stroke has a parallel wall face at the tip.
          if(line.support&&Math.abs(g.ux*line.ux+g.uy*line.uy)<.2){
            const cross=segmentProjection(g.mid,line.a,line.b);
            const t=(cross.x-line.a.x)*line.ux+(cross.y-line.a.y)*line.uy;
            if(cross.distance*scale<Math.min(.22,g.widthM*.2)&&
              line.support.some(([lo,hi])=>t>=lo-.15/scale&&t<=hi+.15/scale))return true;
          }
          if(Math.abs(g.ux*line.uy-g.uy*line.ux)>.04)return false;
          const side=p=>((p.x-g.mid.x)*g.uy-(p.y-g.mid.y)*g.ux)*scale;
          const offsetFromFace=side(line.a),otherFace=side(h.mid);
          if(offsetFromFace<Math.min(0,otherFace)-.04||offsetFromFace>Math.max(0,otherFace)+.04)return false;
          const along=p=>((p.x-g.mid.x)*g.ux+(p.y-g.mid.y)*g.uy)*scale;
          const a=along(line.a),b=along(line.b);
          return Math.min(a,b)<-g.widthM*.42&&Math.max(a,b)>g.widthM*.42;
        });
        if(blocked)continue;
        // Close one face for room tracing. Neither threshold is extruded.
        onGap({a:{x:g.a.x/width,y:g.a.y/height},b:{x:g.b.x/width,y:g.b.y/height},source:'aligned gaps in paired PDF walls'});
        paired.add(i);paired.add(j);break;
      }
    }
  }
  onIndex?.(nearby);
  return (a,b)=>{
    const len=Math.hypot(b.x-a.x,b.y-a.y);
    if(len*scale<.85)return null;
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};let best=null,min=.28/scale;
    for(const l of nearby(a,b,min)){
      if(!l.support||Math.abs((b.x-a.x)*l.uy-(b.y-a.y)*l.ux)/len>.085)continue;
      const d=segmentProjection(mid,l.a,l.b),pos=d.t*l.len;
      if(!l.support.some(([s,e])=>pos>=s&&pos<=e)||d.distance>=min)continue;
      if(Math.max(segmentProjection(a,l.a,l.b).distance,segmentProjection(b,l.a,l.b).distance)*scale>.35)continue;
      min=d.distance;best=l;
    }
    return best;
  };
}
export function fitSupportedEdges(ring,lookup,scale){
  const support=ring.map((a,i)=>lookup(a,ring[(i+1)%ring.length]));
  if(!support.some(Boolean))return null;
  const points=ring.map((p,i)=>{
    const prev=support[(i+ring.length-1)%ring.length],next=support[i],line=prev||next;
    if(!line)return p;
    let q=segmentProjection(p,line.a,line.b);
    if(prev&&next){
      const den=prev.ux*next.uy-prev.uy*next.ux;
      if(Math.abs(den)>.13){
        const t=((next.a.x-prev.a.x)*next.uy-(next.a.y-prev.a.y)*next.ux)/den;
        q={x:prev.a.x+t*prev.ux,y:prev.a.y+t*prev.uy};
      }
    }
    return Math.hypot(p.x-q.x,p.y-q.y)*scale<=.35?{x:q.x,y:q.y}:p;
  });
  return points.some((p,i)=>Math.hypot(p.x-ring[i].x,p.y-ring[i].y)*scale>.01)&&
    Math.abs(polygonArea(points)/polygonArea(ring)-1)<.08&&!selfIntersects(points)?points:null;
}
