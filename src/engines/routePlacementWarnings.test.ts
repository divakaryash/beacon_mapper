import test from 'node:test';
import assert from 'node:assert/strict';
import { routePlacementWarnings } from './routePlacementWarnings.js';

function spacingWarnings(gap: number, maximumSpacing = 10) {
  const nodes = [0, gap / 2, gap].map((x, i) => ({ id: `n${i}`, floorId: 'f', x, y: 0, worldX: x, worldY: 0 }));
  const graph = { nodes, edges: [
    { id: 'a', source: 'n0', target: 'n1', distance: gap / 2 },
    { id: 'b', source: 'n1', target: 'n2', distance: gap / 2 },
  ] };
  const beacons = [nodes[0], nodes[2]].map(n => ({ ...n, nodeId: n.id, enabled: true }));
  return routePlacementWarnings({ graph, beacons, maximumSpacing });
}

test('red spacing lines start at 1 m above the maximum, including across waypoint edges', () => {
  for (const gap of [6, 10, 10.2, 10.8, 10.99]) assert.deepEqual(spacingWarnings(gap), [], `gap ${gap}`);
  for (const gap of [11, 11.2, 15]) {
    const warnings = spacingWarnings(gap);
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every(w => w.kind === 'spacing' && w.length === gap && w.maximumSpacing === 10));
  }
});

test('the red-line tolerance follows the configured maximum', () => {
  assert.deepEqual(spacingWarnings(8.8, 8), []);
  assert.equal(spacingWarnings(9, 8).length, 2);
});

test('missed-junction red lines keep their existing coverage check', () => {
  const nodes = [[0,0], [2,0], [-2,0], [0,2]].map(([x,y], i) => ({ id: `n${i}`, floorId:'f', x, y, worldX:x, worldY:y }));
  const graph = { nodes, edges: nodes.slice(1).map(n => ({ id:n.id, source:'n0', target:n.id, distance:2 })) };
  const warnings = routePlacementWarnings({ graph });
  assert.equal(warnings.length, 3);
  assert.ok(warnings.every(w => w.reason.startsWith('Missed junction')));
});
