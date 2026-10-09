export function labelsFromRecognition(data,width,height,drawingWidth=width,drawingHeight=height){
  const labels=[];
  for(const block of data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[]){
    const words=(line.words||[]).filter(word=>word.confidence>=65&&/[a-z]/i.test(word.text)&&word.bbox&&Object.values(word.bbox).every(Number.isFinite));
    if(!words.length)continue;
    const x0=Math.min(...words.map(w=>w.bbox.x0)),x1=Math.max(...words.map(w=>w.bbox.x1)),y0=Math.min(...words.map(w=>w.bbox.y0)),y1=Math.max(...words.map(w=>w.bbox.y1));
    if(x1<=x0||y1<=y0||x0<0||y0<0||x1>width||y1>height)continue;
    labels.push({text:words.map(w=>w.text.trim()).join(' '),x:x0*drawingWidth/width,y:y1*drawingHeight/height,width:(x1-x0)*drawingWidth/width,height:(y1-y0)*drawingHeight/height,confidence:Math.min(...words.map(w=>w.confidence)),source:'ocr'});
  }
  return labels;
}

// Remove long rule lines from an OCR-only copy; the original drawing remains untouched.
export function textRecognitionRaster(data,width,height){
  const result=new Uint8ClampedArray(data),ink=new Uint8Array(width*height);
  for(let i=0;i<ink.length;i++)ink[i]=data[i*4+3]>128&&data[i*4]+data[i*4+1]+data[i*4+2]<450?1:0;
  const minimum=Math.max(40,Math.max(width,height)/40);
  for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){
    const seen=new Uint8Array(ink.length);
    for(let row=0;row<height;row++)for(let x=0;x<width;x++){
      const y=dy<0?height-1-row:row;
      const i=y*width+x;if(!ink[i]||seen[i])continue;
      const run=[];let cx=x,cy=y;
      while(cx>=0&&cx<width&&cy>=0&&cy<height&&ink[cy*width+cx]){const j=cy*width+cx;seen[j]=1;run.push(j);cx+=dx;cy+=dy;}
      if(run.length>=minimum)for(const j of run){result[j*4]=result[j*4+1]=result[j*4+2]=result[j*4+3]=255;}
    }
  }
  return result;
}

export async function recognizeFloorLabels(image,width,height){
  const source=URL.createObjectURL(image),loaded=new Image();
  try{await new Promise((resolve,reject)=>{loaded.onload=resolve;loaded.onerror=()=>reject(new Error('Could not read image for text recognition'));loaded.src=source;});}finally{URL.revokeObjectURL(source);}
  const ratio=Math.min(1,4096/Math.max(width,height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
  const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(loaded,0,0,canvas.width,canvas.height);
  const raster=context.getImageData(0,0,canvas.width,canvas.height);raster.data.set(textRecognitionRaster(raster.data,canvas.width,canvas.height));context.putImageData(raster,0,0);
  const {createWorker,PSM}=await import('tesseract.js');
  const base=new URL('./ocr/',document.baseURI).href;
  const worker=await createWorker('eng',1,{workerPath:base+'worker.min.js',corePath:base,langPath:base,workerBlobURL:false});
  try{
    await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
    const {data}=await worker.recognize(canvas,{}, {blocks:true});
    return labelsFromRecognition(data,canvas.width,canvas.height,width,height);
  }finally{await worker.terminate();}
}
