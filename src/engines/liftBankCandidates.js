import {transportLobbyCaption} from '../models/destinationCategory.js';
import {segmentProjection} from './floorGeometry.js';

// Three or more matching, adjoining, walled rectangles with crossed diagonals
// form a lift-bank candidate. An isolated X is ambiguous on a CAD drawing.
function alignedBanks(strokes,width,height,scale,nearby,labels){
  const bins=new Map(),boxes=[];
  for(let i=0;i<strokes.length;i+=4){
    const a={x:strokes[i]*width,y:strokes[i+1]*height},b={x:strokes[i+2]*width,y:strokes[i+3]*height};
    const w=Math.abs(b.x-a.x),h=Math.abs(b.y-a.y);
    if(Math.min(w,h)*scale<1.3||Math.max(w,h)*scale>4||Math.max(w/h,h/w)>1.85)continue;
    const x=(a.x+b.x)/2,y=(a.y+b.y)/2,key=Math.round(x*scale*8)+','+Math.round(y*scale*8);
    const sign=(b.x-a.x)*(b.y-a.y)>0?1:-1;
    const matches=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const bucket=bins.get((Math.round(x*scale*8)+dx)+','+(Math.round(y*scale*8)+dy))||[];
      for(const q of bucket)if(Math.hypot(q.x-x,q.y-y)*scale<.055)matches.push(q);
    }
    if(matches.some(q=>q.sign===sign&&Math.abs(q.w-w)*scale<.08&&Math.abs(q.h-h)*scale<.08))continue;
    if(matches.some(q=>q.sign!==sign&&Math.abs(q.w-w)*scale<.08&&Math.abs(q.h-h)*scale<.08)){
      const points=[{x:x-w/2,y:y-h/2},{x:x+w/2,y:y-h/2},{x:x+w/2,y:y+h/2},{x:x-w/2,y:y+h/2}];
      const supported=points.filter((p,j)=>{
        const end=points[(j+1)%4],mid={x:(p.x+end.x)/2,y:(p.y+end.y)/2};
        return [...nearby(p,end,.18/scale)].some(l=>l.len>.42*Math.hypot(p.x-end.x,p.y-end.y)&&
          segmentProjection(mid,l.a,l.b).distance*scale<.19&&Math.abs(l.ux*(end.y-p.y)-l.uy*(end.x-p.x))*scale<.12);
      });
      if(supported.length>=3)boxes.push({x,y,w,h,points});
    }
    if(!bins.has(key))bins.set(key,[]);
    bins.get(key).push({sign,w,h,x,y});
  }
  const lobbies=labels.filter(l=>transportLobbyCaption.test(l.text)&&(l.confidence??100)>=80)
    .map(l=>({x:l.x+(l.width||0)/2,y:l.y-(l.height||0)/2}));
  const nearLobby=box=>lobbies.some(l=>Math.hypot(l.x-box.x,l.y-box.y)*scale<=7);
  const accepted=new Set();
  for(const axis of ['x','y']){
    const other=axis==='x'?'y':'x',size=axis==='x'?'w':'h';
    const visited=new Set();
    for(const box of boxes){
      if(visited.has(box))continue;
      visited.add(box);
      const group=[box];
      for(let i=0;i<group.length;i++)for(const q of boxes){
        const p=group[i],gap=(Math.abs(q[axis]-p[axis])-(q[size]+p[size])/2)*scale;
        if(visited.has(q)||Math.abs(q[other]-box[other])*scale>.20||gap<-.08||gap>(nearLobby(p)&&nearLobby(q)?1.5:.65)||
          (Math.max(Math.abs(q.w-box.w),Math.abs(q.h-box.h))*scale>.25&&
            !(nearLobby(q)&&nearLobby(box)&&Math.abs(q[other==='x'?'w':'h']-box[other==='x'?'w':'h'])*scale<=.25&&
              Math.abs(q[size]-box[size])*scale<.85)))continue;
        visited.add(q);group.push(q);
      }
      if(group.length>=3||(group.length===2&&group.every(nearLobby)))group.forEach(p=>accepted.add(p));
    }
  }
  return [...accepted];
}


export function liftBankCandidates(strokes,width,height,scale,nearby,labels=[]){
  const found=alignedBanks(strokes,width,height,scale,nearby,labels);
  for(const label of labels){
    if(!transportLobbyCaption.test(label.text)||(label.confidence??100)<80)continue;
    const origin={x:label.x+(label.width||0)/2,y:label.y-(label.height||0)/2};
    const lines=[...nearby(origin,origin,10/scale)];
    const bins=new Map();
    for(const line of lines){
      if(line.len*scale<1.3)continue;
      const degrees=(Math.atan2(line.uy,line.ux)*180/Math.PI+180)%90;
      if(degrees<2||degrees>88)continue;
      const key=Math.round(degrees);
      bins.set(key,(bins.get(key)||0)+line.len);
    }
    for(const [degrees] of [...bins].sort((a,b)=>b[1]-a[1]).slice(0,3)){
      const c=Math.cos(degrees*Math.PI/180),s=Math.sin(degrees*Math.PI/180);
      const local=p=>({x:c*(p.x-origin.x)+s*(p.y-origin.y),y:-s*(p.x-origin.x)+c*(p.y-origin.y)});
      const world=p=>({x:origin.x+c*p.x-s*p.y,y:origin.y+s*p.x+c*p.y});
      const segments=[];
      for(const line of lines){
        const a=local(line.a),b=local(line.b);
        segments.push(a.x,a.y,b.x,b.y);
      }
      const neighbors=(a,b,pad)=>[...nearby(world(a),world(b),pad)].map(l=>({
        a:local(l.a),b:local(l.b),len:l.len,ux:c*l.ux+s*l.uy,uy:-s*l.ux+c*l.uy
      }));
      const boxes=alignedBanks(segments,1,1,scale,neighbors,[{text:label.text,x:0,y:0}]);
      for(const box of boxes){
        if(Math.hypot(box.x,box.y)*scale>7)continue;
        const center=world(box);
        if(found.some(p=>Math.hypot(center.x-p.x,center.y-p.y)*scale<.3))continue;
        found.push({...box,...center,points:box.points.map(world)});
      }
    }
  }
  return found;
}
