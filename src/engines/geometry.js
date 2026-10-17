const radians = (degrees) => (degrees * Math.PI) / 180;

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function polylineLength(points = []) {
  return points.slice(1).reduce((total, point, index) => total + distance(points[index], point), 0);
}

export function polygonArea(points = []) {
  if (points.length < 3) return 0;
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

export function polygonPerimeter(points = []) {
  return points.length > 2 ? polylineLength([...points, points[0]]) : polylineLength(points);
}

export function objectPoints(object) {
  if (object.points) return object.points;
  if (object.type === "rectangle" || object.type === "room") {
    return [
      { x: object.x, y: object.y },
      { x: object.x + object.width, y: object.y },
      { x: object.x + object.width, y: object.y + object.height },
      { x: object.x, y: object.y + object.height },
    ];
  }
  return [{ x: object.x, y: object.y }];
}

export function boundsOf(object) {
  const points = objectPoints(object);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export function moveObject(object, dx, dy) {
  if (object.points) {
    return { ...object, points: object.points.map((point) => ({ x: point.x + dx, y: point.y + dy })), ...(object.holes?{holes:object.holes.map(ring=>ring.map(p=>({x:p.x+dx,y:p.y+dy})))}:{}) };
  }
  return { ...object, x: object.x + dx, y: object.y + dy };
}

export function resizeObject(object, handle, point, minimum = 2) {
  const bounds = boundsOf(object);
  const opposite = {
    nw: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    ne: { x: bounds.x, y: bounds.y + bounds.height },
    se: { x: bounds.x, y: bounds.y },
    sw: { x: bounds.x + bounds.width, y: bounds.y },
  }[handle];
  const next = {
    x: Math.min(point.x, opposite.x),
    y: Math.min(point.y, opposite.y),
    width: Math.max(minimum, Math.abs(point.x - opposite.x)),
    height: Math.max(minimum, Math.abs(point.y - opposite.y)),
  };

  if (!object.points) return { ...object, ...next };
  const scaleX = bounds.width ? next.width / bounds.width : 1;
  const scaleY = bounds.height ? next.height / bounds.height : 1;
  return {
    ...object,
    ...(object.holes?{holes:object.holes.map(ring=>ring.map(item=>({x:next.x+(item.x-bounds.x)*scaleX,y:next.y+(item.y-bounds.y)*scaleY})))}:{}),
    points: object.points.map((item) => ({
      x: next.x + (item.x - bounds.x) * scaleX,
      y: next.y + (item.y - bounds.y) * scaleY,
    })),
  };
}

export function rotationFromCenter(object, point) {
  const bounds = boundsOf(object);
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  return Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI + 90;
}

export function rotatedPoint(point, center, degrees) {
  const angle = radians(degrees);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

export function measurements(object, metersPerPixel) {
  if (!object || !Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return { area: null, perimeter: null, length: null };
  const points = objectPoints(object);
  const closed = ["room", "polygon", "walkableArea", "restrictedArea", "rectangle","buildingBoundary","nonWalkableArea"].includes(object.type);
  const perimeterPixels = closed ? polygonPerimeter(points)+(object.holes||[]).reduce((sum,ring)=>sum+polygonPerimeter(ring),0) : polylineLength(points);
  return {
    area: closed ? (polygonArea(points)-(object.holes||[]).reduce((sum,ring)=>sum+polygonArea(ring),0)) * metersPerPixel ** 2 : null,
    perimeter: closed ? perimeterPixels * metersPerPixel : null,
    length: closed ? null : perimeterPixels * metersPerPixel,
  };
}

export function moveVertex(object,index,point){
  if(!Number.isInteger(index)||index<0||index>=objectPoints(object).length||![point.x,point.y].every(Number.isFinite))throw new Error('Invalid polygon vertex.');
  const bounds=boundsOf(object),center={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
  const points=objectPoints(object).map(p=>rotatedPoint(p,center,object.rotation||0));
  points[index]={x:point.x,y:point.y};
  return {...object,points,rotation:0,...(object.holes?{holes:object.holes.map(ring=>ring.map(p=>rotatedPoint(p,center,object.rotation||0)))}:{})};
}

// shortcut: simplify within one raster cell; use vector CAD extraction for survey precision.
export function simplifyContour(points,tolerance){
  if(points.length<5||!(tolerance>0))return points;
  function simplify(path){
    const keep=new Set([0,path.length-1]),stack=[[0,path.length-1]];
    while(stack.length){const [start,end]=stack.pop(),a=path[start],b=path[end],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;let farthest=-1,max=tolerance*tolerance;
      for(let i=start+1;i<end;i++){const p=path[i],t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0,d=(p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;if(d>max){max=d;farthest=i;}}
      if(farthest>=0){keep.add(farthest);stack.push([start,farthest],[farthest,end]);}
    }
    return path.filter((_,i)=>keep.has(i));
  }
  const first=points[0];let opposite=1;
  for(let i=2;i<points.length;i++)if(distance(first,points[i])>distance(first,points[opposite]))opposite=i;
  const result=[...simplify(points.slice(0,opposite+1)).slice(0,-1),...simplify([...points.slice(opposite),first]).slice(0,-1)];
  const area=polygonArea(points),nextArea=polygonArea(result);
  return result.length>=3&&nextArea>=area*.85&&nextArea<=area*1.15?result:points;
}

// Only flatten short square detours that return to the same continuing wall.
export function straightenPillarNotches(points,maxSize){
  if(!(maxSize>0)||points.length<6)return points;
  const result=simplifyContour(points,maxSize*.01).map(p=>({...p})),epsilon=maxSize*.4;
  let changed=true;
  while(changed&&result.length>=6){changed=false;
    for(let i=0;i<result.length;i++){
      const at=k=>result[(i+k+result.length)%result.length],a=at(0),b=at(1),c=at(2),d=at(3),before=at(-1),after=at(4),length=distance(a,d);
      for(let span=result.length-3;span>=3;span--){
        const end=at(span),following=at(span+1),len=distance(a,end);if(len<maxSize)continue;
        const ux=(end.x-a.x)/len,uy=(end.y-a.y)/len,along=p=>(p.x-a.x)*ux+(p.y-a.y)*uy,across=p=>(p.x-a.x)*uy-(p.y-a.y)*ux;
        if(Math.abs(across(before))>epsilon||Math.abs(across(following))>epsilon||along(before)>=0||along(following)<=len)continue;
        const inner=Array.from({length:span-1},(_,j)=>at(j+1));
        if(inner.some(p=>Math.abs(across(p))>maxSize||along(p)<-epsilon||along(p)>len+epsilon))continue;
        const run=[a,...inner,end];
        if(run.slice(1).some((p,j)=>{const q=run[j],l=distance(p,q);return l>maxSize*.3&&Math.min(Math.abs((p.x-q.x)*ux+(p.y-q.y)*uy),Math.abs((p.x-q.x)*uy-(p.y-q.y)*ux))/l>.18;}))continue;
        const remove=new Set(inner.map((_,j)=>(i+j+1)%result.length)),next=result.filter((_,j)=>!remove.has(j));
        if(Math.abs(polygonArea(next)-polygonArea(points))>polygonArea(points)*.15)continue;
        result.splice(0,result.length,...next);changed=true;break;
      }
      if(changed)break;
      const vx=a.x-before.x,vy=a.y-before.y,wx=d.x-c.x,wy=d.y-c.y,vl=Math.hypot(vx,vy),wl=Math.hypot(wx,wy),cross=vx*wy-vy*wx;
      if(vl>=maxSize*2&&wl>=maxSize*2&&Math.abs(cross)>vl*wl*.8){
        const t=((c.x-a.x)*wy-(c.y-a.y)*wx)/cross,corner={x:a.x+t*vx,y:a.y+t*vy};
        if([a,c].every(p=>distance(p,corner)<=maxSize)&&distance(b,corner)<=maxSize*Math.SQRT2&&[distance(a,b),distance(b,c)].every(l=>l<=maxSize)){
          const remove=new Set([i,(i+1)%result.length,(i+2)%result.length]);
          const next=result.flatMap((p,j)=>j===i?[corner]:remove.has(j)?[]:[p]);
          if(Math.abs(polygonArea(next)-polygonArea(points))<=polygonArea(points)*.15){result.splice(0,result.length,...next);changed=true;break;}
        }
      }
      if(length<epsilon||length>maxSize)continue;
      const ux=(d.x-a.x)/length,uy=(d.y-a.y)/length;
      const along=p=>(p.x-a.x)*ux+(p.y-a.y)*uy,across=p=>(p.x-a.x)*uy-(p.y-a.y)*ux;
      const depth=across(b);
      if(Math.abs(depth)<epsilon||Math.abs(depth)>maxSize||Math.abs(across(c)-depth)>epsilon||Math.abs(along(b))>epsilon||Math.abs(along(c)-length)>epsilon||Math.abs(across(before))>epsilon||Math.abs(across(after))>epsilon||along(before)>-length||along(after)<length*2)continue;
      const remove=new Set([(i+1)%result.length,(i+2)%result.length]);
      const next=result.filter((_,index)=>!remove.has(index));
      if(Math.abs(polygonArea(next)-polygonArea(points))>polygonArea(points)*.15)continue;
      result.splice(0,result.length,...next);changed=true;break;
    }
  }
  return simplifyContour(result,maxSize*.01);
}
