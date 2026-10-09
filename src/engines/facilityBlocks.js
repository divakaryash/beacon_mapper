// shortcut: repeated horizontal/vertical treads identify assembly candidates; angled or ambiguous symbols need review.
export function facilityBlocks(ink,width,height,labels,sx=1,sy=1){
  const proposals=[];
  for(const vertical of [false,true]){
    const span=vertical?height:width,rows=vertical?width:height,groups=[];
    for(let row=0;row<rows;row++)for(let col=0;col<span;){
      const index=c=>vertical?c*width+row:row*width+c;
      if(!ink[index(col)]){col++;continue;}const start=col;while(col<span&&ink[index(col)])col++;
      const length=col-start;if(length<6||length>Math.max(width,height)/6)continue;
      let group=groups.find(g=>row-g.last<=5&&row>g.last&&Math.abs(g.start-start)<=2&&Math.abs(g.end-col)<=2);
      if(!group){group={start,end:col,first:row,last:row,count:0,gaps:0};groups.push(group);}
      if(row-group.last>1)group.gaps++;
      group.last=row;group.count++;
    }
    for(const g of groups)if(g.count>=4&&g.gaps>=2){
      const box=vertical?{x:g.first,y:g.start,w:g.last-g.first+1,h:g.end-g.start}:{x:g.start,y:g.first,w:g.end-g.start,h:g.last-g.first+1};
      proposals.push({...box,count:g.count});
    }
  }
  const blocks=[];
  for(const label of labels){
    const type=/\bescalator/i.test(label.text)?'Escalator':/\b(stairs?|staircase)\b/i.test(label.text)?'Stairs':null;
    if(!type||![label.x,label.y].every(Number.isFinite))continue;
    const p={x:(label.x+(label.width||0)/2)/sx,y:(label.y-(label.height||0)/2)/sy};
    const candidates=proposals.map(box=>({box,d:Math.hypot(p.x-box.x-box.w/2,p.y-box.y-box.h/2)})).filter(c=>c.d<=Math.max(c.box.w,c.box.h)*1.5).sort((a,b)=>a.d-b.d);
    const box=candidates[0]?.box;if(!box||blocks.some(b=>Math.hypot(b.x-box.x,b.y-box.y)<3))continue;
    blocks.push({...box,type,name:label.text,label});
  }
  for(const box of proposals){
    if(box.count<6||Math.min(box.w,box.h)<8||box.w/box.h<.25||box.w/box.h>4||blocks.some(b=>Math.hypot(b.x-box.x,b.y-box.y)<Math.max(box.w,box.h)/2))continue;
    if(labels.some(label=>Math.hypot((label.x+(label.width||0)/2)/sx-box.x-box.w/2,(label.y-(label.height||0)/2)/sy-box.y-box.h/2)<Math.max(box.w,box.h)))continue;
    const rail=(side,vertical)=>{let count=0;const span=vertical?box.h:box.w;for(let i=0;i<span;i++)for(let offset=-1;offset<=1;offset++){const x=vertical?side+offset:box.x+i,y=vertical?box.y+i:side+offset;if(x>=0&&x<width&&y>=0&&y<height&&ink[y*width+x]){count++;break;}}return count/span;};
    const rails=(rail(box.x,true)>.6&&rail(box.x+box.w-1,true)>.6)||(rail(box.y,false)>.6&&rail(box.y+box.h-1,false)>.6);
    if(rails)blocks.push({...box,type:'Vertical circulation',name:'Stair / escalator assembly (review)',needsReview:true});
  }
  return blocks;
}
