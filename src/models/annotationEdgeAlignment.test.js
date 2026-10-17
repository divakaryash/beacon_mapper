import test from 'node:test';
import assert from 'node:assert/strict';
import {refineAnnotationEdges} from './annotationEdgeAlignment.js';

test('polygon edges remove translation and skew remaining after a label fit',()=>{
  const width=300,height=300,data=new Uint8ClampedArray(width*height*4);data.fill(255);
  const features=[];
  for(const [x,y] of [[30,30],[160,30],[30,160],[160,160]]){
    const ring=[[x,y],[x+80,y],[x+80,y+80],[x,y+80],[x,y]];
    features.push({properties:{type:'Store'},geometry:{type:'Polygon',coordinates:[ring.map(([x,y])=>[x/width,y/height])]}});
    for(let i=0;i<=80;i++)for(const [px,py] of [[x+i,y],[x+i,y+80],[x,y+i],[x+80,y+i]]){const k=(py*width+px)*4;data[k]=data[k+1]=data[k+2]=0;}
  }
  const reference={features,alignment:{origin:[0,0],geoToNormalizedPdf:[[1,.02],[.02,1],[.025,-.02]],boundary:[[0,0],[1,0],[1,1],[0,1]],widthMeters:100,boundarySource:'Test boundary'}};
  const result=refineAnnotationEdges(reference,{width,height,data},{drawingWidthPixels:width,drawingHeightPixels:height});
  assert.equal(result.alignment.method,'room-labels-and-polygon-edges');
  assert.ok(result.alignment.edgeErrorPixels<1);
  const m=result.alignment.geoToNormalizedPdf;
  for(const feature of features)for(const [x,y] of feature.geometry.coordinates[0]){
    assert.ok(Math.abs((x*m[0][0]+y*m[1][0]+m[2][0])*width-x*width)<1.5);
    assert.ok(Math.abs((x*m[0][1]+y*m[1][1]+m[2][1])*height-y*height)<1.5);
  }
});
test('no usable edge samples preserves the original alignment',()=>{
  const reference={features:[],alignment:{origin:[0,0],geoToNormalizedPdf:[[1,0],[0,1],[0,0]]}};
  assert.equal(refineAnnotationEdges(reference,{width:1,height:1,data:new Uint8ClampedArray(4)},{drawingWidthPixels:1,drawingHeightPixels:1}),reference);
});

test('geometry alone aligns an unseen floor without room labels or saved floor coordinates',async()=>{
  const {annotationSetup,annotatedReference}=await import('./annotatedFloor.js');
  const {localToGeographic}=await import('./floorPlanSetup.js');
  const width=400,height=400,data=new Uint8ClampedArray(width*height*4);data.fill(255);
  const shapes=[[0,0,30,20],[45,0,20,30],[0,50,60,20],[70,40,20,40]];
  const features=shapes.map(([x,y,w,h],i)=>{
    const ring=[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
    const pixels=ring.map(([x,y])=>({x:Math.round(2.5*x+50),y:Math.round(2.5*y+60)}));
    for(let j=1;j<pixels.length;j++){const a=pixels[j-1],b=pixels[j],steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y));for(let k=0;k<=steps;k++){const px=Math.round(a.x+(b.x-a.x)*k/steps),py=Math.round(a.y+(b.y-a.y)*k/steps),index=(py*width+px)*4;data[index]=data[index+1]=data[index+2]=0;}}
    return {id:`room-${i}`,properties:{floor:7,type:'Store',name:'Unlabeled room'},geometry:{type:'Polygon',coordinates:[ring.map(([x,y])=>localToGeographic({x,y:-y},{latitude:28,longitude:77}))]}};
  });
  const payload={features},reference={...annotatedReference(payload,7,annotationSetup(payload,7)),geometryOnly:true};
  const result=refineAnnotationEdges(reference,{data,width,height},{drawingWidthPixels:width,drawingHeightPixels:height});
  assert.equal(result.alignment.method,'polygon-edges');assert.ok(result.alignment.edgeErrorPixels<1.5);
  const blank=new Uint8ClampedArray(data.length);blank.fill(255);
  assert.throws(()=>refineAnnotationEdges(reference,{data:blank,width,height},{drawingWidthPixels:width,drawingHeightPixels:height}),/too little visible geometry/);
});
