// Reconstruct a doorway enclosure in its sheet-space frame (metres). Side
// walls may meet the frontage obliquely, as at a splayed or curved facade.
export function traceDoorCorners(strokes,doors,doorWidth,sign,painted){
  const across=[],along=[];
  function collect({p,q,paired},portal){
    const dx=q.x-p.x,dy=q.y-p.y;
    for(const [swap,list] of [[false,across],[true,along]]){
      const run=swap?dy:dx,rise=swap?dx:dy;
      if(!run||Math.abs(rise/run)>.38)continue;
      const t=swap?p.y:p.x,v=swap?p.x:p.y,k=rise/run;
      list.push({k,c:v-k*t,lo:Math.min(t,t+run),hi:Math.max(t,t+run),paired,portal});
    }
  }
  for(const l of strokes)collect(l,false);
  for(const d of doors)collect(d,true);
  const value=(l,t)=>l.c+l.k*t;
  function unique(list,position){
    const keys=new Set();
    return list.filter(l=>{
      const key=Math.round(position(l)/.05)+','+Math.round(l.k/.04);
      if(keys.has(key))return false;
      keys.add(key);return true;
    });
  }
  // Test each run, including the approaches to both corners. A cluster of
  // short hatch strokes on the far side of a junction cannot support a wall.
  function evidence(line,lo,hi,lines){
    if(hi<lo)[lo,hi]=[hi,lo];
    const match=lines.filter(l=>Math.abs(l.k-line.k)<.19&&l.hi>=lo-.22&&l.lo<=hi+.22);
    const n=Math.max(8,Math.ceil((hi-lo)/.14));let hits=0,first=false,last=false;
    for(let i=0;i<=n;i++){
      const t=lo+(hi-lo)*i/n;
      const hit=match.some(l=>l.lo-.12<=t&&t<=l.hi+.12&&Math.abs(value(l,t)-value(line,t))<=.15);
      if(hit){
        hits++;if(i<=1)first=true;if(i>=n-1)last=true;
      }else if(painted&&i>1&&i<n-1){
        const v=value(line,t);
        if(painted(lines===along?{x:v,y:t}:{x:t,y:v}))hits++;
      }
    }
    return first&&last?hits/(n+1):0;
  }
  const front={k:0,c:0};
  const backs=unique(across.filter(l=>!l.portal&&l.c*sign>=1.65&&l.c*sign<=8&&l.lo<=1.4&&l.hi>=-1.4)
    .sort((a,b)=>Math.abs(a.c)-Math.abs(b.c)),l=>l.c).slice(0,24);
  let best;
  for(const back of backs){
    const mid=back.c/2;
    const sides=unique(along.filter(l=>!l.portal&&l.hi-l.lo>=1&&l.lo<=mid+.35&&l.hi>=mid-.35),l=>value(l,mid));
    const left=sides.filter(l=>l.c<=-doorWidth/2+.12&&l.c>=-7).sort((a,b)=>b.c-a.c).slice(0,14);
    const right=sides.filter(l=>l.c>=doorWidth/2-.12&&l.c<=7).sort((a,b)=>a.c-b.c).slice(0,14);
    for(const l of left)for(const r of right){
      const width=r.c-l.c,area=width*Math.abs(back.c);
      if(width<1.65||area<4||area>60||!(l.paired||r.paired||back.paired))continue;
      const by=s=>(back.c+back.k*s.c)/(1-back.k*s.k),yl=by(l),yr=by(r),xl=value(l,yl),xr=value(r,yr);
      if((xr-xl)<1.4||Math.min(yl*sign,yr*sign)<1.5)continue;
      const scoreFront=evidence(front,l.c,r.c,across);
      if(scoreFront<.76)continue;
      const scoreBack=evidence(back,xl,xr,across);
      if(scoreBack<.73)continue;
      const scores=[scoreFront,scoreBack,evidence(l,0,yl,along),evidence(r,0,yr,along)];
      if(Math.min(...scores)<.73)continue;
      // A second doorway well inside the box is evidence for another space.
      const spansDoor=doors.some(({p,q})=>{
        const x=(p.x+q.x)/2,y=(p.y+q.y)/2;
        return y*sign>.40&&(value(back,x)-y)*sign>.4&&x-value(l,y)>.40&&value(r,y)-x>.40;
      });
      if(spansDoor)continue;
      const score=scores.reduce((a,b)=>a+b,0)/4-.014*area;
      if(!best||score>best.score)best={score,area,points:[{x:l.c,y:0},{x:r.c,y:0},{x:xr,y:yr},{x:xl,y:yl}]};
    }
  }
  return best;
}
