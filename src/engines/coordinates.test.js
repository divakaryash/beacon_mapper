import test from 'node:test';
import assert from 'node:assert/strict';
import { clientToWorld, snapPoint } from './coordinates.js';

test('unsnapped browser points become serializable engine coordinates', () => {
  class BrowserPoint { constructor() { this.x = 12; this.y = 34; } }
  const svg = { createSVGPoint: () => ({ matrixTransform: () => new BrowserPoint() }), getScreenCTM: () => ({ inverse: () => ({}) }) };
  const point = snapPoint(clientToWorld({ clientX: 1, clientY: 2 }, svg), 20, false);
  assert.equal(Object.getPrototypeOf(point), Object.prototype);
  assert.deepEqual(structuredClone(point), { x: 12, y: 34 });
});
