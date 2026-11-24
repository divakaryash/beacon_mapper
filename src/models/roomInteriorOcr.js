import {destinationCategory,isDestinationCaption} from './destinationCategory.js';
import {captionRuns} from './pdfCaptionOcr.js';
import {pointInPolygon} from '../engines/floorGeometry.js';

const W=430,H=200;
const roomWords=/\b(?:room|office|ward|laboratory|lab|pantry|store|theatre|theater|lobby)\b/i;
const drawingNote=/\b(?:cutout|level|sqm|existing|ceiling|typical|dimension)\b/i;

function roomPatch(image,room,dw,dh,angle){
  const points=room.points.map(p=>({x:p.x*image.width/dw,y:p.y*image.height/dh}));
  const cos=Math.cos(angle),sin=Math.sin(angle);
  const xs=points.map(p=>p.x*cos-p.y*sin),ys=points.map(p=>p.x*sin+p.y*cos);
  const left=Math.min(...xs),top=Math.min(...ys),width=Math.max(...xs)-left,height=Math.max(...ys)-top;
  const scale=Math.min(2,(W-8)/width,(H-8)/height);
  const canvas=Object.assign(document.createElement('canvas'),{width:W,height:H}),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,W,H);
  const ox=(W-width*scale)/2-left*scale,oy=(H-height*scale)/2-top*scale;
  ctx.setTransform(scale*cos,scale*sin,-scale*sin,scale*cos,ox,oy);
  ctx.beginPath();
  for(const ring of [room.points,...(room.holes||[])])ring.forEach((p,i)=>{
    const x=p.x*image.width/dw,y=p.y*image.height/dh;
    if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);
    if(i===ring.length-1)ctx.closePath();
  });
  ctx.clip('evenodd');ctx.drawImage(image,0,0);
  return {canvas,locate(x,y){const u=(x-ox)/scale,v=(y-oy)/scale;return {x:(u*cos+v*sin)*dw/image.width,y:(v*cos-u*sin)*dh/image.height};}};
}

export async function recognizeRoomInteriors(imported,result,onProgress){
  const rooms=result.objects.filter(o=>o.type==='room'&&o.category!=='Lift'&&o.metadata?.labelSource!=='Printed storefront caption'&&!destinationCategory(o.name));
  if(!rooms.length)return;
  const {getDocument}=await import('pdfjs-dist');
  const task=getDocument({data:new Uint8Array(await imported.file.arrayBuffer()),isEvalSupported:false});
  let worker,image;
  const best=new Map();
  try{
    const page=await(await task.promise).getPage(1),base=page.getViewport({scale:1});
    const viewport=page.getViewport({scale:Math.min(10,7000/Math.max(base.width,base.height))});
    image=Object.assign(document.createElement('canvas'),{width:Math.ceil(viewport.width),height:Math.ceil(viewport.height)});
    await page.render({canvas:image,viewport,background:'white'}).promise;
    const {createWorker,PSM}=await import('tesseract.js'),assets=new URL('./ocr/',document.baseURI).href;
    worker=await createWorker('eng',1,{workerPath:assets+'worker.min.js',corePath:assets,langPath:assets,workerBlobURL:false});
    await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
    for(let off=0;off<rooms.length;off+=4){
      onProgress?.(`Reading room interiors (${Math.min(off+4,rooms.length)}/${rooms.length})`);
      const patches=[];
      for(const room of rooms.slice(off,off+4)){
        const points=room.points;let angle=0,longest=0;
        points.forEach((p,i)=>{const q=points[(i+1)%points.length],dx=(q.x-p.x)*image.width/imported.drawingWidthPixels,dy=(q.y-p.y)*image.height/imported.drawingHeightPixels;
          if(Math.hypot(dx,dy)>longest){longest=Math.hypot(dx,dy);angle=-Math.atan2(dy,dx);}
        });
        const eighth=Math.round(angle/(Math.PI/4))*Math.PI/4;
        if(Math.abs(eighth-angle)<.06)angle=eighth;
        // In rotated wings CAD text is often still aligned to the sheet.
        const orientations=[angle];
        if(Math.abs(Math.sin(2*angle))>.18)orientations.push(0);
        for(const baseAngle of orientations)for(let k=0;k<4;k++){
          const patch=roomPatch(image,room,imported.drawingWidthPixels,imported.drawingHeightPixels,baseAngle+k*Math.PI/2);
          const runs=captionRuns(patch.canvas.getContext('2d').getImageData(0,0,W,H),2)
            .filter(run=>!run.vertical).sort((a,b)=>b.count-a.count).slice(0,6);
          for(const run of runs)patches.push({...patch,room,run});
        }
      }
      if(!patches.length)continue;
      const rowHeight=46;
      const atlas=Object.assign(document.createElement('canvas'),{width:W*2,height:Math.ceil(patches.length/2)*rowHeight});
      const ctx=atlas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,atlas.width,atlas.height);
      patches.forEach((p,i)=>{
        const r=p.run;p.zoom=Math.min(5,30/(r.h+4),(W-12)/(r.w+4));
        ctx.drawImage(p.canvas,r.x-2,r.y-2,r.w+4,r.h+4,i%2*W+6,Math.floor(i/2)*rowHeight+5,(r.w+4)*p.zoom,(r.h+4)*p.zoom);
      });
      const {data}=await worker.recognize(atlas,{}, {blocks:true});
      for(const block of data.blocks||[])for(const para of block.paragraphs||[])for(const line of para.lines||[]){
        const words=(line.words||[]).filter(w=>w.confidence>=72);
        if(!words.length)continue;
        const box=words[0].bbox,col=Math.floor(box.x0/W),row=Math.floor(box.y0/rowHeight),patch=patches[row*2+col];
        if(!patch||words.some(w=>Math.floor((w.bbox.x1-1)/W)!==col||Math.floor((w.bbox.y1-1)/rowHeight)!==row))continue;
        const name=words.map(w=>w.text.trim()).join(' ').trim(),confidence=Math.min(...words.map(w=>w.confidence));
        const printedCode=confidence>=90&&/^(CR|HOD|OPD)(?:[ -]?\d{1,2})?$/.test(name);
        if(confidence<82||name.length>70||drawingNote.test(name)||(!printedCode&&
          ((!destinationCategory(name)&&!roomWords.test(name))||!/[a-z]{3}/i.test(name)))||/^room$/i.test(name))continue;
        const point=patch.locate(patch.run.x+patch.run.w/2,patch.run.y+patch.run.h/2);
        if(!pointInPolygon(point,patch.room.points)||patch.room.holes?.some(h=>pointInPolygon(point,h)))continue;
        const score=confidence+(destinationCategory(name)?12:0)+(words.length>1?4:0);
        if(score>(best.get(patch.room.id)?.score||0))best.set(patch.room.id,{room:patch.room,name,point,score,evidence:patch.canvas.toDataURL('image/webp',.8)});
      }
    }
  }finally{if(image)image.width=image.height=1;try{await worker?.terminate();}finally{await task.destroy();}}
  for(const {room,name,point,evidence} of best.values()){
    room.name=name;room.metadata={...room.metadata,labelSource:'OCR inside room',needsReview:true,labelCrop:evidence};
    const type=destinationCategory(name);
    for(const p of result.objects)if(p.category==='Room Door'&&p.metadata?.roomId===room.id)p.name=name;
    if(type&&isDestinationCaption(name)&&!result.objects.some(p=>p.type==='poi'&&p.category===type&&p.metadata?.roomId===room.id)){
      result.objects.push({...point,id:'auto-room-label-'+room.id,type:'poi',category:type,name,layerId:'pois',floorId:room.floorId,origin:'automatic',metadata:{coordinateSource:'OCR inside room',roomId:room.id,needsReview:true}});
      result.analysis.detected.labeledLandmarks++;
    }
  }
  result.analysis.roomOcrLabels=best.size;
}
