// Room labels register geographic geometry to the drawing without assuming page margins.
export const roomCodes=text=>[...new Set((String(text||'').toUpperCase().match(/\b(?:AUDI[\s-]*\d{1,2}|[A-Z]{1,3}[\s-]*\d{1,4}[A-Z]?|\d{3})\b/g)||[]).map(code=>code.replace(/[\s-]/g,'')))];
const codes=roomCodes;
function solve(rows,values){
  const matrix=Array.from({length:4},(_,i)=>[...Array.from({length:4},(_,j)=>rows.reduce((s,r)=>s+r[i]*r[j],0)),rows.reduce((s,r,k)=>s+r[i]*values[k],0)]);
  for(let i=0;i<4;i++){
    let pivot=i;for(let j=i+1;j<4;j++)if(Math.abs(matrix[j][i])>Math.abs(matrix[pivot][i]))pivot=j;
    if(Math.abs(matrix[pivot][i])<1e-9)return null;
    [matrix[i],matrix[pivot]]=[matrix[pivot],matrix[i]];
    const divisor=matrix[i][i];for(let k=i;k<=4;k++)matrix[i][k]/=divisor;
    for(let j=0;j<4;j++)if(j!==i){const factor=matrix[j][i];for(let k=i;k<=4;k++)matrix[j][k]-=factor*matrix[i][k];}
  }
  return matrix.map(row=>row[4]);
}
function fit(pairs){
  const rows=[],values=[];
  for(const p of pairs){rows.push([p.x,-p.y,1,0],[p.y,p.x,0,1]);values.push(p.u,p.v);}
  return solve(rows,values);
}
const projected=(model,p)=>({x:model[0]*p.x-model[1]*p.y+model[2],y:model[1]*p.x+model[0]*p.y+model[3]});
export function alignAnnotatedReference(reference,labels,{drawingWidthPixels:width,drawingHeightPixels:height}){
  if(![width,height].every(n=>Number.isFinite(n)&&n>0))throw new Error('Invalid drawing dimensions for alignment.');
  const origin=reference.alignment.origin,radians=Math.PI/180,lonMeters=6378137*radians*Math.cos(origin[1]*radians),latMeters=6378137*radians;
  const rooms=new Map();
  for(const f of reference.features){
    if(f.geometry.type!=='Polygon'||!['Store','Outlet','Room'].includes(f.properties.type))continue;
    const ring=f.geometry.coordinates[0],xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);
    const center=f.properties.centroid||[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2];
    const p={id:f.properties.originalFeatureId||f.id,x:(center[0]-origin[0])*lonMeters,y:(origin[1]-center[1])*latMeters};
    for(const code of codes(f.properties.name)){if(!rooms.has(code))rooms.set(code,[]);rooms.get(code).push(p);}
  }
  const candidates=new Map();
  for(const label of labels||[]){
    const matches=codes(label.text).map(code=>rooms.get(code)).filter(list=>list?.length===1).map(list=>list[0]);
    if(!matches.length||new Set(matches.map(p=>p.id)).size!==1)continue;
    const source=matches[0],pair={...source,u:label.x+(label.width||0)/2,v:label.y-(label.height||0)/2};
    if(![pair.x,pair.y,pair.u,pair.v].every(Number.isFinite))continue;
    if(!candidates.has(source.id))candidates.set(source.id,[]);candidates.get(source.id).push(pair);
  }
  const pairs=[...candidates.values()].filter(list=>list.length===1).flat();
  if(pairs.length<3)throw new Error(`Automatic map alignment needs at least 3 unique matching room labels; found ${pairs.length}.`);
  const threshold=Math.max(8,Math.hypot(width,height)*.012);
  const error=(model,p)=>{const q=projected(model,p);return Math.hypot(q.x-p.u,q.y-p.v);};
  let best=[],bestError=Infinity;
  // shortcut: bounded deterministic pair sampling; add image-edge registration for unlabeled plans.
  let seed=17;
  for(let trial=0;trial<600;trial++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;const a=pairs[seed%pairs.length];
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;const b=pairs[seed%pairs.length];
    if(a===b||Math.hypot(a.x-b.x,a.y-b.y)<10)continue;
    const model=fit([a,b]);if(!model)continue;
    const inliers=pairs.filter(p=>error(model,p)<=threshold),total=inliers.reduce((s,p)=>s+error(model,p),0);
    if(inliers.length>best.length||(inliers.length===best.length&&total<bestError)){best=inliers;bestError=total;}
  }
  if(best.length<Math.max(3,Math.ceil(pairs.length*.4)))throw new Error('Room labels do not consistently match this floor map. Check that the JSON and map describe the same floor.');
  let model=fit(best);
  for(let i=0;i<2;i++){best=pairs.filter(p=>error(model,p)<=threshold);model=fit(best);if(!model)throw new Error('Map alignment is degenerate.');}
  const [a,b,tx,ty]=model,scale=Math.hypot(a,b);
  const spanX=Math.max(...best.map(p=>p.u))-Math.min(...best.map(p=>p.u)),spanY=Math.max(...best.map(p=>p.v))-Math.min(...best.map(p=>p.v));
  if(scale<=0||spanX<width*.15||spanY<height*.15)throw new Error('Matching labels cover too little of the drawing for reliable automatic alignment.');
  const matrix=[[a*lonMeters/width,b*lonMeters/height],[b*latMeters/width,-a*latMeters/height],[tx/width,ty/height]];
  const old=reference.alignment;
  const boundary=old.boundary.map(([u,v])=>{const lon=u/old.geoToNormalizedPdf[0][0],lat=v/old.geoToNormalizedPdf[1][1];const p=projected(model,{x:lon*lonMeters,y:-lat*latMeters});return [p.x/width,p.y/height];});
  const rms=Math.sqrt(best.reduce((sum,p)=>sum+error(model,p)**2,0)/best.length);
  return {...reference,alignment:{...old,geoToNormalizedPdf:matrix,boundary,widthMeters:width/scale,method:'matched-room-labels',matchedLabels:best.length,rmsPixels:rms,boundarySource:`Automatically aligned using ${best.length} room labels (${rms.toFixed(1)} px RMS). ${old.boundarySource}`}};
}
