import test from 'node:test';
import assert from 'node:assert/strict';
import {labelsFromRecognition} from './floorPlanLabels.js';

test('OCR labels retain confident names and positions, excluding noise and invalid boxes',()=>{
  const data={blocks:[{paragraphs:[{lines:[{words:[{text:'LIFESTYLE',confidence:94,bbox:{x0:10,y0:20,x1:90,y1:40}},{text:'garbage',confidence:20,bbox:{x0:95,y0:20,x1:110,y1:40}}]},{words:[{text:'bad',confidence:95,bbox:{x0:0,y0:0,x1:Infinity,y1:2}}]}]}]}]};
  assert.deepEqual(labelsFromRecognition(data,200,100,400,200),[{text:'LIFESTYLE',x:20,y:80,width:160,height:40,confidence:94,source:'ocr'}]);
});

test('OCR preprocessing removes enclosing rules without modifying the source or short letters',async()=>{
  const {textRecognitionRaster}=await import('./floorPlanLabels.js');
  const width=100,height=80,data=new Uint8ClampedArray(width*height*4).fill(255);
  const ink=(x,y)=>{const p=(y*width+x)*4;data[p]=data[p+1]=data[p+2]=0;};
  for(let x=5;x<95;x++)ink(x,10);
  for(let y=25;y<40;y++)ink(20,y);
  const output=textRecognitionRaster(data,width,height);
  assert.equal(output[(10*width+50)*4],255);assert.equal(output[(30*width+20)*4],0);assert.equal(data[(10*width+50)*4],0);
});
