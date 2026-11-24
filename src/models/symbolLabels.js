export function findRedSymbols(image){
  const {width,height,data}=image,mask=new Uint8Array(width*height);
  for(let i=0;i<mask.length;i++){
    const r=data[i*4],g=data[i*4+1],b=data[i*4+2];
    if(r>135&&r-g>60&&r-b>60)mask[i]=1;
  }
  const found=[];
  for(let i=0;i<mask.length;i++)if(mask[i]){
    const cells=[i];mask[i]=0;let x0=i%width,x1=x0,y0=Math.floor(i/width),y1=y0;
    for(let k=0;k<cells.length;k++){
      const x=cells[k]%width,y=Math.floor(cells[k]/width);
      x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const j=(y+dy)*width+x+dx;if(x+dx<0||x+dx>=width||!mask[j])continue;
        mask[j]=0;cells.push(j);
      }
    }
    if(cells.length>=3&&x1-x0<=14&&y1-y0<=14)found.push({x:(x0+x1)/2,y:(y0+y1)/2});
  }
  // A repeated red hatch or outline is a poor seed for caption recognition.
  const markers=[];
  for(const point of found){
    if(!markers.some(other=>Math.hypot(point.x-other.x,point.y-other.y)<6))markers.push(point);
  }
  return markers.length<=40?markers:[];
}

// A coloured marker only proposes a crop. An explicit, legible caption supplies its type.
export async function recognizeSymbolLabels(page,viewport,context,worker){
  function createCanvas(width,height){
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    return canvas;
  }
  const markers=findRedSymbols(context.getImageData(0,0,context.canvas.width,context.canvas.height));
  const labels=[],side=300,zoom=9,viewportZoom=page.getViewport({scale:viewport.scale*zoom});
  for(const {x,y} of markers){
    const crop=createCanvas(side,side),g=crop.getContext('2d');
    await page.render({canvas:crop,canvasContext:g,viewport:viewportZoom,transform:[1,0,0,1,side/2-x*zoom,side/2-y*zoom]}).promise;
    const rotations=[0,90,-90,180,45,-45,135,-135],tile=420;
    const atlas=createCanvas(tile*4,tile*2),a=atlas.getContext('2d');a.fillStyle='white';a.fillRect(0,0,atlas.width,atlas.height);
    rotations.forEach((degrees,i)=>{a.save();a.translate((i%4+.5)*tile,(Math.floor(i/4)+.5)*tile);a.rotate(degrees*Math.PI/180);a.drawImage(crop,-side/2,-side/2);a.restore();});
    const {data}=await worker.recognize(atlas,{}, {blocks:true});
    crop.width=crop.height=atlas.width=atlas.height=1;
    let best;
    for(const block of data.blocks||[])for(const para of block.paragraphs||[])for(const line of para.lines||[])for(const word of line.words||[]){
      if(word.confidence<78||!/^(?:exit|entry|entrance)$/i.test(word.text.trim()))continue;
      if(!best||word.confidence>best.confidence)best=word;
    }
    if(best)labels.push({text:best.text.toUpperCase(),x,y,source:'ocr',confidence:best.confidence,coordinateSource:'captioned marker'});
  }
  return labels;
}
