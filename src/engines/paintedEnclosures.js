import {polygonArea} from './geometry.js';
import {closeDoorGaps,maskContours} from './floorPlanAnalysis.js';

// Connected interiors in a separately rendered wall-fill layer. Door thresholds
// partition this temporary mask only. Keep the detailed pass for physical walls.
export function paintedEnclosures({wallPaintMask,width,height,drawingWidth,drawingHeight,metersPerPixel,openingSegments=[],vectorWallBands=[]}){
  if(!wallPaintMask||wallPaintMask.length!==width*height||!wallPaintMask.some(Boolean))return [];
  const mask=wallPaintMask.slice(),sx=drawingWidth/width,sy=drawingHeight/height;
  // A drawing may hatch the exterior and outline the interior partitions.
  // Extend the hatch network with long paired wall faces attached to it.
  for(const band of vectorWallBands){
    const [a,b,c,d]=band.map(p=>({x:p.x/sx,y:p.y/sy}));
    const length=Math.hypot((a.x-b.x)*sx,(a.y-b.y)*sy)*metersPerPixel;
    if(length<2.4)continue;
    const meetsPaint=[a,b,c,d].some(p=>{
      const x=Math.round(p.x),y=Math.round(p.y);
      for(let j=y-1;j<=y+1;j++)for(let i=x-1;i<=x+1;i++){
        if(i>=0&&i<width&&j>=0&&j<height&&wallPaintMask[j*width+i])return true;
      }
      return false;
    });
    if(!meetsPaint)continue;
    const steps=Math.ceil(2*Math.hypot(b.x-a.x,b.y-a.y)),across=Math.max(1,Math.ceil(2*Math.hypot(d.x-a.x,d.y-a.y)));
    for(let k=0;k<=steps;k++)for(let j=0;j<=across;j++){
      const x=Math.floor(a.x+(b.x-a.x)*k/steps+(d.x-a.x)*j/across);
      const y=Math.floor(a.y+(b.y-a.y)*k/steps+(d.y-a.y)*j/across);
      if(x>=0&&y>=0&&x<width&&y<height)mask[y*width+x]=1;
    }
  }
  const structural=mask.slice();
  closeDoorGaps(mask,width,height,Math.min(20,Math.ceil(1.65/(Math.min(sx,sy)*metersPerPixel))));
  // A short jamb can turn immediately into a perpendicular wall. Follow
  // at least two pixels into both solid ends before bridging that doorway.
  for(const step of [1,-1,width,-width]){
    const across=Math.abs(step)===1?width:1;
    const limit=Math.min(20,Math.floor(1.65/(metersPerPixel*(Math.abs(step)===1?sx:sy))));
    for(let i=width+2;i<mask.length-width-2;i++){
      if(!structural[i]||structural[i+step]||!structural[i-step])continue;
      if(!structural[i+across]&&!structural[i-across])continue;
      for(let gap=1;gap<=limit;gap++){
        const j=i+(gap+1)*step;
        if(j+step<0||j+step>=mask.length||Math.abs(step)===1&&Math.floor(i/width)!==Math.floor((j+step)/width))break;
        if(!structural[j])continue;
        const returnAtJamb=(structural[j+across]&&structural[j+2*across])||
          (structural[j-across]&&structural[j-2*across]);
        if(returnAtJamb||structural[j+step]&&(structural[j+across]||structural[j-across])){
          for(let k=1;k<=gap;k++)mask[i+k*step]=1;
        }
        break;
      }
    }
  }
  for(const {a,b} of openingSegments){
    const dx=(b.x-a.x)*width,dy=(b.y-a.y)*height,length=Math.hypot(dx,dy);
    if(length<1||Math.hypot(dx*sx,dy*sy)*metersPerPixel>2.5)continue;
    const steps=Math.ceil(2*length);
    for(let k=-2;k<=steps+2;k++){
      const x=Math.floor(a.x*width+dx*k/steps),y=Math.floor(a.y*height+dy*k/steps);
      if(x>=0&&y>=0&&x<width&&y<height)mask[y*width+x]=1;
    }
  }

  const queue=new Int32Array(mask.length),faces=[];
  for(let start=0;start<mask.length;start++){
    if(mask[start])continue;
    let count=1,edge=false,x0=width,x1=0,y0=height,y1=0;
    mask[start]=1;queue[0]=start;
    for(let head=0;head<count;head++){
      const i=queue[head],x=i%width,y=Math.floor(i/width);
      x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      if(x===0||x===width-1||y===0||y===height-1)edge=true;
      for(const j of [x>0?i-1:-1,x+1<width?i+1:-1,i-width,i+width]){
        if(j<0||j>=mask.length||mask[j])continue;
        mask[j]=1;queue[count++]=j;
      }
    }
    const area=count*sx*sy*metersPerPixel**2;
    if(edge||area<2||area>500||count<16)continue;
    const w=x1-x0+1,h=y1-y0+1,tile=new Uint8Array(w*h);
    for(let k=0;k<count;k++){const i=queue[k];tile[(Math.floor(i/width)-y0)*w+i%width-x0]=1;}
    const contours=maskContours(tile,w,h,sx,sy,1);
    const outer=contours.filter(c=>!c.hole);
    if(outer.length!==1||contours.some(c=>c.hole&&polygonArea(c.points)*metersPerPixel**2>.5))continue;
    faces.push(outer[0].points.map(p=>({x:p.x+x0*sx,y:p.y+y0*sy})));
  }
  return faces;
}
