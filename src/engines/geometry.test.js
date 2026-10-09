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
