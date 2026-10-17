import test from 'node:test';
import assert from 'node:assert/strict';
import {annotationSetup,annotatedReference} from './annotatedFloor.js';
import {alignAnnotatedReference} from './annotationAlignment.js';
import {localToGeographic} from './floorPlanSetup.js';
import {floorGeojson} from './floorGeojson.js';
const origin={latitude:28,longitude:77},dimensions={drawingWidthPixels:800,drawingHeightPixels:1000};
function fixture(){
  const features=[],labels=[];
  for(let i=0;i<9;i++){
    const x=20+(i%3)*80,y=20+Math.floor(i/3)*100,name=`A${301+i}`;
    const geographic=(x,y)=>localToGeographic({x,y:-y},origin);
    features.push({id:name,properties:{floor:1,type:'Store',name,centroid:geographic(x,y)},geometry:{type:'Polygon',coordinates:[[[x-8,y-8],[x+8,y-8],[x+8,y+8],[x-8,y+8],[x-8,y-8]].map(([x,y])=>geographic(x,y))]}});
    labels.push({text:name,x:2*x-.3*y+100-10,y:.3*x+2*y+150+5,width:20,height:10});
  }
  const payload={features},reference=annotatedReference(payload,1,annotationSetup(payload,1));
  return {reference,labels};
}
test('room labels correct translation, rotation and page margins with outlier rejection',()=>{
  const {reference,labels}=fixture();labels[8]={...labels[8],x:750,y:950};
  const aligned=alignAnnotatedReference(reference,labels,dimensions),m=aligned.alignment.geoToNormalizedPdf;
  assert.equal(aligned.alignment.matchedLabels,8);
  assert.ok(aligned.alignment.rmsPixels<.001);
  const coordinate=reference.features[0].properties.centroid;
  const lon=coordinate[0]-aligned.alignment.origin[0],lat=coordinate[1]-aligned.alignment.origin[1];
  const x=(lon*m[0][0]+lat*m[1][0]+m[2][0])*800,y=(lon*m[0][1]+lat*m[1][1]+m[2][1])*1000;
  assert.ok(Math.abs(x-134)<.001,`x=${x}`);assert.ok(Math.abs(y-196)<.001,`y=${y}`);
  const exported=floorGeojson({widthMeters:aligned.alignment.widthMeters,drawingWidthPixels:800,drawingHeightPixels:1000,annotationAlignment:aligned.alignment,objects:[{id:'point',type:'poi',x,y}]});
  assert.ok(Math.abs(exported.features[0].geometry.coordinates[0]-coordinate[0])<1e-9);
  assert.ok(Math.abs(exported.features[0].geometry.coordinates[1]-coordinate[1])<1e-9);
});
test('insufficient or inconsistent label matches cannot claim automatic alignment',()=>{
  const {reference,labels}=fixture();
  assert.throws(()=>alignAnnotatedReference(reference,labels.slice(0,2),dimensions),/at least 3/);
  assert.throws(()=>alignAnnotatedReference(reference,labels.map((l,i)=>({...l,x:(i*i*117)%800,y:(i*379)%1000})),dimensions),/consistently match/);
});

test('room identifiers adapt to auditorium, food court and hyphenated names',async()=>{
  const {roomCodes}=await import('./annotationAlignment.js');
  assert.deepEqual(roomCodes('Audi 2, FC1, FC17A, E-503, A 501B'),['AUDI2','FC1','FC17A','E503','A501B']);
  const {reference,labels}=fixture();
  const names=['Audi 1','Audi 2','Audi 3','FC1','FC2','FC17A','E-503','A 501B','F506'];
  reference.features.forEach((f,i)=>f.properties.name=names[i]);labels.forEach((l,i)=>l.text=names[i]);
  assert.equal(alignAnnotatedReference(reference,labels,dimensions).alignment.matchedLabels,9);
});
