const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

function singleStroke(path,m){
  const points=[];
  const point=(x,y)=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f});
  if(!path||path[0]!==0||path.length>100)return points;
  points.push(point(path[1],path[2]));
  for(let i=3;i<path.length;){
    const op=path[i++];
    if(op===4&&i===path.length){points.push(points[0]);break;}
    if(op===1){points.push(point(path[i++],path[i++]));continue;}
    if(op!==2)return [];
    const a=points.at(-1),b=point(path[i++],path[i++]),c=point(path[i++],path[i++]),d=point(path[i++],path[i++]);
    for(let n=1;n<=6;n++){
      const t=n/6,u=1-t;
      points.push({x:u**3*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t**3*d.x,y:u**3*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t**3*d.y});
    }
  }
  return points;
}

// A quarter-circle on its own is ambiguous. Require a straight door leaf on one
// radius, then use the other radius as the opening in the room's wall.
export function doorSymbols(maxRadius){
  const arcs=[],lines=new Map(),bin=8;
  const key=(x,y)=>Math.floor(x/bin)+','+Math.floor(y/bin);
  function collect(path,m,index){
    const p=singleStroke(path,m);
    if(p.length<2)return;
    let a=p[0],b=p.at(-1);
    // Plotted CAD doors often draw the open leaf as a long, thin closed box.
    let blade=false;
    if(p.length>=4&&p.length<=8&&distance(a,b)<.15){
      let longest=0;
      for(let j=1;j<p.length;j++){const len=distance(p[j-1],p[j]);if(len>longest){longest=len;a=p[j-1];b=p[j];}}
      if(longest<2)return;
      const deviation=Math.max(...p.map(q=>Math.abs((b.x-a.x)*(q.y-a.y)-(b.y-a.y)*(q.x-a.x))/longest));
      if(deviation>Math.max(.32,longest*.065))return;
      blade=true;
    }
    const chord=distance(a,b);
    if(chord<2||chord>maxRadius*1.7)return;
    if(p.length===2||blade){
      for(const end of [a,b]){
        const k=key(end.x,end.y);
        if(!lines.has(k))lines.set(k,[]);
        lines.get(k).push({a,b,length:chord,index});
      }
      return;
    }
    if(p.length<4)return;
    const dx=b.x-a.x,dy=b.y-a.y,r=chord/Math.SQRT2;
    for(const sign of [-1,1]){
      const center={x:(a.x+b.x-sign*dy)/2,y:(a.y+b.y+sign*dx)/2};
      if(!p.every(v=>Math.abs(distance(v,center)-r)<=Math.max(.16,r*.035)))continue;
      arcs.push({a,b,center,r,index});break;
    }
  }
  function openings(){
    const found=[];
    // A double swing may show just two arcs. The closed tips meet midway
    // between two hinges, and the open leaves point in the same direction.
    const tips=new Map();
    for(const arc of arcs)for(const end of [arc.a,arc.b]){
      const k=key(end.x,end.y);
      if(!tips.has(k))tips.set(k,[]);
      tips.get(k).push({arc,end,open:end===arc.a?arc.b:arc.a});
    }
    for(const {arc,end,open} of [...tips.values()].flat()){
      const x=Math.floor(end.x/bin),y=Math.floor(end.y/bin),tol=Math.max(.35,.12*arc.r);
      for(let j=y-1;j<=y+1;j++)for(let i=x-1;i<=x+1;i++)for(const mate of tips.get(i+','+j)||[]){
        if(mate.arc.index<=arc.index||Math.abs(mate.arc.r-arc.r)>tol||distance(mate.end,end)>tol)continue;
        const mid={x:(arc.center.x+mate.arc.center.x)/2,y:(arc.center.y+mate.arc.center.y)/2};
        if(distance(mid,end)>tol||distance(arc.center,mate.arc.center)<1.8*arc.r)continue;
        if(Math.hypot(open.x-arc.center.x-mate.open.x+mate.arc.center.x,
          open.y-arc.center.y-mate.open.y+mate.arc.center.y)>tol)continue;
        for(const half of [{arc,end,open},mate]){
          if(!found.some(v=>distance(v.a,half.arc.center)<.5&&distance(v.b,mid)<.5))
            found.push({a:half.arc.center,b:mid,swingTip:half.open,indices:[half.arc.index]});
        }
      }
    }
    for(const {a,b,center,r,index} of arcs){
      const bx=Math.floor(center.x/bin),by=Math.floor(center.y/bin),tol=Math.max(.8,r*.18);
      let leaf=null,leafIndex;
      for(let y=by-1;y<=by+1&&!leaf;y++)for(let x=bx-1;x<=bx+1&&!leaf;x++)for(const line of lines.get(x+','+y)||[]){
        if(Math.abs(line.length-r)>tol*1.7)continue;
        const tip=distance(line.a,center)<=tol?line.b:distance(line.b,center)<=tol?line.a:null;
        if(tip&&distance(tip,a)<=tol){leaf=b;leafIndex=line.index;break;}
        if(tip&&distance(tip,b)<=tol){leaf=a;leafIndex=line.index;break;}
      }
      if(leaf){
        const existing=found.find(v=>distance(v.a,center)<1&&distance(v.b,leaf)<1);
        if(existing)existing.indices.push(leafIndex);
        else found.push({a:center,b:leaf,swingTip:leaf===b?a:b,indices:[index,leafIndex]});
      }
    }
    return found;
  }
  return {collect,openings};
}
