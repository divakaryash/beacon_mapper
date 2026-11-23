import test from 'node:test';
import assert from 'node:assert/strict';
import { placeByRules } from './rulePlacement.js';
import { compileFloorGeometry, beaconGeometryConflict, visibleAcrossPhysicalWalls } from './floorGeometry.js';
import { DeploymentPlanner } from './deploymentPlanner.js';

const node = (id: string, worldX: number, worldY = 0, type = 'Corridor', floorId = 'f') =>
  ({ id, floorId, x: worldX, y: worldY, worldX, worldY, type });
const edge = (a: ReturnType<typeof node>, b: ReturnType<typeof node>, id = `${a.id}-${b.id}`) =>
  ({ id, source: a.id, target: b.id, distance: Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY) });
const rectangle = (x: number, y: number, w: number, h: number) =>
  [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const floorGeometry = { floors: [{ floorId: 'f', boundaries: [rectangle(-10, -30, 150, 80)], walkableAreas: [rectangle(-10, -30, 150, 80)] }] };
const floors = compileFloorGeometry(floorGeometry);
const corridor = (length: number, step = length) => {
  const nodes = Array.from({ length: Math.ceil(length / step) + 1 }, (_, i) => node(`n${i}`, Math.min(length, i * step)));
  return { nodes, edges: nodes.slice(1).map((b, i) => edge(nodes[i], b)) };
};
function verify(graph: ReturnType<typeof corridor>, result: ReturnType<typeof placeByRules>, geometry = floors) {
  const active = result.beacons.filter(b => b.enabled !== false);
  for (const b of active) assert.equal(beaconGeometryConflict({ x: b.worldX, y: b.worldY }, geometry.get(b.floorId)), null);
  for (let i = 0; i < active.length; i++) for (const b of active.slice(i + 1)) {
    const a = active[i];
    if (a.floorId === b.floorId && visibleAcrossPhysicalWalls({ x: a.worldX, y: a.worldY }, { x: b.worldX, y: b.worldY }, geometry.get(a.floorId)))
      assert.ok(Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY) >= 6 - 1e-6, `spacing ${a.worldX},${a.worldY} to ${b.worldX},${b.worldY}`);
  }
  for (const e of graph.edges) {
    const a = graph.nodes.find(n => n.id === e.source)!, b = graph.nodes.find(n => n.id === e.target)!;
    if (a.floorId !== b.floorId) continue;
    const count = Math.ceil(e.distance / .25);
    for (let i = 0; i <= count; i++) {
      const p = { x: a.worldX + (b.worldX - a.worldX) * i / count, y: a.worldY + (b.worldY - a.worldY) * i / count };
      assert.ok(active.some(beacon => beacon.floorId === a.floorId && Math.hypot(beacon.worldX - p.x, beacon.worldY - p.y) <= Math.min(6, beacon.reliableRadius ?? 6) + 1e-6 &&
        visibleAcrossPhysicalWalls({ x: beacon.worldX, y: beacon.worldY }, p, geometry.get(a.floorId))), `uncovered ${p.x},${p.y}`);
    }
  }
  assert.deepEqual(result.unresolved, []);
}

test('dead ends precede corridor filling, stay 2–4 m inward, and repair feasible spacing', () => {
  for (let length = 6; length <= 80; length++) {
    const graph = corridor(length), result = placeByRules({ graph, floors });
    verify(graph, result);
    const stations = result.beacons.map(b => b.worldX).sort((a, b) => a - b);
    assert.ok(stations.every(x => x >= 2 && x <= length - 2));
    for (let i = 1; i < stations.length; i++) assert.ok(stations[i] - stations[i - 1] <= 10 + 1e-6, `length ${length}, ${stations}`);
    for (const b of result.beacons.filter(b => b.placementRule === 'Dead end'))
      assert.ok(Math.min(b.worldX, length - b.worldX) <= 4 + 1e-6);
    assert.deepEqual(result.warnings, [], `length ${length}`);
  }
});

test('dense degree-two waypoints and reversed edges do not change placement', () => {
  const sparse = placeByRules({ graph: corridor(40), floors });
  const graph = corridor(40, .5);
  graph.edges = graph.edges.map(e => ({ ...e, source: e.target, target: e.source }));
  const dense = placeByRules({ graph, floors });
  verify(graph, dense);
  assert.deepEqual(dense.beacons.map(b => b.worldX).sort((a,b) => a-b), sparse.beacons.map(b => b.worldX).sort((a,b) => a-b));
});

test('P1 then junction/key POIs then room entrances then regular coverage', () => {
  const a = node('a', 0), lift = node('lift', 12, 0, 'Lift'), j = node('j', 24), b = node('b', 50), c = node('c', 24, 24);
  const room = node('room', 40, 0, 'Room Entrance');
  const graph = { nodes: [room, c, b, j, lift, a], edges: [edge(a,lift), edge(lift,j), edge(j,room), edge(room,b), edge(j,c)] };
  const pois = [ { ...node('reception', 25, 1), category: 'Reception' }, { ...node('cafeteria', 24, 16), category: 'Cafeteria' } ];
  const result = placeByRules({ graph, floors, pois });
  verify(graph, result);
  assert.deepEqual(result.beacons.map(b => b.placementPriority), [...result.beacons.map(b => b.placementPriority)].sort());
  assert.equal(result.beacons.find(b => b.placementRule === 'Floor connector')?.worldX, 12);
  const junction = result.beacons.find(b => b.placementRule === 'Junction');
  assert.equal(junction?.worldX, 24);
  assert.equal(junction?.worldY, 0);
  assert.ok(junction?.servedTargets.some(t => t.id === 'reception'));
  assert.ok(result.beacons.some(b => b.servedTargets?.some(t => t.id === 'room')));
});

test('preserved beacons remain byte-for-byte unchanged, even with a spacing conflict', () => {
  const graph = corridor(30);
  const preserved = [
    { ...node('manual', 3), nodeId: undefined, edgeId: graph.edges[0].id, edgeOffset: 3, origin: 'manual', enabled: true, locked: true, reliableRadius: 6 },
    { ...node('locked', 5), nodeId: undefined, edgeId: graph.edges[0].id, edgeOffset: 5, origin: 'automatic', enabled: true, locked: true, reliableRadius: 6 },
    { ...node('disabled', 18), origin: 'manual', enabled: false, locked: true },
  ].map(b => Object.freeze(b));
  const before = JSON.stringify(preserved);
  const result = placeByRules({ graph, floors, preserved });
  assert.equal(JSON.stringify(preserved), before);
  preserved.forEach(b => assert.ok(result.beacons.includes(b)));
  assert.ok(result.warnings.some(w => w.code === 'preserved-spacing-conflict'));
});

test('short-radius preserved beacon does not falsely serve a target', () => {
  const graph = corridor(30), pois = [{ ...node('reception', 11), category: 'Reception' }];
  const preserved = [{ ...node('small', 5), edgeId: graph.edges[0].id, edgeOffset: 5, reliableRadius: 1, enabled: true, locked: true }];
  const result = placeByRules({ graph, floors, pois, preserved });
  assert.ok(result.beacons.some(b => b.servedTargets?.some(t => t.id === 'reception')));
  assert.ok(result.warnings.some(w => w.code === 'route-coverage-unresolved'));
});

test('walls keep adjacent corridors independent and all generated positions walkable', () => {
  const a = node('a',0,-2), b = node('b',30,-2), c = node('c',0,2), d = node('d',30,2);
  const graph = { nodes: [a,b,c,d], edges: [edge(a,b), edge(c,d)] };
  const geometry = compileFloorGeometry({ floors: [{ ...floorGeometry.floors[0],
    walkableAreas: [rectangle(-1,-3,32,2), rectangle(-1,1,32,2)],
    walls: [{ points: [{x:-2,y:0},{x:32,y:0}], width: .2 }],
  }] });
  const result = placeByRules({ graph, floors: geometry });
  verify(graph, result, geometry);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.beacons.some(b => b.worldY === -2));
  assert.ok(result.beacons.some(b => b.worldY === 2));
});

test('a floor connector cannot move to satisfy a lower priority spacing gap', () => {
  const graph = corridor(30, 5);
  graph.nodes[2].type = 'Lift'; graph.nodes[4].type = 'Stairs';
  const result = placeByRules({ graph, floors });
  assert.deepEqual(result.beacons.filter(b => b.placementRule === 'Floor connector').map(b => b.worldX), [10,20]);
  verify(graph, result);
});

test('automatic generation retains manual beacons through the planner caller', () => {
  const graph = corridor(30);
  const planner = new DeploymentPlanner({ graph, floorGeometry, settings: { planningMode: 'automatic' },
    beacons: [{ ...node('manual', 3), type: 'Navigation', origin: 'manual', enabled: true, edgeId: graph.edges[0].id, edgeOffset: 3 }] });
  const before = { ...planner.beacons[0] };
  planner.generate();
  assert.deepEqual(planner.beacons.find(b => b.id === before.id), before);
});

test('bent walkable routes repair reliable coverage as well as route spacing', () => {
  const a = node('a', 0), bend = node('bend', 15), b = node('b', 15, 15);
  const graph = { nodes: [a,bend,b], edges: [edge(a,bend), edge(bend,b)] };
  const geometry = compileFloorGeometry({ floors: [{ ...floorGeometry.floors[0],
    walkableAreas: [rectangle(-1,-1,17,2), rectangle(14,-1,2,17)],
  }] });
  const result = placeByRules({ graph, floors: geometry });
  verify(graph, result, geometry);
  assert.deepEqual(result.warnings, []);
});

test('vertical links are not treated as same-floor paths and P1 covers both floors', () => {
  const a = node('a',0), lift1 = node('lift1',12,0,'Lift'),
    b = node('b',0,0,'Corridor','upper'), lift2 = node('lift2',12,0,'Lift','upper');
  const graph = { nodes: [a,lift1,b,lift2], edges: [edge(a,lift1), edge(b,lift2), {...edge(lift1,lift2),distance:4}] };
  const geometry = compileFloorGeometry({ floors: [floorGeometry.floors[0], {...floorGeometry.floors[0],floorId:'upper'}] });
  const result = placeByRules({ graph, floors: geometry });
  verify(graph, result, geometry);
  assert.deepEqual(new Set(result.beacons.filter(b => b.placementPriority === 1).map(b => b.floorId)), new Set(['f','upper']));
  assert.ok(result.beacons.every(b => b.worldX >= 2 && b.worldX <= 10));
});

test('a valid retry serves a POI when its nearest position violates spacing', () => {
  const graph = corridor(30), pois = [{ ...node('reception',8), category:'Reception' }];
  const preserved = [{ ...node('manual',3), edgeId:graph.edges[0].id,edgeOffset:3,reliableRadius:2,enabled:true,locked:true }];
  const result = placeByRules({ graph, floors, pois, preserved });
  const reception = result.beacons.find(b => b.servedTargets?.some(t => t.id === 'reception'));
  assert.ok(reception);
  assert.ok(reception.worldX >= 9);
  assert.ok(!result.warnings.some(w => w.targetId === 'reception'));
});

test('infeasible fixed anchors are retained with an honest spacing warning', () => {
  const graph = corridor(30);
  const preserved = [3,14,27].map((x,i) => ({ ...node(`locked${i}`,x),edgeId:graph.edges[0].id,edgeOffset:x,enabled:true,locked:true,reliableRadius:6 }));
  const result = placeByRules({ graph, floors, preserved });
  assert.ok(result.unresolved.some(g => g.length === 11));
  assert.ok(result.warnings.some(w => w.code === 'actual-beacon-gap'));
  assert.deepEqual(result.beacons.slice(0,3), preserved);
});

test('coverage repairs a winding route around a physical wall', () => {
  const a = node('a',0,-2), b = node('b',20,-2), c = node('c',20,2), d = node('d',0,2);
  const graph = { nodes:[a,b,c,d], edges:[edge(a,b),edge(b,c),edge(c,d)] };
  const geometry = compileFloorGeometry({ floors:[{ ...floorGeometry.floors[0],
    walls:[{ points:[{x:-2,y:0},{x:18,y:0}],width:.2 }],
  }] });
  const result = placeByRules({ graph, floors:geometry });
  verify(graph, result, geometry);
  assert.deepEqual(result.warnings, []);
});
