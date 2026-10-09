import test from 'node:test';
import assert from 'node:assert/strict';
import {facilityBlocks} from './facilityBlocks.js';

test('treads near a stair label form one block rather than one polygon per step',()=>{
  const width=120,height=60,ink=new Uint8Array(width*height);
  for(let y=15;y<=33;y+=3)for(let x=20;x<40;x++)ink[y*width+x]=1;
  const label={text:'STAIRS',x:20,y:43,width:20,height:5};
  const blocks=facilityBlocks(ink,width,height,[label]);
  assert.equal(blocks.length,1);assert.equal(blocks[0].type,'Stairs');assert.equal(blocks[0].w,20);
  assert.equal(facilityBlocks(ink,width,height,[{...label,text:'ZARA'}]).length,0);
});

test('an unlabeled assembly with repeated treads and two rails is one reviewable block',()=>{
  const width=120,height=60,ink=new Uint8Array(width*height);
  for(let y=15;y<=33;y++)for(const x of [20,39])ink[y*width+x]=1;
  for(let y=15;y<=33;y+=3)for(let x=20;x<40;x++)ink[y*width+x]=1;
  const blocks=facilityBlocks(ink,width,height,[]);
  assert.equal(blocks.length,1);assert.equal(blocks[0].needsReview,true);assert.equal(blocks[0].type,'Vertical circulation');
});
