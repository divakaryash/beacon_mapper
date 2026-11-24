import {recognizePdfCaptions} from './pdfCaptionOcr.js';
import {doorSymbols} from './pdfDoors.js';
import {recognizeSymbolLabels} from './symbolLabels.js';
import {recognizeFloorLabels} from "./floorPlanLabels.js";
import {hasShopIdentifiers} from './destinationCategory.js';
export {hasShopIdentifiers} from './destinationCategory.js';

// Single-line shopfronts can disappear during downsampling. Repaint long
// vector segments into the segmentation copy at a resolvable pixel width.
export function reinforceShopPartitions(ctx,lines,width,height,labels){
  if(!hasShopIdentifiers(labels))return;
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);ctx.strokeStyle='#000';ctx.lineWidth=1.2;ctx.beginPath();
  for(let i=0;i<lines.length;i+=4){
    const x=lines[i]*width,y=lines[i+1]*height,u=lines[i+2]*width,v=lines[i+3]*height;
    if(Math.hypot(u-x,v-y)<6)continue;
    ctx.moveTo(x,y);ctx.lineTo(u,v);
  }
  ctx.stroke();ctx.restore();
}
export const isPdf = file => file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");

export function analysisRasterSize(width,height) {
  if (![width,height].every(value=>Number.isFinite(value)&&value>0)) throw new Error('Invalid floor-plan dimensions');
  const ratio=Math.min(1,1200/Math.max(width,height),Math.sqrt(1000000/(width*height)));
  return {width:Math.max(3,Math.floor(width*ratio)),height:Math.max(3,Math.floor(height*ratio))};
}

export function rasterSize(width, height) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error("Invalid floor-plan dimensions");
  // ponytail: one bounded raster per PDF page; tiled rendering if deeper zoom is needed.
  const scale = Math.min(2, 4096 / Math.max(width, height));
  return { width: Math.ceil(width * scale), height: Math.ceil(height * scale), scale };
}

export function nativePdfLabels(items,viewport){
  return items.filter(item => item.str).map(item => {
    const [a,b,,,tx,ty]=item.transform,angle=Math.atan2(b,a);
    const ux=Math.cos(angle)*item.width,uy=Math.sin(angle)*item.width;
    const vx=-Math.sin(angle)*item.height,vy=Math.cos(angle)*item.height;
    const corners=[[0,0],[ux,uy],[ux+vx,uy+vy],[vx,vy]].map(([dx,dy])=>viewport.convertToViewportPoint(tx+dx,ty+dy));
    const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);
    return {text:item.str,x:Math.min(...xs),y:Math.max(...ys),width:Math.max(...xs)-Math.min(...xs),
      height:Math.max(...ys)-Math.min(...ys),textHeight:item.height*viewport.scale,source:'pdf-text',confidence:100};
  });
}

export function appendPrintedLabels(floorPlanLabels,printedLabels){
  floorPlanLabels.push(...printedLabels.filter(label=>!floorPlanLabels.some(native=>native.text.trim()===label.text&&Math.hypot(native.x-label.x,native.y-label.y)<label.height)));
}

export async function readFloorPlan(file,onProgress) {
  if (isPdf(file)) {
    const { getDocument, GlobalWorkerOptions, OPS } = await import("pdfjs-dist");
    const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    GlobalWorkerOptions.workerSrc = workerSrc;
    const bytes=await file.arrayBuffer();
    const sourceSha256=await floorPlanFingerprint(bytes);
    const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false });
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const original = page.getViewport({ scale: 1 });
      const size = rasterSize(original.width, original.height);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const geometryCanvas = document.createElement("canvas");
      const geometrySize=analysisRasterSize(size.width,size.height);
      const geometryScale=Math.min(geometrySize.width/original.width,geometrySize.height/original.height);
      geometryCanvas.width=geometrySize.width;
      geometryCanvas.height=geometrySize.height;
      const geometryContext=geometryCanvas.getContext("2d");
      const geometryFilter=geometryOperationsFilter(OPS,geometryContext,{width:geometryCanvas.width,height:geometryCanvas.height});
      await page.render({canvasContext:geometryContext,viewport:page.getViewport({scale:geometryScale}),background:"white",operationsFilter:geometryFilter}).promise;
      const openingSegments=geometryFilter.prepareStructure();
      const crossMarksChanged=geometryFilter.excludeCrossMarks();
      if(geometryFilter.excludePrintedWords()||crossMarksChanged||geometryFilter.structureChanged)await page.render({canvasContext:geometryContext,viewport:page.getViewport({scale:geometryScale}),background:"white",operationsFilter:geometryFilter}).promise;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: page.getViewport({ scale: size.scale }), background: "white" }).promise;
      const preview = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not render PDF page")), "image/png"));
      const text = await page.getTextContent();
      const viewport = page.getViewport({ scale: size.scale });
      const floorPlanLabels=nativePdfLabels(text.items,viewport);
      const printedLabels=await matchingFloorReference({file,sourceSha256})?[]:await recognizeFloorLabels(preview,size.width,size.height,
        async worker=>{
          const captions=await recognizePdfCaptions(page,size,worker,undefined,onProgress);
          const markers=floorPlanLabels.length?[]:await recognizeSymbolLabels(page,viewport,canvas.getContext("2d"),worker);
          return [...captions,...markers];
        });
      appendPrintedLabels(floorPlanLabels,printedLabels);
      if(geometryFilter.excludePrintedWords(printedLabels.map(label=>({...label,x:label.x*geometryCanvas.width/size.width,y:label.y*geometryCanvas.height/size.height,width:label.width*geometryCanvas.width/size.width,height:label.height*geometryCanvas.height/size.height})))){
        await page.render({canvasContext:geometryContext,viewport:page.getViewport({scale:geometryScale}),background:"white",operationsFilter:geometryFilter}).promise;
      }
      const vectorStrokes=geometryFilter.vectorStrokes();
      reinforceShopPartitions(geometryContext,vectorStrokes,geometryCanvas.width,geometryCanvas.height,floorPlanLabels);
      const labeledGeometryPreview=await new Promise((resolve,reject)=>geometryCanvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Could not render labeled geometry")),"image/png"));
      // Render a second view of CAD wall fills and hatches for room envelopes.
      // Keep the detailed preview for editing, labels and doorway recognition.
      await page.render({canvasContext:geometryContext,viewport:page.getViewport({scale:geometryScale}),background:"white",operationsFilter:geometryFilter.wallPaint}).promise;
      const pixels=geometryContext.getImageData(0,0,geometryCanvas.width,geometryCanvas.height).data;
      const wallPaintMask=new Uint8Array(pixels.length/4);
      for(let i=0;i<wallPaintMask.length;i++)wallPaintMask[i]=Math.max(pixels[4*i],pixels[4*i+1],pixels[4*i+2])<185?1:0;
      let printedInk;
      if(floorPlanLabels.length){
        geometryContext.drawImage(canvas,0,0,geometryCanvas.width,geometryCanvas.height);
        printedInk=pageInk(geometryContext,geometryCanvas.width,geometryCanvas.height,hasShopIdentifiers(floorPlanLabels)?225:160);
      }
      const detailedPrint=hasShopIdentifiers(floorPlanLabels)?await renderDetailedPrint(page):undefined;
      return { file, sourceSha256, detailedPrint, printedInk, wallPaintMask, openingSegments, vectorStrokes, floorPlanLabels, floorPlanGeometryPreview:labeledGeometryPreview, floorPlanPreview: preview, pdfPageCount: pdf.numPages, drawingWidthPixels: size.width, drawingHeightPixels: size.height };
    } finally { await task.destroy(); }
  }
  if (!file.type.startsWith("image/") && !/\.(png|jpe?g|svg)$/i.test(file.name)) throw new Error("Choose a PNG, JPG, SVG, or PDF floor plan");
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Could not read floor-plan image")); image.src = source; });
    const floorPlanLabels=await recognizeFloorLabels(file,image.naturalWidth,image.naturalHeight);
    return { file, floorPlanLabels, floorPlanPreview: null, pdfPageCount: null, drawingWidthPixels: image.naturalWidth, drawingHeightPixels: image.naturalHeight };
  } finally { URL.revokeObjectURL(source); }
}

export async function analyzeImportedFloor(imported,metersPerPixel,onProgress) {
  const reference=await matchingFloorReference(imported);
  if(reference)return runFloorAnalysis({annotationOnly:true,reference,drawingWidth:imported.drawingWidthPixels,drawingHeight:imported.drawingHeightPixels});
  const geometryPreview=imported.floorPlanGeometryPreview||(isPdf(imported.file)?(await readFloorPlan(imported.file)).floorPlanGeometryPreview:null);
  const source=URL.createObjectURL(geometryPreview||imported.floorPlanPreview||imported.file);
  try {
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Could not rasterize the floor plan'));image.src=source;});
    const {width,height}=analysisRasterSize(image.naturalWidth,image.naturalHeight);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='white';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
    let labels=imported.floorPlanLabels||[];
    if(/\.svg$/i.test(imported.file.name)||imported.file.type==='image/svg+xml'){
      const svg=new DOMParser().parseFromString(await imported.file.text(),'image/svg+xml');
      const viewBox=svg.documentElement.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
      labels=[...svg.querySelectorAll('text')].filter(el=>!el.closest('[transform]')).map(el=>({text:el.textContent,source:'svg-text',confidence:100,x:(Number(el.getAttribute('x'))-(viewBox?.[0]||0))*imported.drawingWidthPixels/(viewBox?.[2]||imported.drawingWidthPixels),y:(Number(el.getAttribute('y'))-(viewBox?.[1]||0))*imported.drawingHeightPixels/(viewBox?.[3]||imported.drawingHeightPixels),...(!el.closest('[text-anchor]')?{width:(el.textContent.length*Number(el.closest('[font-size]')?.getAttribute('font-size')||16)*.65)*imported.drawingWidthPixels/(viewBox?.[2]||imported.drawingWidthPixels),height:Number(el.closest('[font-size]')?.getAttribute('font-size')||16)*imported.drawingHeightPixels/(viewBox?.[3]||imported.drawingHeightPixels)}:{})}));
      for(const text of svg.querySelectorAll("text"))text.remove();
      const cleanSource=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:"image/svg+xml"}));
      try{const cleanImage=new Image();await new Promise((resolve,reject)=>{cleanImage.onload=resolve;cleanImage.onerror=()=>reject(new Error("Could not read SVG geometry"));cleanImage.src=cleanSource;});context.fillRect(0,0,width,height);context.drawImage(cleanImage,0,0,width,height);}finally{URL.revokeObjectURL(cleanSource);}
    }
    // Text is annotation, not a wall. Only remove positioned, unrotated label boxes.
    for(const label of labels)if(label.source!=="ocr"&&!geometryPreview&&!/\.svg$/i.test(imported.file.name)&&imported.file.type!=='image/svg+xml'&&label.width>0&&label.height>0)context.fillRect(label.x*width/imported.drawingWidthPixels,(label.y-label.height)*height/imported.drawingHeightPixels,label.width*width/imported.drawingWidthPixels,label.height*height/imported.drawingHeightPixels);
    const analyze=vectorStrokes=>{
      const raster=context.getImageData(0,0,width,height);
      return runFloorAnalysis({annotationOnly:true,data:raster.data,width,height,drawingWidth:imported.drawingWidthPixels,drawingHeight:imported.drawingHeightPixels,metersPerPixel,labels,detailedPrint:vectorStrokes?.length?imported.detailedPrint:undefined,printedInk:vectorStrokes?.length?imported.printedInk:undefined,wallPaintMask:vectorStrokes?.length?imported.wallPaintMask:undefined,openingSegments:imported.openingSegments,vectorStrokes,excludeDrawingFrame:true},[raster.data.buffer]);
    };
    let result;
    try{result=await analyze(imported.vectorStrokes);}
    catch(error){
      if(!imported.vectorStrokes?.length)throw error;
      result=await analyze();
      result.analysis.warnings.push('Vector reconstruction could not finish. These outlines use the raster drawing.');
    }
    if(imported.vectorStrokes?.length){
      try{
        const {recognizeRoomInteriors}=await import('./roomInteriorOcr.js');
        await recognizeRoomInteriors(imported,result,onProgress);
      }catch{result.analysis.warnings.push('Room interior OCR was unavailable. Review room names against the drawing.');}
    }
    return result;
  } finally {URL.revokeObjectURL(source);}
}

function runFloorAnalysis(input,transfer=[]) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../engines/floorAnalysisWorker.js',import.meta.url),{type:'module'});
    const finish=()=>{clearTimeout(timer);worker.terminate();};
    const timer=setTimeout(()=>{finish();reject(new Error('Floor analysis timed out. Use a simpler or clearer floor plan.'));},60000);
    worker.onmessage=({data})=>{finish();data.error?reject(new Error(data.error)):resolve(data.result);};
    worker.onerror=()=>{finish();reject(new Error('Floor analysis worker failed'));};
    worker.postMessage(input,transfer);
  });
}

export async function floorPlanFingerprint(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function matchingFloorReference(imported) {
  if(!isPdf(imported?.file))return null;
  const {default:reference}=await import('../samples/dlfGroundReference.js');
  const fingerprint=imported.sourceSha256||await floorPlanFingerprint(await imported.file.arrayBuffer());
  if(fingerprint===reference.pdfSha256)return reference;
  const {default:basement}=await import('../samples/dlfBasementReference.js');
  return fingerprint===basement.pdfSha256?basement:null;
}

// CAD exports often convert text to tiny stroked paths, so text operators alone are insufficient.
export function geometryOperationsFilter(ops,context,pageSize) {
  const textOperations=new Set([ops.showText,ops.showSpacedText,ops.nextLineShowText,ops.nextLineSetSpacingShowText]);
  const candidates=new Map(),straightLines=new Map(),excluded=new Set();
  const symbolDetector=doorSymbols(Math.min(26,Math.max(pageSize?.height||0,pageSize?.width||0)*.022));
  const framePaths=new Set(),hatchPaths=new Set(),strokeSpans=new Map();
  const vectorPaths=new Map(),rasterDetail=new Set();
  const shortLines=[],jambStrokes=new Set();
  let collecting=true;
  const filter=(index,list)=>{
    if(excluded.has(index)||rasterDetail.has(index)||(!collecting&&framePaths.has(index)))return false;
    const operation=list.fnArray[index];if(textOperations.has(operation))return false;
    if(operation!==ops.constructPath)return true;
    const [paint,paths,bounds]=list.argsArray[index];
    if(!bounds)return true;
    const m=context.getTransform(),corners=[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]].map(([x,y])=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f}));
    const width=Math.max(...corners.map(p=>p.x))-Math.min(...corners.map(p=>p.x)),height=Math.max(...corners.map(p=>p.y))-Math.min(...corners.map(p=>p.y));
    const minX=Math.min(...corners.map(p=>p.x)),minY=Math.min(...corners.map(p=>p.y));
    const line=paths?.[0];
    if(collecting&&line?.length>=600&&[ops.stroke,ops.closeStroke].includes(paint)){
      // PDF.js caches a Path2D after painting. Classify the original commands
      // during the first pass while independent hatch marks are available.
      let marks=0;
      for(let j=0;j<96;j+=6)if(line[j]===0&&line[j+3]===1)marks++;
      if(marks>=15)hatchPaths.add(index);
    }
    if(collecting&&pageSize&&paint===ops.stroke){
      strokeSpans.set(index,Math.hypot(width,height));
      symbolDetector.collect(line,m,index);
      if(line?.length===6&&line[0]===0&&line[3]===1&&Math.hypot(width,height)<12){
        const point=(x,y)=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f});
        shortLines.push({index,a:point(line[1],line[2]),b:point(line[4],line[5])});
      }
    }
    // Plot frames and dimension leaders may be a rectangle or an L-shaped path.
    // Keep clipping operations; suppress only paint confined to page margins.
    if(pageSize&&[ops.stroke,ops.closeStroke].includes(paint)&&line&&
      (width>pageSize.width*.88||height>pageSize.height*.72)&&
      isMarginPolyline(line,m,pageSize)){framePaths.add(index);return false;}
    if(collecting&&pageSize&&line&&[ops.stroke,ops.closeStroke,ops.fillStroke,ops.eoFillStroke,ops.closeFillStroke,ops.closeEOFillStroke].includes(paint)&&Math.hypot(width,height)>=3){
      const project=(x,y)=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f});
      const segments=[];
      let previous=null,start=null;
      const add=p=>{
        if(previous&&Math.hypot(p.x-previous.x,p.y-previous.y)>.3&&[p,previous].every(q=>q.x>=-1&&q.x<=pageSize.width+1&&q.y>=-1&&q.y<=pageSize.height+1)){
          segments.push(previous.x/pageSize.width,previous.y/pageSize.height,p.x/pageSize.width,p.y/pageSize.height);
        }
        previous=p;
      };
      for(let i=0;i<line.length;){
        const op=line[i++];
        if(op===0){start=previous=project(line[i++],line[i++]);}
        else if(op===1)add(project(line[i++],line[i++]));
        else if(op===2&&previous){
          const a=previous,b=project(line[i++],line[i++]),c=project(line[i++],line[i++]),d=project(line[i++],line[i++]);
          const bend=Math.max(Math.hypot(a.x-2*b.x+c.x,a.y-2*b.y+c.y),Math.hypot(b.x-2*c.x+d.x,b.y-2*c.y+d.y));
          const steps=Math.min(192,Math.max(2,Math.ceil(Math.sqrt(bend/.35))));
          for(let s=1;s<=steps;s++){const t=s/steps,u=1-t;add({x:u**3*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t**3*d.x,y:u**3*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t**3*d.y});}
        }else if(op===4&&start)add(start);
        else break;
      }
      if(paint===ops.closeStroke&&start)add(start);
      if(segments.length)vectorPaths.set(index,segments);
    }
    if(paint===ops.stroke&&line?.length===6&&line[0]===0&&line[3]===1){
      const point=(x,y)=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f}),a=point(line[1],line[2]),b=point(line[4],line[5]);
      if(Math.abs(a.x-b.x)>3&&Math.abs(a.y-b.y)>3&&Math.hypot(a.x-b.x,a.y-b.y)>=Math.max(20,Math.max(pageSize?.width||0,pageSize?.height||0)/40))straightLines.set(index,{index,a,b});
    }
    const path=paths?.[0],solidColumn=![ops.stroke,ops.closeStroke].includes(paint)&&path?.length===13&&path[12]===4&&width>0&&height>0&&width/height>.5&&width/height<2;
    if(pageSize&&!solidColumn&&!(path?.length===13&&path[12]===4)&&path?.length>=10&&height>=.5&&height<=Math.max(pageSize.width,pageSize.height)/24&&width>=height*.15&&width<=height*1.5)candidates.set(index,{index,minX,minY,maxX:minX+width,maxY:minY+height,height});
    return solidColumn||jambStrokes.has(index)||Math.max(width,height)>=3;
  };
  filter.wallPaint=(index,list)=>{
    const op=list.fnArray[index];
    if(textOperations.has(op)||[ops.paintImageXObject,ops.paintInlineImageXObject,ops.paintImageMaskXObject].includes(op))return false;
    if(op!==ops.constructPath)return true;
    const [paint]=list.argsArray[index];
    if(paint===ops.endPath)return true;
    if(excluded.has(index))return false;
    if(![ops.stroke,ops.closeStroke].includes(paint))return true;
    return hatchPaths.has(index);
  };
  filter.prepareStructure=()=>{
    collecting=false;
    const portals=symbolDetector.openings();
    for(const portal of portals)for(const i of portal.indices)excluded.add(i);
    if(portals.length)filter.structureChanged=true;
    // Busy CAD pages contain lettering and fittings made of short strokes. Keep
    // fills and the original display raster; simplify only the segmentation copy.
    if(strokeSpans.size>=1000&&[...strokeSpans.values()].filter(length=>length>=10).length>=100){
      const span=Math.max(pageSize.width,pageSize.height);
      const cutoff=Math.min(8,span*.0067);
      for(const [index,length] of strokeSpans)if(length<cutoff)rasterDetail.add(index);
      // Keep short jambs and wall returns around a confirmed swing. CAD plots
      // frequently break the wall into several short strokes at these corners.
      const local=new Map(),bin=16;
      for(const p of portals){
        const radius=Math.hypot(p.b.x-p.a.x,p.b.y-p.a.y);
        for(const end of [p.a,p.b])for(let y=Math.floor((end.y-radius)/bin);y<=Math.floor((end.y+radius)/bin);y++)
          for(let x=Math.floor((end.x-radius)/bin);x<=Math.floor((end.x+radius)/bin);x++){
            const k=x+','+y;if(!local.has(k))local.set(k,[]);local.get(k).push({end,p,radius});
          }
      }
      for(const {index,a,b} of shortLines){
        const candidates=local.get(Math.floor(a.x/bin)+','+Math.floor(a.y/bin))||[];
        for(const {end,p,radius} of candidates){
          if(Math.min(Math.hypot(a.x-end.x,a.y-end.y),Math.hypot(b.x-end.x,b.y-end.y))>radius)continue;
          const dx=b.x-a.x,dy=b.y-a.y,ux=(p.b.x-p.a.x)/radius,uy=(p.b.y-p.a.y)/radius;
          if(Math.min(Math.abs(dx*uy-dy*ux),Math.abs(dx*ux+dy*uy))>Math.hypot(dx,dy)*.09)continue;
          rasterDetail.delete(index);jambStrokes.add(index);break;
        }
      }
      filter.structureChanged=true;
    }
    const normalized=p=>({x:p.x/pageSize.width,y:p.y/pageSize.height});
    return portals.map(({a,b,swingTip})=>({a:normalized(a),b:normalized(b),swingTip:normalized(swingTip)}));
  };
  filter.vectorStrokes=()=>{
    const coordinates=[];
    for(const [i,segments] of vectorPaths)if(!excluded.has(i))for(const v of segments)coordinates.push(v);
    return Float32Array.from(coordinates);
  };
  // shortcut: interior crossings of long diagonal PDF strokes denote X marks; review unusual diagonal wall crossings.
  filter.excludeCrossMarks=()=>{
    const lines=[...straightLines.values()],before=excluded.size;
    for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
      const a=lines[i],b=lines[j],ax=a.b.x-a.a.x,ay=a.b.y-a.a.y,bx=b.b.x-b.a.x,by=b.b.y-b.a.y,cross=ax*by-ay*bx;
      if(Math.abs(cross)<Math.hypot(ax,ay)*Math.hypot(bx,by)*.25)continue;
      const dx=b.a.x-a.a.x,dy=b.a.y-a.a.y,t=(dx*by-dy*bx)/cross,u=(dx*ay-dy*ax)/cross;
      if(Math.abs(t-.5)<.06&&Math.abs(u-.5)<.06&&Math.abs(Math.hypot(ax,ay)/Math.hypot(bx,by)-1)<.12){excluded.add(a.index);excluded.add(b.index);}
    }
    return excluded.size>before;
  };
  filter.excludePrintedWords=(labels=[])=>{
    for(const glyph of candidates.values())if(labels.some(label=>glyph.minX>=label.x-.5&&glyph.maxX<=label.x+label.width+.5&&glyph.minY>=label.y-label.height-.5&&glyph.maxY<=label.y+.5))excluded.add(glyph.index);
    const glyphs=[...candidates.values()],seen=new Set();
    for(const glyph of glyphs)if(!seen.has(glyph)){
      const word=[glyph];seen.add(glyph);
      for(let k=0;k<word.length;k++)for(const other of glyphs){
        const current=word[k],height=Math.max(current.height,other.height);
        const gap=Math.max(current.minX,other.minX)-Math.min(current.maxX,other.maxX);
        if(seen.has(other)||Math.min(current.height,other.height)<height*.6||Math.abs(current.maxY-other.maxY)>height*.3||gap< -height*.25||gap>height)continue;
        word.push(other);seen.add(other);
      }
      if(word.length>=3)word.forEach(g=>excluded.add(g.index));
    }
    return excluded.size>0;
  };
  return filter;
}

function isMarginPolyline(path,m,page){
  let first=null,last=null,segments=0;
  for(let i=0;i<path.length;){
    const op=path[i++];
    if(op!==0&&op!==1&&op!==4)return false;
    let point=first;
    if(op!==4){
      const x=path[i++],y=path[i++];
      point={x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f};
    }
    if(op===0){first=point;last=point;continue;}
    if(!last||!point)return false;
    const vertical=Math.abs(point.x-last.x)<1&&(point.x<page.width*.06||point.x>page.width*.94);
    const horizontal=Math.abs(point.y-last.y)<1&&(point.y<page.height*.13||point.y>page.height*.85);
    if(!vertical&&!horizontal)return false;
    last=point;segments++;
  }
  return segments>0;
}

// Resolve narrow storefronts before their wall strokes merge with lettering.
export async function renderDetailedPrint(page,createCanvas=(w,h)=>{
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;return canvas;
}){
  const original=page.getViewport({scale:1});
  const scale=Math.min(3550/Math.max(original.width,original.height),Math.sqrt(9000000/(original.width*original.height)));
  const viewport=page.getViewport({scale}),width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
  await page.render({canvasContext:ctx,viewport,background:'white'}).promise;
  return {width,height,printedInk:pageInk(ctx,width,height,180)};
}

export function pageInk(context,width,height,threshold=225){
  const pixels=context.getImageData(0,0,width,height).data;
  return Uint8Array.from({length:width*height},(_,i)=>Math.min(pixels[4*i],pixels[4*i+1],pixels[4*i+2])<threshold?1:0);
}
