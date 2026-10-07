import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { generateGraphFromWalkablePaths, NavigationGraph } from "./navigationGraph.js";

function node(id, x, y, floorId = "floor-1", type = "Corridor") {
  return { id, x: x * 10, y: y * 10, worldX: x, worldY: y, floorId, type };
}

test("creates measured edges and prevents duplicates", () => {
  const graph = new NavigationGraph();
  graph.addNode(node("a", 0, 0));
  graph.addNode(node("b", 3, 4));
  const first = graph.addEdge({ source: "a", target: "b" });
  const duplicate = graph.addEdge({ source: "b", target: "a" });
  assert.equal(first.edge.distance, 5);
  assert.equal(duplicate.created, false);
  assert.equal(graph.edges.size, 1);
});

test("snaps duplicate nodes and merges adjacent edges", () => {
  const graph = new NavigationGraph();
  graph.addNode(node("a", 0, 0));
  graph.addNode(node("middle", 1, 0));
  graph.addNode(node("b", 2, 0));
  const snapped = graph.addNode(node("duplicate", 1.04, 0), { snapDistance: 0.1 });
  assert.equal(snapped.node.id, "middle");
  const first = graph.addEdge({ id: "first", source: "a", target: "middle" }).edge;
  const second = graph.addEdge({ id: "second", source: "middle", target: "b" }).edge;
  const merged = graph.mergeEdges(first.id, second.id);
  assert.equal(graph.nodes.has("middle"), false);
  assert.equal(merged.distance, 2);
  assert.deepEqual(new Set([merged.source, merged.target]), new Set(["a", "b"]));
});

test("Dijkstra and A* return the same shortest route", () => {
  const graph = new NavigationGraph();
  for (const item of [node("a", 0, 0), node("b", 1, 0), node("c", 2, 0), node("detour", 1, 3)]) graph.addNode(item);
  graph.addEdge({ id: "ab", source: "a", target: "b" });
  graph.addEdge({ id: "bc", source: "b", target: "c" });
  graph.addEdge({ source: "a", target: "detour" });
  graph.addEdge({ source: "detour", target: "c" });
  const dijkstra = graph.route("a", "c", { algorithm: "dijkstra", walkingSpeedMps: 1 });
  const astar = graph.route("a", "c", { algorithm: "astar", walkingSpeedMps: 1 });
  assert.deepEqual(dijkstra.nodeIds, ["a", "b", "c"]);
  assert.deepEqual(astar.nodeIds, dijkstra.nodeIds);
  assert.equal(astar.totalDistance, 2);
  assert.equal(astar.estimatedWalkingTime, 2);
});

test("merges nodes while preserving incident connectivity", () => {
  const graph = new NavigationGraph({nodes:[node("a",0,0),node("b",.01,0),node("c",2,0)],edges:[{source:"b",target:"c"}]});
  graph.mergeNodes("b","a");
  assert.deepEqual(graph.route("a","c").nodeIds,["a","c"]);
  assert.equal(graph.nodes.size,2);
});

test("directed splitting and merging preserve permitted travel", () => {
  const graph = new NavigationGraph({nodes:[node("a",0,0),node("b",5,0)],edges:[{id:"ab",source:"a",target:"b",direction:"forward"}]});
  const split=graph.splitEdge("ab",{ratio:.4});
  assert.equal(graph.route("b","a"),null);
  assert.equal(graph.route("a","b").totalDistance,5);
  graph.mergeEdges(split.edges[0].id,split.edges[1].id);
  assert.equal(graph.route("b","a"),null);
  assert.equal(graph.route("a","b").totalDistance,5);
});

test("A* remains optimal with cheap custom edge costs", () => {
  const graph=new NavigationGraph({nodes:[node("a",0,0),node("b",100,0),node("c",2,0)],edges:[{source:"a",target:"c",distance:10},{source:"a",target:"b",distance:1},{source:"b",target:"c",distance:1}]});
  assert.equal(graph.route("a","c").totalDistance,2);
});

test("supports accessible multi-floor routing and stair avoidance", () => {
  const graph = new NavigationGraph();
  for (const item of [
    node("start", 0, 0, "floor-1"), node("stairs-1", 1, 0, "floor-1", "Stairs"), node("stairs-2", 1, 0, "floor-2", "Stairs"),
    node("lift-1", 3, 0, "floor-1", "Lift"), node("lift-2", 3, 0, "floor-2", "Lift"), node("target", 4, 0, "floor-2"),
  ]) graph.addNode(item);
  graph.addEdge({ source: "start", target: "stairs-1" });
  graph.addEdge({ source: "stairs-1", target: "stairs-2", distance: 3, edgeType: "Stair Connection", accessibility: false });
  graph.addEdge({ source: "stairs-2", target: "target" });
  graph.addEdge({ source: "start", target: "lift-1" });
  graph.addEdge({ source: "lift-1", target: "lift-2", distance: 4, edgeType: "Lift Connection" });
  graph.addEdge({ source: "lift-2", target: "target" });
  const route = graph.route("start", "target", { accessibleOnly: true, avoidStairs: true, preferLifts: true });
  assert.deepEqual(route.nodeIds, ["start", "lift-1", "lift-2", "target"]);
  assert.equal(route.totalDistance, 8);
});

test("validates duplicate, isolated, disconnected, loop, and zero-length data", () => {
  const graph = new NavigationGraph();
  graph.addNode(node("a", 0, 0));
  graph.addNode(node("duplicate", 0.01, 0));
  graph.addNode(node("isolated", 5, 5));
  graph.edges.set("bad", { id: "bad", source: "a", target: "a", distance: 0, accessibility: true, direction: "both", edgeType: "Walkway" });
  graph.adjacency.get("a").add("bad");
  const codes = new Set(graph.validate().warnings.map((warning) => warning.code));
  assert.ok(codes.has("duplicate-node"));
  assert.ok(codes.has("isolated-node"));
  assert.ok(codes.has("disconnected-components"));
  assert.ok(codes.has("invalid-loop"));
  assert.ok(codes.has("zero-length-edge"));
});

test("generates editable nodes at path intersections and intermediate spacing", () => {
  const graph = generateGraphFromWalkablePaths([
    { floorId: "floor-1", points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
    { floorId: "floor-1", points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] },
  ], { metersPerPixel: 0.1, spacingMeters: 2.5 });
  const junctions = [...graph.nodes.values()].filter((item) => item.type === "Junction");
  assert.equal(junctions.length, 1);
  assert.ok(graph.nodes.size >= 9);
  assert.equal(graph.validate().stats.components, 1);
});

test("handles 10,000 nodes and roughly 20,000 edges within an interactive budget", () => {
  const started = performance.now();
  const graph = new NavigationGraph();
  const size = 100;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) graph.addNode(node(`${x}:${y}`, x, y));
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (x + 1 < size) graph.addEdge({ source: `${x}:${y}`, target: `${x + 1}:${y}` });
    if (y + 1 < size) graph.addEdge({ source: `${x}:${y}`, target: `${x}:${y + 1}` });
  }
  const builtMs = performance.now() - started;
  const routeStarted = performance.now();
  const route = graph.route("0:0", "99:99");
  const routeMs = performance.now() - routeStarted;
  assert.equal(graph.nodes.size, 10_000);
  assert.equal(graph.edges.size, 19_800);
  assert.equal(route.totalDistance, 198);
  assert.ok(builtMs < 5_000, `build took ${builtMs.toFixed(0)} ms`);
  assert.ok(routeMs < 1_000, `route took ${routeMs.toFixed(0)} ms`);
  console.log(`graph benchmark: build ${builtMs.toFixed(1)} ms, route ${routeMs.toFixed(1)} ms, visited ${route.visited}`);
});
