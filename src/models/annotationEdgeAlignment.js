// Refine the label fit against long polygon edges and the actual drawing's ink.
export function refineAnnotationEdges(reference,{data,width,height},drawing){
  const ratioX=width/drawing.drawingWidthPixels,ratioY=height/drawing.drawingHeightPixels;
  const m=reference.alignment.geoToNormalizedPdf,origin=reference.alignment.origin,points=[];
  const project=([lon,lat])=>({x:((lon-origin[0])*m[0][0]+(lat-origin[1])*m[1][0]+m[2][0])*width,y:((lon-origin[0])*m[0][1]+(lat-origin[1])*m[1][1]+m[2][1])*height});
  for(const feature of reference.features){
    if(feature.geometry.type!=='Polygon'||!['Store','Outlet','Room'].includes(feature.properties.type))continue;
    const ring=feature.geometry.coordinates[0].map(project);
    for(let i=1;i<ring.length;i++){
      const a=ring[i-1],b=ring[i],length=Math.hypot(b.x-a.x,b.y-a.y);
      if(length<12)continue;
      const count=Math.ceil(length/3);
      for(let j=0;j<count;j++){const t=(j+.5)/count;points.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)});}
    }
  }
  if(points.length<100){if(reference.geometryOnly)throw new Error('Too few polygon edges to register this drawing.');return reference;}
  const samples=points.filter((_,i)=>i%Math.max(1,Math.ceil(points.length/5000))===0);
  const field=new Uint16Array(width*height);field.fill(10000);
  for(let i=0;i<field.length;i++)if(data[4*i+3]>128&&data[4*i]+data[4*i+1]+data[4*i+2]<450)field[i]=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;let d=field[i];if(x)d=Math.min(d,field[i-1]+10);if(y)d=Math.min(d,field[i-width]+10);if(x&&y)d=Math.min(d,field[i-width-1]+14);if(x+1<width&&y)d=Math.min(d,field[i-width+1]+14);field[i]=d;}
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){const i=y*width+x;let d=field[i];if(x+1<width)d=Math.min(d,field[i+1]+10);if(y+1<height)d=Math.min(d,field[i+width]+10);if(x&&y+1<height)d=Math.min(d,field[i+width-1]+14);if(x+1<width&&y+1<height)d=Math.min(d,field[i+width+1]+14);field[i]=d;}
  const cx=width/2,cy=height/2;
  const transform=(p,t)=>({x:t[0]*(p.x-cx)+t[1]*(p.y-cy)+cx+t[4],y:t[2]*(p.x-cx)+t[3]*(p.y-cy)+cy+t[5]});
  function score(t){
    let sum=0;
    for(const p of samples){const q=transform(p,t),x=Math.round(q.x),y=Math.round(q.y);const d=x<0||y<0||x>=width||y>=height?15:Math.min(15,field[y*width+x]/10);sum+=d*d;}
    return sum/samples.length;
  }
  let current=[1,0,0,1,0,0],best=score(current),initial=best;
  const seeds=[];
  if(reference.geometryOnly){
    const xs=[],ys=[];
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++)if(field[y*width+x]===0){xs.push(x);ys.push(y);}
    if(xs.length<100)throw new Error('The drawing has too little visible geometry for automatic registration.');
    xs.sort((a,b)=>a-b);ys.sort((a,b)=>a-b);
    const lo=.015,hi=.985,left=xs[Math.floor(xs.length*lo)],right=xs[Math.floor(xs.length*hi)],top=ys[Math.floor(ys.length*lo)],bottom=ys[Math.floor(ys.length*hi)];
    const axisRatio=width*(6378137*Math.PI/180)/(reference.alignment.widthMeters*height*Math.abs(m[1][1]));
    const histogram=new Float64Array(36);
    for(const feature of reference.features)if(feature.geometry.type==='Polygon'&&['Store','Outlet','Room'].includes(feature.properties.type)){
      const ring=feature.geometry.coordinates[0].map(project);
      for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i],length=Math.hypot(b.x-a.x,b.y-a.y);if(length<12)continue;const angle=((Math.atan2((b.y-a.y)*axisRatio,b.x-a.x)*180/Math.PI)%90+90)%90;histogram[Math.round(angle/2.5)%36]+=length;}
    }
    let dominant=0;for(let i=1;i<36;i++)if(histogram[i]>histogram[dominant])dominant=i;
    best=Infinity;
    for(let quadrant=0;quadrant<4;quadrant++)for(const offset of [-10,-5,0,5,10]){
      const angle=(-dominant*2.5+quadrant*90+offset)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
      // Geographic dimensions provide a second scale seed when exterior ink dwarfs the shops.
      for(const scale of [.85,1,1.15])for(const dx of [-.1,0,.1])for(const dy of [-.1,0,.1]){
        const t=[scale*cos,-scale*sin*axisRatio,scale*sin,scale*cos*axisRatio,dx*width,dy*height];
        const value=score(t);seeds.push({t,value,quadrant:quadrant*100+offset+2000});
      }
      for(const extent of [samples,reference.alignment.boundary.map(([x,y])=>({x:x*width,y:y*height}))]){
        const rotated=extent.map(p=>({x:cos*(p.x-cx)-sin*(p.y-cy)*axisRatio,y:sin*(p.x-cx)+cos*(p.y-cy)*axisRatio}));
        const minX=Math.min(...rotated.map(p=>p.x)),maxX=Math.max(...rotated.map(p=>p.x)),minY=Math.min(...rotated.map(p=>p.y)),maxY=Math.max(...rotated.map(p=>p.y));
        const fit=Math.sqrt((right-left)*(bottom-top)/((maxX-minX)*(maxY-minY)));
        for(const factor of [.85,.925,1,1.075,1.15])for(const dx of [-.05,0,.05])for(const dy of [-.05,0,.05]){
          const scale=fit*factor,t=[scale*cos,-scale*sin*axisRatio,scale*sin,scale*cos*axisRatio,(left+right)/2-cx-scale*(minX+maxX)/2+dx*width,(top+bottom)/2-cy-scale*(minY+maxY)/2+dy*height];
          const value=score(t);seeds.push({t,value,quadrant:quadrant*100+offset+(extent===samples?0:1000)});if(value<best){best=value;current=t;}
        }
      }
    }
  }
  const starts=reference.geometryOnly?[...new Set(seeds.map(s=>s.quadrant))].flatMap(q=>seeds.filter(s=>s.quadrant===q).sort((a,b)=>a.value-b.value).slice(0,4).map(s=>s.t)):[current];
  let globalBest=Infinity,globalTransform=current;
  for(const start of starts){
    current=[...start];best=score(current);const seed=[...current];
    for(const step of [8,4,2,1,.5])for(let iteration=0;iteration<40;iteration++){
      let next=current,nextScore=best;
      for(let k=0;k<6;k++)for(const sign of [-1,1]){
        const candidate=[...current];candidate[k]+=sign*step/(k<4?(k%2===0?cx:cy):1);
        if(candidate.slice(0,4).some((n,i)=>Math.abs(n-seed[i])>.2)||Math.abs(candidate[4]-seed[4])>width*.1||Math.abs(candidate[5]-seed[5])>height*.1)continue;
        if(candidate[0]*candidate[3]-candidate[1]*candidate[2]<=0)continue;
        const value=score(candidate);if(value<nextScore-1e-8){next=candidate;nextScore=value;}
      }
      for(const sign of [-1,1])for(const mode of ['rotate','scale']){
        const candidate=[...current],angle=sign*step/300,cos=Math.cos(angle),sin=Math.sin(angle),factor=1+angle;
        if(mode==='rotate'){candidate[0]=cos*current[0]-sin*current[2];candidate[1]=cos*current[1]-sin*current[3];candidate[2]=sin*current[0]+cos*current[2];candidate[3]=sin*current[1]+cos*current[3];}
        else for(let k=0;k<4;k++)candidate[k]*=factor;
        if(candidate.slice(0,4).some((n,i)=>Math.abs(n-seed[i])>.2))continue;
        const value=score(candidate);if(value<nextScore-1e-8){next=candidate;nextScore=value;}
      }
      if(next===current)break;current=next;best=nextScore;
    }
    if(best<globalBest){globalBest=best;globalTransform=current;}
  }
  current=globalTransform;best=globalBest;
  if(reference.geometryOnly&&Math.sqrt(best)>3)throw new Error(`Drawing geometry does not match the annotations closely enough (${Math.sqrt(best).toFixed(1)} px edge error).`);
  if(!reference.geometryOnly&&best>initial*.9)return reference;
  const [a,b,c,d,tx,ty]=current,det=a*d-b*c;
  const matrix=m.map(([x,y],i)=>[(a*x*width+b*y*height+(i===2?cx+tx-a*cx-b*cy:0))/width,(c*x*width+d*y*height+(i===2?cy+ty-c*cx-d*cy:0))/height]);
  const boundary=reference.alignment.boundary.map(([x,y])=>{const p=transform({x:x*width,y:y*height},current);return [p.x/width,p.y/height];});
  return {...reference,alignment:{...reference.alignment,geoToNormalizedPdf:matrix,boundary,widthMeters:reference.alignment.widthMeters/Math.sqrt(det),method:reference.geometryOnly?'polygon-edges':'room-labels-and-polygon-edges',edgeErrorPixels:Math.sqrt(best)/Math.sqrt(ratioX*ratioY),boundarySource:`Polygon edges registered to drawing walls (${(Math.sqrt(best)/Math.sqrt(ratioX*ratioY)).toFixed(1)} px edge error). ${reference.alignment.boundarySource}`}};
}

export async function alignAnnotationEdgesToMap(reference,imported){
  const source=URL.createObjectURL(imported.floorPlanPreview||imported.file);
  try{
    const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Could not read drawing for edge alignment'));image.src=source;});
    const ratio=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*ratio);canvas.height=Math.round(image.naturalHeight*ratio);
    const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    const raster=context.getImageData(0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('../engines/annotationAlignmentWorker.js',import.meta.url),{type:'module'});
      const finish=()=>{clearTimeout(timer);worker.terminate();};
      const timer=setTimeout(()=>{finish();reject(new Error('Drawing alignment timed out.'));},60000);
      worker.onmessage=({data})=>{finish();data.error?reject(new Error(data.error)):resolve(data.result);};
      worker.onerror=()=>{finish();reject(new Error('Drawing alignment worker failed.'));};
      worker.postMessage({reference,raster:{width:raster.width,height:raster.height,data:raster.data},drawing:{drawingWidthPixels:imported.drawingWidthPixels,drawingHeightPixels:imported.drawingHeightPixels}},[raster.data.buffer]);
    });
  }finally{URL.revokeObjectURL(source);}
}
