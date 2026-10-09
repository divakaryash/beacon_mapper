import assert from "node:assert/strict";
import test from "node:test";
import { boundsOf, measurements, moveObject, polygonArea, polygonPerimeter } from "./geometry.js";
import { fitView, snapPoint, zoomView } from "./coordinates.js";

const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

test("measures closed geometry in calibrated units", () => {
  assert.equal(polygonArea(square), 10_000);
  assert.equal(polygonPerimeter(square), 400);
  const result = measurements({ type: "room", points: square }, 0.1);
  assert.ok(Math.abs(result.area - 100) < Number.EPSILON * 100);
  assert.equal(result.perimeter, 40);
});

test("moves and bounds vector objects", () => {
  assert.deepEqual(boundsOf(moveObject({ type: "polygon", points: square }, 10, -5)), { x: 10, y: -5, width: 100, height: 100 });
});

test("snaps, zooms, and fits coordinates predictably", () => {
  assert.deepEqual(snapPoint({ x: 19, y: 31 }, 10), { x: 20, y: 30 });
  assert.deepEqual(zoomView({ x: 0, y: 0, width: 100, height: 100 }, 2, { x: 50, y: 50 }), { x: 25, y: 25, width: 50, height: 50 });
  assert.deepEqual(fitView(1000, 500, 1000, 500, 0), { x: 0, y: 0, width: 1000, height: 500 });
});

test("polygon labels use actual irregular area and perimeter and reject invalid scale", () => {
  const triangle={type:"polygon",points:[{x:0,y:0},{x:40,y:0},{x:0,y:30}],rotation:35};
  assert.deepEqual(measurements(triangle,.1),{area:6.000000000000001,perimeter:12,length:null});
  assert.equal(measurements(triangle,.2).area,measurements(triangle,.1).area*4);
  for(const scale of [0,-1,Infinity,NaN])assert.equal(measurements(triangle,scale).area,null);
});

test('moving an irregular room vertex changes its outline without moving other vertices',async()=>{
  const {moveVertex,measurements}=await import('./geometry.js');
  const object={type:'room',points:[{x:0,y:0},{x:10,y:0},{x:10,y:4},{x:4,y:4},{x:4,y:10},{x:0,y:10}]};
  const moved=moveVertex(object,3,{x:6,y:5});
  assert.equal(moved.points.length,6);assert.deepEqual(moved.points[3],{x:6,y:5});assert.deepEqual(moved.points[2],object.points[2]);
  assert.notEqual(measurements(moved,1).area,measurements(object,1).area);
  assert.deepEqual(object.points[3],{x:4,y:4});assert.throws(()=>moveVertex(object,-1,{x:0,y:0}));
});

test('moving, resizing and editing a rotated wall preserves its holes',async()=>{
  const {moveObject,resizeObject,moveVertex,measurements}=await import('./geometry.js');
  const points=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],holes=[[{x:2,y:2},{x:8,y:2},{x:8,y:8},{x:2,y:8}]];
  const wall={type:'nonWalkableArea',points,holes};
  assert.equal(measurements(wall,1).area,64);
  assert.deepEqual(moveObject(wall,5,3).holes[0][0],{x:7,y:5});
  assert.deepEqual(resizeObject(wall,'se',{x:20,y:20}).holes[0][0],{x:4,y:4});
  const edited=moveVertex({...wall,rotation:90},0,{x:10,y:1});
  assert.equal(edited.rotation,0);assert.ok(Math.abs(edited.holes[0][0].x-8)<1e-9);
});

test('pixel stair steps simplify into diagonal edges without losing major corners',async()=>{
  const {simplifyContour}=await import('./geometry.js');
  const points=[{x:0,y:0},{x:20,y:0},{x:20,y:20}];
  for(let i=19;i>=0;i--){points.push({x:i+1,y:i},{x:i,y:i});}
  const smooth=simplifyContour(points,.8);
  assert.ok(smooth.length<8);assert.ok(smooth.some((p,i)=>{const q=smooth[(i+1)%smooth.length];return Math.abs(q.x-p.x)>10&&Math.abs(q.y-p.y)>10;}));
  assert.deepEqual(simplifyContour([{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],.8),[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]);
});

test('straight-wall fitting removes one-cell jitter and preserves a real room recess',async()=>{
  const {simplifyContour}=await import('./geometry.js');
  const points=[{x:0,y:0},{x:40,y:0}];
  for(let y=2;y<=40;y+=2)points.push({x:40+(y%4?1:0),y});
  points.push({x:25,y:40},{x:25,y:28},{x:15,y:28},{x:15,y:40},{x:0,y:40});
  const result=simplifyContour(points,1.25);
  assert.ok(result.length<=9);
  for(const corner of [{x:25,y:28},{x:15,y:28}])assert.ok(result.some(p=>p.x===corner.x&&p.y===corner.y));
});
