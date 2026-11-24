import {closeFootprint,maskContours} from './floorPlanAnalysis.js';
import {pointInPolygon,segmentProjection,selfIntersects} from './floorGeometry.js';
import {polygonArea} from './geometry.js';
import {destinationCategory,hasShopIdentifiers} from '../models/destinationCategory.js';

// An independently rendered page retains fine storefront strokes omitted by
// the furniture filter. Only use enclosures with a positioned unit identifier.
export function printedShopFaces(input){
  const {printedInk,width,height,drawingWidth,drawingHeight,metersPerPixel,labels=[]}=input;
  if(!printedInk||printedInk.length!==width*height)return [];
  const sx=drawingWidth/width,sy=drawingHeight/height;
  const captions=labels.filter(l=>(l.confidence??100)>=78).map(l=>({
    text:l.text,confidence:l.confidence??100,x:l.x+(l.width||0)/2,y:l.y-(l.height||0)/2,width:l.width||0,height:l.height||0
  }));
  const units=captions.filter(l=>destinationCategory(l.text)==='Shop unit');
  const retail=hasShopIdentifiers(labels);
  // Sometimes OCR reads the tenant but misses a merged or comma-separated
  // unit number. A nearby numbered tenant establishes the local caption scale.
  const tenantNames=retail?captions.filter(l=>l.confidence>=90&&l.height>0&&
    /^[a-z][a-z '&.-]{2,}$/i.test(l.text.trim())&&!destinationCategory(l.text)&&
    !/\b(?:corridor|passage|lift|lobby|atrium|shaft|stair|toilet|void|exit|duct|floor|wide)\b/i.test(l.text)&&
    units.some(u=>Math.hypot(u.x-l.x,u.y-l.y)*metersPerPixel<22&&
      l.height/u.height>.65&&l.height/u.height<1.6)):[];
  const anchors=retail?[...units,...tenantNames]:captions.filter(l=>/\b(?:room|store|chillers?|spect|office|workshop|laboratory)\b/i.test(l.text));
  if(!anchors.length)return [];
  const faces=trace(printedInk.slice());
  if(retail){
    if(input.detailedPrint){
      const fine=printedShopFaces({...input,...input.detailedPrint,detailedPrint:undefined,fineScale:true});
      for(const face of fine){
        if(!faces.some(f=>pointInPolygon(face.caption,f.points)||pointInPolygon(f.caption,face.points)))
          faces.push({...face,detailed:true});
      }
    }
    return faces;
  }
  // Downsampling can open one- or two-pixel gaps in a plotted partition.
  // Retry only missing captions and retain the original closed faces.
  const missing=anchors.filter(anchor=>!faces.some(face=>pointInPolygon(anchor,face.points)));
  if(missing.length){
    for(const face of trace(closeFootprint(printedInk,width,height,1))){
      if(missing.includes(face.caption)&&!faces.some(f=>pointInPolygon(f.caption,face.points)))faces.push(face);
    }
  }
  return faces;

  function trace(mask){
    const queue=new Int32Array(mask.length),faces=[];
    for(let i=0;i<mask.length;i++){
      if(mask[i])continue;
      let count=1,left=width,right=0,top=height,bottom=0;
      queue[0]=i;mask[i]=1;
      for(let k=0;k<count;k++){
        const cell=queue[k],x=cell%width,y=Math.floor(cell/width);
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        for(const j of [x?cell-1:-1,x+1<width?cell+1:-1,cell-width,cell+width]){
          if(j>=0&&j<mask.length&&!mask[j]){mask[j]=1;queue[count++]=j;}
        }
      }
      if(!left||!top||right===width-1||bottom===height-1||count*sx*sy*metersPerPixel**2<8)continue;
      const w=right-left+1,h=bottom-top+1;
      if(count<w*h*.35||!anchors.some(l=>l.x>=left*sx&&l.x<(right+1)*sx&&l.y>=top*sy&&l.y<(bottom+1)*sy))continue;
      const tile=new Uint8Array(w*h);
      for(let k=0;k<count;k++){const cell=queue[k];tile[(Math.floor(cell/width)-top)*w+cell%width-left]=1;}
      const outer=maskContours(tile,w,h,sx,sy,1).find(c=>!c.hole);
      if(!outer)continue;
      const points=outer.points.map(p=>({x:p.x+left*sx,y:p.y+top*sy}));
      // A glyph touching a wall can produce a long notch through the shop name.
      // Keep the structural detector's outline when this second pass follows ink
      // through the central portion of a printed caption.
      const cutsCaption=captions.some(l=>{
        if(!l.width||!l.height||l.x<left*sx||l.x>(right+1)*sx||l.y<top*sy||l.y>(bottom+1)*sy)return false;
        const relative=p=>({x:(p.x-l.x)/l.width,y:(p.y-l.y)/l.height});
        return points.some((p,i)=>segmentProjection({x:0,y:0},relative(p),relative(points[(i+1)%points.length])).distance<.35);
      });
      if(retail&&cutsCaption)continue;
      const inside=captions.filter(l=>pointInPolygon(l,points));
      if(!retail){
        const names=inside.filter(l=>anchors.includes(l)&&points.every((a,i)=>
          segmentProjection(l,a,points[(i+1)%points.length]).distance*metersPerPixel>.22));
        if(!names.length||new Set(names.map(l=>l.text.trim().toUpperCase())).size>1||
          count<w*h*.65||w*h*sx*sy*metersPerPixel**2>120||
          inside.some(l=>/\b(?:corridor|lobby|passage|atrium)\b/i.test(l.text)))continue;
        faces.push({points,caption:names[0]});
        continue;
      }
      const identifiers=inside.filter(l=>units.includes(l));
      // For concave stalls the enclosing box includes part of the neighbor.
      // Measure the connected interior against its own traced footprint.
      const filledEnclosure=input.fineScale&&inside.length===1&&
        count*sx*sy>=.72*polygonArea(points)&&
        points.every((p,i)=>segmentProjection(inside[0],p,points[(i+1)%points.length]).distance*metersPerPixel>.35);
      if(filledEnclosure&&identifiers.length===1&&identifiers[0].confidence>=85){
        faces.push({points,caption:identifiers[0]});
        continue;
      }
      if(!identifiers.length&&inside.length===1&&tenantNames.includes(inside[0])&&(count>=w*h*.48||filledEnclosure)){
        faces.push({points,caption:{...inside[0],tenant:true}});
        continue;
      }
      if(identifiers.length!==1||!inside.some(l=>!units.includes(l)&&/[a-z]{3}/i.test(l.text))||
        inside.some(l=>/\b(?:corridor|lobby|passage|atrium)\b/i.test(l.text)))continue;
      faces.push({points,caption:identifiers[0]});
    }
    return faces;
  }
}

// A caption touching a partition leaves a sawtooth detour in the raster ring.
// Bridge it only when a single PDF stroke underlies the entire replacement.
export function straightenPrintedFaces(faces,nearby,scale){
  for(const face of faces){
    const ring=face.points;
    if(ring.length<8)continue;
    for(let i=0;i<ring.length;i++){
      const start=ring[i];
      const lines=[...nearby(start,start,.2/scale)].filter(l=>l.len*scale>1.5&&
        segmentProjection(start,l.a,l.b).distance*scale<.16);
      for(const line of lines){
        let length=0,last=start,best=0;
        for(let j=1;j<ring.length-2;j++){
          const end=ring[(i+j)%ring.length],distance=segmentProjection(end,line.a,line.b).distance*scale;
          if(distance>1.45)break;
          length+=Math.hypot(last.x-end.x,last.y-end.y);
          last=end;
          const chord=Math.hypot(start.x-end.x,start.y-end.y);
          if(j>=4&&distance<.16&&chord*scale>1.5&&length>1.12*chord)best=j;
        }
        if(!best)continue;
        const next=Array.from({length:ring.length-best+1},(_,k)=>ring[(i+best+k)%ring.length]);
        const gain=polygonArea(next)-polygonArea(ring);
        if(gain<=0||gain>polygonArea(ring)*.12||selfIntersects(next)||!pointInPolygon(face.caption,next))continue;
        face.points=next;
        break;
      }
      if(face.points!==ring)break;
    }
  }
}
