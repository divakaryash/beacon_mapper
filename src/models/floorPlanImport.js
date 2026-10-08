export const isPdf = file => file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");

export function rasterSize(width, height) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error("Invalid floor-plan dimensions");
  // ponytail: one bounded raster per PDF page; tiled rendering if deeper zoom is needed.
  const scale = Math.min(2, 4096 / Math.max(width, height));
  return { width: Math.ceil(width * scale), height: Math.ceil(height * scale), scale };
}

export async function readFloorPlan(file) {
  if (isPdf(file)) {
    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
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
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: page.getViewport({ scale: size.scale }), background: "white" }).promise;
      const preview = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not render PDF page")), "image/png"));
      const text = await page.getTextContent();
      const viewport = page.getViewport({ scale: size.scale });
      const floorPlanLabels = text.items.filter(item => item.str).map(item => {
        const [x,y] = viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
        return {text:item.str,x,y,...(Math.abs(item.transform[1])<.001?{width:item.width*size.scale,height:item.height*size.scale}: {})};
      });
      return { file, sourceSha256, floorPlanLabels, floorPlanPreview: preview, pdfPageCount: pdf.numPages, drawingWidthPixels: size.width, drawingHeightPixels: size.height };
    } finally { await task.destroy(); }
  }
  if (!file.type.startsWith("image/") && !/\.(png|jpe?g|svg)$/i.test(file.name)) throw new Error("Choose a PNG, JPG, SVG, or PDF floor plan");
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Could not read floor-plan image")); image.src = source; });
    return { file, floorPlanPreview: null, pdfPageCount: null, drawingWidthPixels: image.naturalWidth, drawingHeightPixels: image.naturalHeight };
  } finally { URL.revokeObjectURL(source); }
}

export async function analyzeImportedFloor(imported,metersPerPixel) {
  const reference=await matchingFloorReference(imported);
  if(reference)return runFloorAnalysis({reference,drawingWidth:imported.drawingWidthPixels,drawingHeight:imported.drawingHeightPixels});
  const source=URL.createObjectURL(imported.floorPlanPreview||imported.file);
  try {
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Could not rasterize the floor plan'));image.src=source;});
    const ratio=128/Math.max(image.naturalWidth,image.naturalHeight),width=Math.max(3,Math.round(image.naturalWidth*ratio)),height=Math.max(3,Math.round(image.naturalHeight*ratio));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='white';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
    let labels=imported.floorPlanLabels||[];
    if(/\.svg$/i.test(imported.file.name)||imported.file.type==='image/svg+xml'){
      const svg=new DOMParser().parseFromString(await imported.file.text(),'image/svg+xml');
      const viewBox=svg.documentElement.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
      labels=[...svg.querySelectorAll('text')].filter(el=>!el.closest('[transform]')).map(el=>({text:el.textContent,x:(Number(el.getAttribute('x'))-(viewBox?.[0]||0))*imported.drawingWidthPixels/(viewBox?.[2]||imported.drawingWidthPixels),y:(Number(el.getAttribute('y'))-(viewBox?.[1]||0))*imported.drawingHeightPixels/(viewBox?.[3]||imported.drawingHeightPixels),...(!el.closest('[text-anchor]')?{width:(el.textContent.length*Number(el.closest('[font-size]')?.getAttribute('font-size')||16)*.65)*imported.drawingWidthPixels/(viewBox?.[2]||imported.drawingWidthPixels),height:Number(el.closest('[font-size]')?.getAttribute('font-size')||16)*imported.drawingHeightPixels/(viewBox?.[3]||imported.drawingHeightPixels)}:{})}));
    }
    // Text is annotation, not a wall. Only remove positioned, unrotated label boxes.
    for(const label of labels)if(label.width>0&&label.height>0)context.fillRect(label.x*width/imported.drawingWidthPixels,(label.y-label.height)*height/imported.drawingHeightPixels,label.width*width/imported.drawingWidthPixels,label.height*height/imported.drawingHeightPixels);
    const raster=context.getImageData(0,0,width,height);
    return await runFloorAnalysis({data:raster.data,width,height,drawingWidth:imported.drawingWidthPixels,drawingHeight:imported.drawingHeightPixels,metersPerPixel,labels},[raster.data.buffer]);
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
