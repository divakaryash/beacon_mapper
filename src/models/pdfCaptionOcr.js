
// Find aligned runs of glyph-sized connected components in a high-resolution PDF tile.
// Long connected partitions and furniture outlines never reach the recognition atlas.
export function captionRuns(image,minimumGlyphs=3){
  const {width,height,data}=image,ink=new Uint8Array(width*height);
  for(let i=0;i<ink.length;i++){
    const offset=i*4;
    ink[i]=Math.max(data[offset],data[offset+1],data[offset+2])<190?1:0;
  }
  const cells=new Int32Array(ink.length),glyphs=[];
  for(let i=0;i<ink.length;i++){
    if(!ink[i])continue;
    let count=1,left=i%width,right=left,top=Math.floor(i/width),bottom=top;
    ink[i]=0;cells[0]=i;
    for(let k=0;k<count;k++){
      const j=cells[k],x=j%width,y=Math.floor(j/width);
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++){
        const n=yy*width+xx;if(ink[n]){ink[n]=0;cells[count++]=n;}
      }
    }
    const w=right-left+1,h=bottom-top+1;
    if(count>=3&&Math.max(w,h)>=5&&Math.max(w,h)<=88&&w*h<4000)
      glyphs.push({left,right,top,bottom});
  }
  const runs=[];
  for(const vertical of [false,true]){
    const ordered=glyphs.map(g=>({g,start:vertical?g.top:g.left,end:vertical?g.bottom:g.right,
      low:vertical?g.left:g.top,high:vertical?g.right:g.bottom})).sort((a,b)=>a.start-b.start);
    const lines=new Map();
    for(const glyph of ordered){
      const h=glyph.high-glyph.low+1;
      if(h<5||glyph.end-glyph.start>h*1.6)continue;
      const mid=(glyph.low+glyph.high)/2,band=Math.floor(mid/5);
      let best=null,bestCost=Infinity;
      for(let k=band-1;k<=band+1;k++)for(const line of lines.get(k)||[]){
        const gap=glyph.start-line.end-1,offset=Math.abs(mid-line.mid);
        if(gap< -1||gap>h*.95||offset>Math.max(1.5,h*.24)||Math.abs(h-line.h)>h*.45)continue;
        if(offset+Math.max(0,gap)*.25<bestCost){best=line;bestCost=offset+Math.max(0,gap)*.25;}
      }
      if(!best){
        best={glyphs:[],mid,h,end:glyph.end};
        if(!lines.has(band))lines.set(band,[]);
        lines.get(band).push(best);
      }
      best.glyphs.push(glyph.g);best.end=glyph.end;
    }
    for(const group of lines.values())for(const line of group){
      if(line.glyphs.length<minimumGlyphs)continue;
      const left=Math.min(...line.glyphs.map(g=>g.left)),right=Math.max(...line.glyphs.map(g=>g.right));
      const top=Math.min(...line.glyphs.map(g=>g.top)),bottom=Math.max(...line.glyphs.map(g=>g.bottom));
      const w=right-left+1,h=bottom-top+1;
      if((vertical?h/w:w/h)<1.5||Math.max(w,h)>800)continue;
      runs.push({x:left,y:top,w,h,vertical,count:line.glyphs.length});
    }
  }
  return runs;
}

const defaultCanvas=(width,height)=>Object.assign(document.createElement('canvas'),{width,height});

export async function recognizePdfCaptions(page,drawing,worker,makeCanvas=defaultCanvas,onProgress){
  const base=page.getViewport({scale:1});
  const viewport=page.getViewport({scale:Math.min(10,7400/Math.max(base.width,base.height))});
  const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height),output=[];
  const sx=drawing.width/width,sy=drawing.height/height;
  const tileSize=1800,margin=96,rowsPerBatch=30,rowHeight=52;
  // Pack one line per row and supply both reading directions. Keep the better reading.
  async function recognizeBatch(tile,runs,ox,oy){
    const atlas=makeCanvas(900,rowHeight*runs.length),ctx=atlas.getContext('2d');
    ctx.fillStyle='white';ctx.fillRect(0,0,atlas.width,atlas.height);
    for(const [i,r] of runs.entries()){
      const w=r.vertical?r.h:r.w,h=r.vertical?r.w:r.h;
      const scale=Math.min(3,30/h,420/w),pad=2;
      for(let reverse=0;reverse<2;reverse++){
        ctx.save();ctx.translate(reverse*450+225,(i+.5)*rowHeight);
        ctx.rotate((r.vertical?-Math.PI/2:0)+reverse*Math.PI);
        ctx.drawImage(tile,r.x-pad,r.y-pad,r.w+2*pad,r.h+2*pad,-(r.w+2*pad)*scale/2,-(r.h+2*pad)*scale/2,(r.w+2*pad)*scale,(r.h+2*pad)*scale);
        ctx.restore();
      }
    }
    const input=typeof atlas.toBuffer==='function'?atlas.toBuffer('image/png'):atlas;
    const {data}=await worker.recognize(input,{}, {blocks:true});
    const readings=new Map();
    const groups=new Map();
    for(const block of data.blocks||[])for(const para of block.paragraphs||[])for(const line of para.lines||[])for(const word of line.words||[]){
      const box=word.bbox;
      if(!box||word.confidence<70||!word.text.trim())continue;
      const row=Math.floor((box.y0+box.y1)/2/rowHeight),side=Math.floor((box.x0+box.x1)/900);
      if(row<0||row>=runs.length||side<0||side>1)continue;
      const key=row*2+side;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(word);
    }
    for(const [key,words] of groups){
      words.sort((a,b)=>a.bbox.x0-b.bbox.x0);
      const text=words.map(w=>w.text.trim()).join(' '),confidence=Math.min(...words.map(w=>w.confidence));
      const row=Math.floor(key/2);
      if(confidence>=78&&(/[a-z]{2}/i.test(text)||destinationCategory(text)==='Shop unit')&&(!readings.has(row)||readings.get(row).confidence<confidence))readings.set(row,{text,confidence});
    }
    for(const [row,label] of readings){
      const r=runs[row];
      output.push({text:label.text,source:'ocr',confidence:label.confidence,x:(ox+r.x)*sx,y:(oy+r.y+r.h)*sy,width:r.w*sx,height:r.h*sy,textHeight:r.vertical?r.w*sx:r.h*sy});
    }
    atlas.width=atlas.height=1;
  }
  let tileNumber=0;
  const tileCount=Math.ceil(width/tileSize)*Math.ceil(height/tileSize);
  for(let y=0;y<height;y+=tileSize)for(let x=0;x<width;x+=tileSize){
    onProgress?.(`Reading floor-plan labels (${++tileNumber}/${tileCount})`);
    const ox=Math.max(0,x-margin),oy=Math.max(0,y-margin);
    const tile=makeCanvas(Math.min(width,x+tileSize+margin)-ox,Math.min(height,y+tileSize+margin)-oy);
    const ctx=tile.getContext('2d',{willReadFrequently:true});
    await page.render({canvas:tile,canvasContext:ctx,viewport,transform:[1,0,0,1,-ox,-oy],background:'white'}).promise;
    const runs=captionRuns(ctx.getImageData(0,0,tile.width,tile.height)).filter(r=>{
      const cx=ox+r.x+r.w/2,cy=oy+r.y+r.h/2;
      return cx>=x&&cx<x+tileSize&&cy>=y&&cy<y+tileSize;
    });
    runs.sort((a,b)=>b.count-a.count);
    for(let j=0;j<Math.min(runs.length,180);j+=rowsPerBatch)await recognizeBatch(tile,runs.slice(j,j+rowsPerBatch),ox,oy);
    tile.width=tile.height=1;
  }
  return output;
}
import {destinationCategory} from './destinationCategory.js';
