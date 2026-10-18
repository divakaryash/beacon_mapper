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

test('geometry alignment handles an exterior footprint much larger than the shop cluster',async()=>{
  const {annotationSetup,annotatedReference}=await import('./annotatedFloor.js');
  const {localToGeographic}=await import('./floorPlanSetup.js');
  const width=400,height=400,data=new Uint8ClampedArray(width*height*4);data.fill(255);
  const coordinate=([x,y])=>localToGeographic({x,y:-y},{latitude:28,longitude:77});
  const rings=[[[0,0],[200,0],[200,200],[0,200],[0,0]],...[[70,50,18,25],[95,50,30,18],[70,90,40,20],[120,80,20,50]].map(([x,y,w,h])=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]])];
  const features=rings.map((ring,index)=>{
    const pixels=ring.map(([x,y])=>({x:Math.round(x*1.6+35),y:Math.round(y*1.6+40)}));
    for(let j=1;j<pixels.length;j++){const a=pixels[j-1],b=pixels[j],steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y));for(let k=0;k<=steps;k++){const px=Math.round(a.x+(b.x-a.x)*k/steps),py=Math.round(a.y+(b.y-a.y)*k/steps),offset=(py*width+px)*4;data[offset]=data[offset+1]=data[offset+2]=0;}}
    return {id:String(index),properties:{floor:0,type:index?'Store':'Boundary'},geometry:{type:'Polygon',coordinates:[ring.map(coordinate)]}};
  });
  const payload={features},reference={...annotatedReference(payload,0,annotationSetup(payload,0)),geometryOnly:true};
  const result=refineAnnotationEdges(reference,{width,height,data},{drawingWidthPixels:width,drawingHeightPixels:height});
  assert.ok(result.alignment.edgeErrorPixels<1.5);
  const m=result.alignment.geoToNormalizedPdf,origin=result.alignment.origin;
  for(const ring of rings.slice(1))for(const [x,y] of ring){const [lon,lat]=coordinate([x,y]);assert.ok(Math.abs(((lon-origin[0])*m[0][0]+(lat-origin[1])*m[1][0]+m[2][0])*width-(x*1.6+35))<3);}
});

test('sparse rooms use structural walls to realign replacement drawings with new rotation, scale and margins',async()=>{
  const {annotationSetup,annotatedReference}=await import('./annotatedFloor.js');
  const {localToGeographic}=await import('./floorPlanSetup.js');
  const coordinate=([x,y])=>localToGeographic({x,y:-y},{latitude:28,longitude:77});
  const rings=[[0,0,30,20],[45,0,20,30],[0,50,60,20],[70,40,20,40]].map(([x,y,w,h])=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]);
  const payload={features:rings.map((ring,i)=>({id:String(i),properties:{floor:0,type:i===0?'Room':'Wall'},geometry:{type:'Polygon',coordinates:[ring.map(coordinate)]}}))};
  const reference={...annotatedReference(payload,0,annotationSetup(payload,0)),geometryOnly:true};
  for(const [width,height,angle,scale,tx,ty] of [[400,400,0,2.5,50,60],[460,380,33,2.2,165,35]]){
    const data=new Uint8ClampedArray(width*height*4);data.fill(255);
    const radians=angle*Math.PI/180;
    const pixel=([x,y])=>[scale*(Math.cos(radians)*x-Math.sin(radians)*y)+tx,scale*(Math.sin(radians)*x+Math.cos(radians)*y)+ty];
    for(const ring of rings){
      const pixels=ring.map(pixel);
      for(let i=1;i<pixels.length;i++){
        const [ax,ay]=pixels[i-1],[bx,by]=pixels[i],steps=Math.ceil(Math.hypot(bx-ax,by-ay));
        for(let j=0;j<=steps;j++){const x=Math.round(ax+(bx-ax)*j/steps),y=Math.round(ay+(by-ay)*j/steps),k=(y*width+x)*4;data[k]=data[k+1]=data[k+2]=0;}
      }
    }
    const result=refineAnnotationEdges(reference,{width,height,data},{drawingWidthPixels:width,drawingHeightPixels:height});
    const m=result.alignment.geoToNormalizedPdf,[lon0,lat0]=result.alignment.origin;
    for(const ring of rings)for(const point of ring){
      const [lon,lat]=coordinate(point),[x,y]=pixel(point);
      assert.ok(Math.hypot(((lon-lon0)*m[0][0]+(lat-lat0)*m[1][0]+m[2][0])*width-x,((lon-lon0)*m[0][1]+(lat-lat0)*m[1][1]+m[2][1])*height-y)<3,`replacement at ${angle} degrees must preserve polygon corners`);
    }
    assert.ok(Math.abs(result.alignment.widthMeters-width/scale)<2);
  }
});
