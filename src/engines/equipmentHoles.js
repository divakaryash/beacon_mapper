import {pointInPolygon} from './floorGeometry.js';
import {polygonArea,polygonPerimeter} from './geometry.js';

// An isolated equipment symbol can leave a narrow, branched cutout in the
// traced floor. Rectangular shafts and columns usually have a compact outline.
export function removeEquipmentHoles(objects,input){
  const {wallPaintMask,width,height,drawingWidth,drawingHeight,metersPerPixel,labels=[]}=input;
  if(!wallPaintMask?.some(Boolean))return;
  const sx=drawingWidth/width,sy=drawingHeight/height;
  const protectedLabels=labels.filter(l=>/\b(?:shaft|void|stair|lift|column|duct|riser|atrium|cutout)\b/i.test(l.text))
    .map(l=>({x:l.x+(l.width||0)/2,y:l.y-(l.height||0)/2}));
  for(const room of objects){
    if(room.type!=='room'||!room.holes?.length)continue;
    const outerArea=polygonArea(room.points);
    room.holes=room.holes.filter(ring=>{
      const area=polygonArea(ring),perimeter=polygonPerimeter(ring);
      if(ring.length<9||area*metersPerPixel**2>8||area>outerArea*.22||
        4*Math.PI*area/perimeter**2>.42)return true;
      if(protectedLabels.some(p=>pointInPolygon(p,ring)))return true;
      if(objects.some(o=>o!==room&&['room','walkableArea'].includes(o.type)&&
        o.points?.some(p=>pointInPolygon(p,ring))))return true;
      const xs=ring.map(p=>p.x/sx),ys=ring.map(p=>p.y/sy);
      const left=Math.max(0,Math.floor(Math.min(...xs))),right=Math.min(width-1,Math.ceil(Math.max(...xs)));
      const top=Math.max(0,Math.floor(Math.min(...ys))),bottom=Math.min(height-1,Math.ceil(Math.max(...ys)));
      for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
        if(wallPaintMask[y*width+x]&&pointInPolygon({x:(x+.5)*sx,y:(y+.5)*sy},ring))return true;
      }
      return false;
    });
  }
}
