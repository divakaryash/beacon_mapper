// Join the midpoints of repeated one-cell risers. Using the midpoint keeps
// opposite faces of a thin diagonal wall at their original separation.
export function straightenRasterStairs(ring,sx=1,sy=1){
  if(ring.length<7)return ring;
  const n=ring.length,epsilon=1e-5;
  const edge=ring.map((p,i)=>{
    const q=ring[(i+1)%n];
    return {x:(q.x-p.x)/sx,y:(q.y-p.y)/sy};
  });
  const axis=e=>Math.abs(e.x)<epsilon?'y':Math.abs(e.y)<epsilon?'x':null;
  // Start at a break in the tread pattern so a run may cross vertex zero.
  const start=edge.findIndex((e,i)=>{
    const previous=edge[(i+n-2)%n];
    return !axis(e)||axis(previous)!==axis(e)||e[axis(e)]*previous[axis(e)]<=0;
  });
  const at=i=>(i+Math.max(start,0))%n;
  const midpoint=i=>{
    const a=ring[at(i)],b=ring[at(i+1)];
    return {x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  };
  const result=[];
  let changed=false;
  for(let i=0;i<n;i++){
    result.push(ring[at(i)]);
    const first=edge[at(i)],minor=axis(first);
    if(!minor||Math.abs(Math.abs(first[minor])-1)>epsilon)continue;
    const major=minor==='x'?'y':'x',step=edge[at(i+1)][major];
    if(Math.abs(step)<1-epsilon)continue;
    let end=i,min=Math.abs(step),max=min;
    for(let j=i+2;j<n;j+=2){
      const riser=edge[at(j)],tread=edge[at(j-1)];
      if(axis(riser)!==minor||Math.abs(riser[minor]-first[minor])>epsilon||
        axis(tread)!==major||step*tread[major]<=0)break;
      min=Math.min(min,Math.abs(tread[major]));max=Math.max(max,Math.abs(tread[major]));
      if(max-min>1+epsilon)break;
      end=j;
    }
    if(end-i<4)continue;
    const a=midpoint(i),b=midpoint(end),dx=(b.x-a.x)/sx,dy=(b.y-a.y)/sy;
    const length=Math.hypot(dx,dy);
    let fits=true;
    for(let j=i+2;j<end;j+=2){
      const p=midpoint(j);
      if(Math.abs(dx*(p.y-a.y)/sy-dy*(p.x-a.x)/sx)>.55*length){fits=false;break;}
    }
    if(!fits)continue;
    result.push(a,b);i=end;changed=true;
  }
  return changed?result:ring;
}

// When one shortcut crosses a narrow branch, retain that branch and continue
// simplifying the other spans of the same wall.
export function simplifyNarrowContour(ring,tolerance){
  const n=ring.length,next=Array.from({length:n},(_,i)=>(i+1)%n);
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  let area=ring.reduce((sum,p,i)=>sum+cross(ring[0],p,ring[next[i]]),0);
  const original=area,stack=[];
  let opposite=1;
  for(let i=2;i<n;i++)if(Math.hypot(ring[i].x-ring[0].x,ring[i].y-ring[0].y)>
    Math.hypot(ring[opposite].x-ring[0].x,ring[opposite].y-ring[0].y))opposite=i;
  stack.push([0,opposite],[opposite,n]);
  while(stack.length){
    const [start,end]=stack.pop();
    if(end-start<2)continue;
    const a=ring[start],b=ring[end%n],dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
    let split=start+1,worst=-1,delta=0;
    for(let i=start+1;i<end;i++){
      const p=ring[i],t=len?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len)):0;
      const error=(p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;
      if(error>worst){worst=error;split=i;}
      delta+=cross(a,p,ring[(i+1)%n]);
    }
    let safe=worst<=tolerance*tolerance&&Math.abs((area-delta)/original-1)<=.12;
    // Only the complement of the candidate span survives after replacement.
    for(let j=end%n;safe&&j!==start;j=next[j]){
      const k=next[j],c=ring[j],d=ring[k];
      if(j===end%n||k===start)continue;
      if(Math.max(a.x,b.x)<Math.min(c.x,d.x)||Math.max(c.x,d.x)<Math.min(a.x,b.x)||
        Math.max(a.y,b.y)<Math.min(c.y,d.y)||Math.max(c.y,d.y)<Math.min(a.y,b.y))continue;
      if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)safe=false;
    }
    if(safe){next[start]=end%n;area-=delta;}
    else stack.push([start,split],[split,end]);
  }
  const points=[];
  for(let i=0;!points.length||i!==0;i=next[i])points.push(ring[i]);
  return points;
}
