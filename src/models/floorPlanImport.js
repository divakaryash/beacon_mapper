import {recognizeFloorLabels} from "./floorPlanLabels.js";
export const isPdf = file => file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");

export function rasterSize(width, height) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error("Invalid floor-plan dimensions");
  // ponytail: one bounded raster per PDF page; tiled rendering if deeper zoom is needed.
  const scale = Math.min(2, 4096 / Math.max(width, height));
  return { width: Math.ceil(width * scale), height: Math.ceil(height * scale), scale };
}

export async function readFloorPlan(file) {
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
      const geometryScale = Math.min(size.scale,512/Math.max(original.width,original.height));
      geometryCanvas.width=Math.ceil(original.width*geometryScale);
      geometryCanvas.height=Math.ceil(original.height*geometryScale);
      const geometryContext=geometryCanvas.getContext("2d");
      const geometryFilter=geometryOperationsFilter(OPS,geometryContext,{width:geometryCanvas.width,height:geometryCanvas.height});
      await page.render({canvasContext:geometryContext,viewport:page.getViewport({scale:geometryScale}),background:"white",operationsFilter:geometryFilter}).promise;
      if(geometryFilter.excludePrintedWords())await page.render({canvasContext:geometryContext,viewport:page.getViewport({scale:geometryScale}),background:"white",operationsFilter:geometryFilter}).promise;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: page.getViewport({ scale: size.scale }), background: "white" }).promise;
      const preview = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not render PDF page")), "image/png"));
      const text = await page.getTextContent();
      const viewport = page.getViewport({ scale: size.scale });
      const floorPlanLabels = text.items.filter(item => item.str).map(item => {
        const [x,y] = viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
        return {text:item.str,x,y,source:"pdf-text",confidence:100,...(Math.abs(item.transform[1])<.001?{width:item.width*size.scale,height:item.height*size.scale}: {})};
      });
      const printedLabels=await matchingFloorReference({file,sourceSha256})?[]:await recognizeFloorLabels(preview,size.width,size.height);
      floorPlanLabels.push(...printedLabels.filter(label=>!floorPlanLabels.some(native=>native.text.trim()===label.text&&Math.hypot(native.x-label.x,native.y-label.y)<label.height)));
      if(geometryFilter.excludePrintedWords(printedLabels.map(label=>({...label,x:label.x*geometryCanvas.width/size.width,y:label.y*geometryCanvas.height/size.height,width:label.width*geometryCanvas.width/size.width,height:label.height*geometryCanvas.height/size.height})))){
        await page.render({canvasContext:geometryContext,viewport:page.getViewport({scale:geometryScale}),background:"white",operationsFilter:geometryFilter}).promise;
      }
      const labeledGeometryPreview=await new Promise((resolve,reject)=>geometryCanvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Could not render labeled geometry")),"image/png"));
      return { file, sourceSha256, floorPlanLabels, floorPlanGeometryPreview:labeledGeometryPreview, floorPlanPreview: preview, pdfPageCount: pdf.numPages, drawingWidthPixels: size.width, drawingHeightPixels: size.height };
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

export async function analyzeImportedFloor(imported,metersPerPixel) {
  const reference=await matchingFloorReference(imported);
  if(reference)return runFloorAnalysis({reference,drawingWidth:imported.drawingWidthPixels,drawingHeight:imported.drawingHeightPixels});
  const geometryPreview=imported.floorPlanGeometryPreview||(isPdf(imported.file)?(await readFloorPlan(imported.file)).floorPlanGeometryPreview:null);
  const source=URL.createObjectURL(geometryPreview||imported.floorPlanPreview||imported.file);
  try {
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Could not rasterize the floor plan'));image.src=source;});
    const ratio=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight)),width=Math.max(3,Math.round(image.naturalWidth*ratio)),height=Math.max(3,Math.round(image.naturalHeight*ratio));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='white';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
    let labels=imported.floorPlanLabels||[];
    if(/\.svg$/i.test(imported.file.name)||imported.file.type==='image/svg+xml'){
      const svg=new DOMParser().parseFromString(await imported.file.text(),'image/svg+xml');
      const viewBox=svg.documentElement.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
      labels=[...svg.querySelectorAll('text')].filter(el=>!el.closest('[transform]')).map(el=>({text:el.textContent,x:(Number(el.getAttribute('x'))-(viewBox?.[0]||0))*imported.drawingWidthPixels/(viewBox?.[2]||imported.drawingWidthPixels),y:(Number(el.getAttribute('y'))-(viewBox?.[1]||0))*imported.drawingHeightPixels/(viewBox?.[3]||imported.drawingHeightPixels),...(!el.closest('[text-anchor]')?{width:(el.textContent.length*Number(el.closest('[font-size]')?.getAttribute('font-size')||16)*.65)*imported.drawingWidthPixels/(viewBox?.[2]||imported.drawingWidthPixels),height:Number(el.closest('[font-size]')?.getAttribute('font-size')||16)*imported.drawingHeightPixels/(viewBox?.[3]||imported.drawingHeightPixels)}:{})}));
      for(const text of svg.querySelectorAll("text"))text.remove();
      const cleanSource=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:"image/svg+xml"}));
      try{const cleanImage=new Image();await new Promise((resolve,reject)=>{cleanImage.onload=resolve;cleanImage.onerror=()=>reject(new Error("Could not read SVG geometry"));cleanImage.src=cleanSource;});context.fillRect(0,0,width,height);context.drawImage(cleanImage,0,0,width,height);}finally{URL.revokeObjectURL(cleanSource);}
    }
    // Text is annotation, not a wall. Only remove positioned, unrotated label boxes.
    for(const label of labels)if(label.source!=="ocr"&&!geometryPreview&&!/\.svg$/i.test(imported.file.name)&&imported.file.type!=='image/svg+xml'&&label.width>0&&label.height>0)context.fillRect(label.x*width/imported.drawingWidthPixels,(label.y-label.height)*height/imported.drawingHeightPixels,label.width*width/imported.drawingWidthPixels,label.height*height/imported.drawingHeightPixels);
    const raster=context.getImageData(0,0,width,height);
    return await runFloorAnalysis({data:raster.data,width,height,drawingWidth:imported.drawingWidthPixels,drawingHeight:imported.drawingHeightPixels,metersPerPixel,labels,excludeDrawingFrame:isPdf(imported.file)},[raster.data.buffer]);
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
  const candidates=new Map(),excluded=new Set();
  const filter=(index,list)=>{
    if(excluded.has(index))return false;
    const operation=list.fnArray[index];if(textOperations.has(operation))return false;
    if(operation!==ops.constructPath)return true;
    const [paint,paths,bounds]=list.argsArray[index];
    if(!bounds)return true;
    const m=context.getTransform(),corners=[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]].map(([x,y])=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f}));
    const width=Math.max(...corners.map(p=>p.x))-Math.min(...corners.map(p=>p.x)),height=Math.max(...corners.map(p=>p.y))-Math.min(...corners.map(p=>p.y));
    const minX=Math.min(...corners.map(p=>p.x)),minY=Math.min(...corners.map(p=>p.y));
    // Exclude long page-edge dimension/frame strokes; interior building walls remain structural.
    if(pageSize&&[ops.stroke,ops.closeStroke].includes(paint)&&((width<.5&&height>pageSize.height*.9&&(minX<pageSize.width*.15||minX>pageSize.width*.85))||(height<.5&&width>pageSize.width*.85&&(minY<pageSize.height*.03||minY>pageSize.height*.97))))return false;
    const path=paths?.[0],solidColumn=![ops.stroke,ops.closeStroke].includes(paint)&&path?.length===13&&path[12]===4&&width>0&&height>0&&width/height>.5&&width/height<2;
    if(pageSize&&!solidColumn&&!(path?.length===13&&path[12]===4)&&path?.length>=10&&height>=.5&&height<=Math.max(pageSize.width,pageSize.height)/24&&width>=height*.15&&width<=height*1.5)candidates.set(index,{index,minX,minY,maxX:minX+width,maxY:minY+height,height});
    return solidColumn||Math.max(width,height)>=3;
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
