// Retry only unnamed spaces; printed text never becomes geometry.
export async function recognizePolygonNames(preview,annotation,scale,profile,frame){
  const pending=annotation.features.filter(f=>f.geometry.type==='Polygon'&&['Store','Room','Ward','Gate','Exhibit','Enclosure','Office','Classroom','Counter','Lift'].includes(f.properties.type)&&!f.properties.name);
  if(!pending.length||!preview)return [];
  const url=URL.createObjectURL(preview),image=new Image();try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Could not read floor preview'));image.src=url;});}finally{URL.revokeObjectURL(url);}
  const coordinateRatio=scale/annotation.metadata.metersPerPixel;
  const {createWorker,PSM}=await import('tesseract.js'),base=new URL('./ocr/',document.baseURI).href;
  const worker=await createWorker('eng',1,{workerPath:base+'worker.min.js',corePath:base,langPath:base,workerBlobURL:false}),labels=[];
  try{await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});for(const f of pending){
    const rings=f.geometry.coordinnatesLocal,points=rings[0],xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;
    if(!(w>0&&h>0))continue;const ratio=Math.min(4,1024/Math.max(w,h)),crop=document.createElement('canvas');crop.width=Math.ceil(w*ratio);crop.height=Math.ceil(h*ratio);const c=crop.getContext('2d');c.fillStyle='white';c.fillRect(0,0,crop.width,crop.height);c.save();c.beginPath();for(const ring of rings){ring.forEach((p,i)=>i?c.lineTo((p[0]-x)*ratio,(p[1]-y)*ratio):c.moveTo((p[0]-x)*ratio,(p[1]-y)*ratio));c.closePath();}c.clip('evenodd');c.drawImage(image,x*image.width/frame.width,y*image.height/frame.height,w*image.width/frame.width,h*image.height/frame.height,0,0,crop.width,crop.height);c.restore();
    for(const degrees of [0,90,180,270]){const rotated=document.createElement('canvas');rotated.width=degrees%180?crop.height:crop.width;rotated.height=degrees%180?crop.width:crop.height;const r=rotated.getContext('2d');r.translate(rotated.width/2,rotated.height/2);r.rotate(degrees*Math.PI/180);r.drawImage(crop,-crop.width/2,-crop.height/2);const {data}=await worker.recognize(rotated);const text=data.text.trim().replace(/\s+/g,' ');if(text&&data.confidence>=65){labels.push({text,x:f.properties.centroid[0]*coordinateRatio,y:f.properties.centroid[1]*coordinateRatio,source:'polygon-ocr',confidence:data.confidence});if(profile.namePatterns.some(pattern=>new RegExp(pattern,'i').test(text)))break;}}
  }}finally{await worker.terminate();}return labels;
}
