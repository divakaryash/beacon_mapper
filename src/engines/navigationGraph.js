import { distance, boundsOf, rotatedPoint } from "./geometry.js";

export const NODE_TYPES = ["Corridor", "Junction", "Entrance", "Exit", "Lift", "Escalator", "Stairs", "Room Entrance", "Landmark", "Custom"];
export const EDGE_TYPES = ["Walkway", "Lift Connection", "Stair Connection", "Escalator Connection", "Outdoor Path"];
export const EDGE_DIRECTIONS = ["both", "forward", "reverse"];

let fallbackId = 0;
const id = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? ++fallbackId}`;
const spatialKey = (floorId, x, y, size) => `${floorId}:${Math.floor(x / size)}:${Math.floor(y / size)}`;

export function createNode(input = {}) {
  const x = Number(input.x ?? 0);
  const y = Number(input.y ?? 0);
  return {
    id: input.id ?? id("node"),
    floorId: input.floorId ?? "floor-1",
    x,
    y,
    worldX: Number(input.worldX ?? x),
    worldY: Number(input.worldY ?? y),
    type: NODE_TYPES.includes(input.type) ? input.type : "Corridor",
    metadata: input.metadata ? { ...input.metadata } : {},
  };
}

export function createEdge(input, nodes) {
  const source = nodes.get(input.source);
  const target = nodes.get(input.target);
  if (!source || !target) throw new Error("Edge endpoints must exist");
  const measured = Math.hypot(target.worldX - source.worldX, target.worldY - source.worldY);
  return {
    id: input.id ?? id("edge"),
    source: input.source,
    target: input.target,
    distance: Number.isFinite(Number(input.distance)) ? Number(input.distance) : measured,
    accessibility: input.accessibility !== false,
    direction: EDGE_DIRECTIONS.includes(input.direction) ? input.direction : "both",
    edgeType: EDGE_TYPES.includes(input.edgeType) ? input.edgeType : "Walkway",
  };
}

export class NavigationGraph {
  constructor(data = {}, options = {}) {
    this.nodes = new Map();
    this.edges = new Map();
    this.adjacency = new Map();
    this.spatialCellSize = options.spatialCellSize ?? 1;
    this.spatial = new Map();
    this.importWarnings = [];
    for (const node of data.nodes ?? []) this.addNode(node, { snapDistance: 0 });
    for (const edge of data.edges ?? []) {
      try { this.addEdge(edge); } catch (error) { this.importWarnings.push(warning("invalid-edge", [edge.id], error.message)); }
    }
  }

  serialize() {
    return { nodes: [...this.nodes.values()], edges: [...this.edges.values()] };
  }

  addNode(input, { snapDistance = 0 } = {}) {
    const node = createNode(input);
    if (![node.x, node.y, node.worldX, node.worldY].every(Number.isFinite)) throw new Error("Node coordinates must be finite");
    const nearby = snapDistance > 0 && this.findNearbyNode(node.floorId, node.worldX, node.worldY, snapDistance);
    if (nearby) return { node: nearby, created: false };
    if (this.nodes.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
    this.nodes.set(node.id, node);
    this.adjacency.set(node.id, new Set());
    this.#index(node);
    return { node, created: true };
  }

  removeNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    for (const edgeId of [...this.adjacency.get(nodeId)]) this.removeEdge(edgeId);
    this.#unindex(node);
    this.adjacency.delete(nodeId);
    this.nodes.delete(nodeId);
    return true;
  }

  mergeNodes(sourceId, targetId) {
    const source = this.nodes.get(sourceId), target = this.nodes.get(targetId);
    if (!source || !target || sourceId === targetId || source.floorId !== target.floorId) throw new Error("Merge requires two distinct nodes on the same floor");
    const edges = [...this.adjacency.get(sourceId)].map(edgeId => this.edges.get(edgeId));
    this.removeNode(sourceId);
    for (const edge of edges) {
      const input = { ...edge, source:edge.source === sourceId ? targetId : edge.source, target:edge.target === sourceId ? targetId : edge.target };
      if (input.source === input.target) continue;
      if (input.edgeType === "Walkway") delete input.distance;
      this.addEdge(input);
    }
    return target;
  }

  moveNode(nodeId, patch) {
    const current = this.nodes.get(nodeId);
    if (!current) throw new Error(`Unknown node: ${nodeId}`);
    const node = createNode({ ...current, ...patch, id: nodeId });
    if (![node.x,node.y,node.worldX,node.worldY].every(Number.isFinite)) throw new Error("Node coordinates must be finite");
    this.#unindex(current);
    this.nodes.set(nodeId, node);
    this.#index(node);
    for (const edgeId of this.adjacency.get(nodeId)) {
      const edge = this.edges.get(edgeId);
      if (edge.edgeType === "Walkway" || edge.distance === 0) {
        const source = this.nodes.get(edge.source);
        const target = this.nodes.get(edge.target);
        this.edges.set(edgeId, { ...edge, distance: Math.hypot(target.worldX - source.worldX, target.worldY - source.worldY) });
      }
    }
    return node;
  }

  findNearbyNode(floorId, worldX, worldY, radius, excludeId = null) {
    const cells = Math.ceil(radius / this.spatialCellSize);
    const centerX = Math.floor(worldX / this.spatialCellSize);
    const centerY = Math.floor(worldY / this.spatialCellSize);
    let closest = null;
    let best = radius;
    for (let dx = -cells; dx <= cells; dx += 1) {
      for (let dy = -cells; dy <= cells; dy += 1) {
        for (const nodeId of this.spatial.get(`${floorId}:${centerX + dx}:${centerY + dy}`) ?? []) {
          if (nodeId === excludeId) continue;
          const node = this.nodes.get(nodeId);
          const candidate = Math.hypot(node.worldX - worldX, node.worldY - worldY);
          if (candidate <= best) { closest = node; best = candidate; }
        }
      }
    }
    return closest;
  }

  addEdge(input) {
    if (input.source === input.target) throw new Error("Self-loop edges are invalid");
    const duplicate = [...(this.adjacency.get(input.source) ?? [])].map((edgeId) => this.edges.get(edgeId)).find((edge) =>
      edge && ((edge.source === input.source && edge.target === input.target) || (edge.source === input.target && edge.target === input.source)) && edge.edgeType === (input.edgeType ?? "Walkway"));
    if (duplicate) return { edge: duplicate, created: false };
    const edge = createEdge(input, this.nodes);
    if (!Number.isFinite(edge.distance) || edge.distance <= 0) throw new Error("Edge distance must be finite and positive");
    if (this.edges.has(edge.id)) throw new Error(`Duplicate edge id: ${edge.id}`);
    this.edges.set(edge.id, edge);
    this.adjacency.get(edge.source).add(edge.id);
    this.adjacency.get(edge.target).add(edge.id);
    return { edge, created: true };
  }

  removeEdge(edgeId) {
    const edge = this.edges.get(edgeId);
    if (!edge) return false;
    this.adjacency.get(edge.source)?.delete(edgeId);
    this.adjacency.get(edge.target)?.delete(edgeId);
    this.edges.delete(edgeId);
    return true;
  }

  disconnect(source, target) {
    let removed = 0;
    for (const edgeId of [...(this.adjacency.get(source) ?? [])]) {
      const edge = this.edges.get(edgeId);
      if ((edge.source === source && edge.target === target) || (edge.source === target && edge.target === source)) {
        this.removeEdge(edgeId);
        removed += 1;
      }
    }
    return removed;
  }

  splitEdge(edgeId, nodeInput) {
    const edge = this.edges.get(edgeId);
    if (!edge) throw new Error(`Unknown edge: ${edgeId}`);
    const source = this.nodes.get(edge.source);
    const target = this.nodes.get(edge.target);
    const ratio = Number.isFinite(nodeInput.ratio) ? nodeInput.ratio : 0.5;
    if (ratio <= 0 || ratio >= 1) throw new Error("Split must be inside the edge");
    const inserted = this.addNode({
      floorId: source.floorId,
      x: source.x + (target.x - source.x) * ratio,
      y: source.y + (target.y - source.y) * ratio,
      worldX: source.worldX + (target.worldX - source.worldX) * ratio,
      worldY: source.worldY + (target.worldY - source.worldY) * ratio,
      type: "Corridor",
      ...nodeInput,
    }).node;
    this.removeEdge(edgeId);
    const properties = { accessibility: edge.accessibility, direction: edge.direction, edgeType: edge.edgeType };
    const first = this.addEdge({ source: source.id, target: inserted.id, distance: edge.distance * ratio, ...properties }).edge;
    const second = this.addEdge({ source: inserted.id, target: target.id, distance: edge.distance * (1 - ratio), ...properties }).edge;
    return { node: inserted, edges: [first, second] };
  }

  mergeEdges(firstId, secondId) {
    const first = this.edges.get(firstId);
    const second = this.edges.get(secondId);
    if (!first || !second) throw new Error("Both edges must exist");
    const shared = [first.source, first.target].find((nodeId) => nodeId === second.source || nodeId === second.target);
    if (!shared || this.adjacency.get(shared).size !== 2) throw new Error("Edges must share a degree-two node");
    const source = first.source === shared ? first.target : first.source;
    const target = second.source === shared ? second.target : second.source;
    const permits = (edge, from, to) => (edge.source === from && edge.target === to && edge.direction !== "reverse") || (edge.target === from && edge.source === to && edge.direction !== "forward");
    const forward = permits(first, source, shared) && permits(second, shared, target);
    const reverse = permits(second, target, shared) && permits(first, shared, source);
    if (!forward && !reverse) throw new Error("Edge directions do not form a traversable chain");
    if (source === target || first.edgeType !== second.edgeType || first.accessibility !== second.accessibility) throw new Error("Merge requires compatible edges and distinct endpoints");
    const input = {
      source,
      target,
      distance: first.distance + second.distance,
      accessibility: first.accessibility && second.accessibility,
      direction: forward && reverse ? "both" : forward ? "forward" : "reverse",
      edgeType: first.edgeType === second.edgeType ? first.edgeType : "Walkway",
    };
    this.removeEdge(firstId);
    this.removeEdge(secondId);
    this.removeNode(shared);
    return this.addEdge(input).edge;
  }

  nearestNode(point, floorId = point.floorId ?? "floor-1") {
    let closest = null;
    let best = Infinity;
    for (const node of this.nodes.values()) {
      if (node.floorId !== floorId) continue;
      const candidate = Math.hypot(node.x - point.x, node.y - point.y);
      if (candidate < best) { closest = node; best = candidate; }
    }
    return closest;
  }

  route(startId, targetId, options = {}) {
    if (!this.nodes.has(startId) || !this.nodes.has(targetId)) return null;
    const algorithm = options.algorithm === "dijkstra" ? "dijkstra" : "astar";
    const speed = options.walkingSpeedMps ?? 1.35;
    const distances = new Map([[startId, 0]]);
    const previous = new Map();
    const queue = new MinHeap();
    queue.push(startId, 0);
    const target = this.nodes.get(targetId);
    // A geometric lower bound remains admissible even with custom connector costs.
    let heuristicScale = 1;
    for (const edge of this.edges.values()) {
      const a = this.nodes.get(edge.source), b = this.nodes.get(edge.target);
      const straight = Math.hypot(b.worldX - a.worldX, b.worldY - a.worldY);
      if (straight) heuristicScale = Math.min(heuristicScale, edge.distance / straight);
    }
    if (options.preferLifts) heuristicScale *= 0.85;
    const estimateFor = (node) => algorithm === "astar" ? Math.hypot(node.worldX - target.worldX, node.worldY - target.worldY) * heuristicScale : 0;
    let visited = 0;

    while (queue.size) {
      const { value: currentId, priority } = queue.pop();
      const currentDistance = distances.get(currentId);
      const expected = currentDistance + estimateFor(this.nodes.get(currentId));
      if (priority > expected + 1e-9) continue;
      visited += 1;
      if (currentId === targetId) break;
      for (const { nodeId, edge } of this.#neighbors(currentId, options)) {
        const cost = edge.distance * (options.preferLifts && edge.edgeType === "Lift Connection" ? 0.85 : 1);
        const next = currentDistance + cost;
        if (next >= (distances.get(nodeId) ?? Infinity)) continue;
        distances.set(nodeId, next);
        previous.set(nodeId, { nodeId: currentId, edgeId: edge.id });
        const estimate = estimateFor(this.nodes.get(nodeId));
        queue.push(nodeId, next + estimate);
      }
    }

    if (!distances.has(targetId)) return null;
    const nodeIds = [targetId];
    const edgeIds = [];
    while (nodeIds[0] !== startId) {
      const step = previous.get(nodeIds[0]);
      edgeIds.unshift(step.edgeId);
      nodeIds.unshift(step.nodeId);
    }
    const totalDistance = edgeIds.reduce((sum, edgeId) => sum + this.edges.get(edgeId).distance, 0);
    return { nodeIds, nodes: nodeIds.map((nodeId) => this.nodes.get(nodeId)), edgeIds, totalDistance, estimatedWalkingTime: totalDistance / speed, visited, algorithm };
  }

  validate({ duplicateTolerance = 0.05 } = {}) {
    const warnings = [...this.importWarnings];
    for (const node of this.nodes.values()) {
      if (!this.adjacency.get(node.id)?.size) warnings.push(warning("isolated-node", [node.id], `Node ${node.id} is isolated.`));
      const duplicate = this.findNearbyNode(node.floorId, node.worldX, node.worldY, duplicateTolerance, node.id);
      if (duplicate && node.id < duplicate.id) warnings.push(warning("duplicate-node", [node.id, duplicate.id], "Two nodes occupy the same location."));
    }
    for (const edge of this.edges.values()) {
      if (edge.source === edge.target) warnings.push(warning("invalid-loop", [edge.id], `Edge ${edge.id} loops to the same node.`));
      if (edge.distance <= 0) warnings.push(warning("zero-length-edge", [edge.id], `Edge ${edge.id} has zero length.`));
      if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) warnings.push(warning("missing-endpoint", [edge.id], `Edge ${edge.id} references a missing node.`));
    }
    const components = this.components();
    if (components.length > 1) warnings.push(warning("disconnected-components", components.flat(), `Graph has ${components.length} disconnected components.`));
    return { warnings, stats: { nodes: this.nodes.size, edges: this.edges.size, components: components.length, isolatedNodes: warnings.filter((item) => item.code === "isolated-node").length } };
  }

  components() {
    const unseen = new Set(this.nodes.keys());
    const result = [];
    while (unseen.size) {
      const start = unseen.values().next().value;
      const component = [];
      const queue = [start];
      unseen.delete(start);
      while (queue.length) {
        const current = queue.pop();
        component.push(current);
        for (const edgeId of this.adjacency.get(current) ?? []) {
          const edge = this.edges.get(edgeId);
          const neighbor = edge.source === current ? edge.target : edge.source;
          if (unseen.delete(neighbor)) queue.push(neighbor);
        }
      }
      result.push(component);
    }
    return result;
  }

  #neighbors(nodeId, options) {
    const result = [];
    for (const edgeId of this.adjacency.get(nodeId) ?? []) {
      const edge = this.edges.get(edgeId);
      if (options.accessibleOnly && edge.accessibility === false) continue;
      if (options.avoidStairs && edge.edgeType === "Stair Connection") continue;
      if (edge.source === nodeId && edge.direction !== "reverse") result.push({ nodeId: edge.target, edge });
      if (edge.target === nodeId && (edge.direction === "both" || edge.direction === "reverse")) result.push({ nodeId: edge.source, edge });
    }
    return result;
  }

  #index(node) {
    const key = spatialKey(node.floorId, node.worldX, node.worldY, this.spatialCellSize);
    if (!this.spatial.has(key)) this.spatial.set(key, new Set());
    this.spatial.get(key).add(node.id);
  }

  #unindex(node) {
    const key = spatialKey(node.floorId, node.worldX, node.worldY, this.spatialCellSize);
    this.spatial.get(key)?.delete(node.id);
    if (!this.spatial.get(key)?.size) this.spatial.delete(key);
  }
}

export function generateGraphFromWalkablePaths(paths, options = {}) {
  const metersPerPixel = Number(options.metersPerPixel) || 1;
  const spacingMeters = Number(options.spacingMeters) || 2.5;
  const spacingPixels = options.insertIntermediate === false ? Infinity : spacingMeters / metersPerPixel;
  const snapMeters = Number(options.snapDistanceMeters) || 0.15;
  const graph = new NavigationGraph({}, { spatialCellSize: Math.max(0.5, snapMeters * 2) });
  const segments = [];

  for (const path of paths) {
    const floorId = path.floorId ?? path.metadata?.floorId ?? "floor-1";
    const bounds = boundsOf(path);
    const center = {x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
    const points = (path.points || []).map(p => rotatedPoint(p,center,path.rotation || 0));
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      if (distance(a, b) > 0) segments.push({ a, b, floorId, cuts: [{ ...a }, { ...b }] });
    }
  }

  // ponytail: pairwise intersection checks suit small manual plans; use a sweep-line index if generation benchmarks require it.
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      if (segments[i].floorId !== segments[j].floorId) continue;
      const point = segmentIntersection(segments[i].a, segments[i].b, segments[j].a, segments[j].b);
      if (!point) {
        for (const endpoint of [segments[i].a,segments[i].b]) if (pointOnSegment(endpoint,segments[j].a,segments[j].b)) segments[j].cuts.push(endpoint);
        for (const endpoint of [segments[j].a,segments[j].b]) if (pointOnSegment(endpoint,segments[i].a,segments[i].b)) segments[i].cuts.push(endpoint);
        continue;
      }
      segments[i].cuts.push(point);
      segments[j].cuts.push(point);
    }
  }

  for (const segment of segments) {
    const segmentLength = distance(segment.a, segment.b);
    const ordered = uniquePoints(segment.cuts).sort((a, b) => distance(segment.a, a) - distance(segment.a, b));
    const expanded = [];
    for (let index = 1; index < ordered.length; index += 1) {
      const a = ordered[index - 1];
      const b = ordered[index];
      if (!expanded.length) expanded.push(a);
      const length = distance(a, b);
      const count = Math.floor(length / spacingPixels);
      for (let step = 1; step <= count; step += 1) {
        const ratio = Math.min(1, step * spacingPixels / length);
        if (ratio < 1) expanded.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio });
      }
      expanded.push(b);
    }
    let previous = null;
    for (const point of expanded) {
      const junction = segments.filter((candidate) => candidate.floorId === segment.floorId && pointOnSegment(point, candidate.a, candidate.b)).length > 1;
      const { node } = graph.addNode({
        floorId: segment.floorId,
        x: point.x,
        y: point.y,
        worldX: point.x * metersPerPixel,
        worldY: point.y * metersPerPixel,
        type: junction ? "Junction" : "Corridor",
        metadata: { generated: true },
      }, { snapDistance: snapMeters });
      if (previous && previous.id !== node.id) graph.addEdge({ source: previous.id, target: node.id, edgeType: "Walkway" });
      previous = node;
    }
    if (segmentLength === 0) continue;
  }
  return graph;
}

function segmentIntersection(a, b, c, d) {
  const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / denominator;
  const u = -((a.x - b.x) * (a.y - c.y) - (a.y - b.y) * (a.x - c.x)) / denominator;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function pointOnSegment(point, a, b) {
  const cross = Math.abs((point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y));
  return cross < 1e-5 && point.x >= Math.min(a.x, b.x) - 1e-5 && point.x <= Math.max(a.x, b.x) + 1e-5 && point.y >= Math.min(a.y, b.y) - 1e-5 && point.y <= Math.max(a.y, b.y) + 1e-5;
}

function uniquePoints(points) {
  const seen = new Set();
  return points.filter((point) => {
    const key = `${point.x.toFixed(6)}:${point.y.toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function heuristic(a, b) {
  return a.floorId === b.floorId ? Math.hypot(b.worldX - a.worldX, b.worldY - a.worldY) : 0;
}

function warning(code, ids, message) {
  return { code, ids, message, severity: code === "disconnected-components" ? "warning" : "error" };
}

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(value, priority) {
    const item = { value, priority };
    this.items.push(item);
    for (let index = this.items.length - 1; index > 0;) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].priority <= priority) break;
      this.items[index] = this.items[parent];
      index = parent;
      this.items[index] = item;
    }
  }
  pop() {
    const root = this.items[0];
    const last = this.items.pop();
    if (!this.items.length) return root;
    this.items[0] = last;
    for (let index = 0;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
      if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right;
      if (smallest === index) break;
      [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
      index = smallest;
    }
    return root;
  }
}
