import { visibleAcrossPhysicalWalls } from './floorGeometry.js';
// Map diagnostics describe placement rules, independently of coverage heatmaps.
export function routePlacementWarnings({ graph, beacons = [], maximumSpacing = 10, junctionRadius = maximumSpacing, floors = null }) {
  if (!(maximumSpacing > 0) || !(junctionRadius > 0)) return [];
  const nodes = new Map(graph.nodes.map(n => [n.id, n])), links = new Map(graph.nodes.map(n => [n.id, []]));
  const active = beacons.filter(b => b.enabled !== false), byNode = new Map(), byEdge = new Map();
  for (const e of graph.edges) {
    const a = nodes.get(e.source), b = nodes.get(e.target);
    if (!a || !b || a.floorId !== b.floorId || !(e.distance > 0)) continue;
    links.get(a.id).push(e); links.get(b.id).push(e);
  }
  for (const b of active) {
    const n = nodes.get(b.nodeId);
    if (n?.floorId === b.floorId) byNode.set(n.id, b);
    else if (b.edgeId && Number.isFinite(b.edgeOffset)) {
      if (!byEdge.has(b.edgeId)) byEdge.set(b.edgeId, []);
      byEdge.get(b.edgeId).push(b);
    }
  }
  const result = [], visited = new Set();
  function segment(part, lo, hi, reason, length) {
    const t0 = (lo - part.start) / part.edge.distance, t1 = (hi - part.start) / part.edge.distance;
    const { a, b } = part;
    result.push({ floorId:a.floorId, edgeId:part.edge.id, reason, length,
      x1:a.x+(b.x-a.x)*t0, y1:a.y+(b.y-a.y)*t0,
      x2:a.x+(b.x-a.x)*t1, y2:a.y+(b.y-a.y)*t1 });
  }
  function walk(start, first) {
    let current = start, edge = first, length = 0;
    const parts = [], stations = [];
    if (byNode.has(start)) stations.push(0);
    while (edge && !visited.has(edge.id)) {
      visited.add(edge.id);
      const next = edge.source === current ? edge.target : edge.source, a = nodes.get(current), b = nodes.get(next);
      parts.push({ edge, a, b, start:length });
      for (const beacon of byEdge.get(edge.id) || []) if (beacon.floorId === a.floorId && beacon.edgeOffset >= 0 && beacon.edgeOffset <= edge.distance)
        stations.push(length + (edge.source === current ? beacon.edgeOffset : edge.distance-beacon.edgeOffset));
      length += edge.distance;
      if (byNode.has(next)) stations.push(length);
      current = next;
      if (links.get(current).length !== 2) break;
      edge = links.get(current).find(e => !visited.has(e.id));
    }
    // Route endpoints are used to flag long unserved tails, not as beacons.
    const stops = [...new Set([0, ...stations, length])].sort((a,b)=>a-b);
    for (let i=1;i<stops.length;i++) {
      const gap=stops[i]-stops[i-1];
      // Allow sub-metre overruns on the map; placement still uses the configured maximum.
      if (gap < maximumSpacing + 1 - 1e-6) continue;
      for (const part of parts) {
        const lo=Math.max(stops[i-1],part.start), hi=Math.min(stops[i],part.start+part.edge.distance);
        if (hi>lo+1e-6) {
          segment(part,lo,hi,`Route interval ${gap.toFixed(2)} m exceeds maximum ${maximumSpacing} m`,gap);
          const warning = result.at(-1), middle = (stops[i-1] + stops[i]) / 2;
          warning.kind = 'spacing';
          warning.maximumSpacing = maximumSpacing;
          if (middle >= lo && middle < hi + 1e-9 && !result.slice(0,-1).some(w => w.intervalKey === `${first.id}:${i}` && w.labelX !== undefined)) {
            const t = (middle - part.start) / part.edge.distance;
            warning.labelX = part.a.x + (part.b.x - part.a.x) * t;
            warning.labelY = part.a.y + (part.b.y - part.a.y) * t;
          }
          warning.intervalKey = `${first.id}:${i}`;
        }
      }
    }
  }
  for (const n of graph.nodes) if (links.get(n.id).length !== 2)
    for (const e of links.get(n.id)) if (!visited.has(e.id)) walk(n.id,e);
  for (const n of graph.nodes) for (const e of links.get(n.id)) if (!visited.has(e.id)) walk(n.id,e);
  for (const n of graph.nodes) {
    if (links.get(n.id).length < 3) continue;
    if (active.some(b => b.floorId === n.floorId && Math.hypot(b.worldX-n.worldX,b.worldY-n.worldY) <= junctionRadius+1e-6 && (!floors || visibleAcrossPhysicalWalls({x:b.worldX,y:b.worldY},{x:n.worldX,y:n.worldY},floors.get(n.floorId))))) continue;
    for (const edge of links.get(n.id)) {
      const other=nodes.get(edge.source===n.id?edge.target:edge.source), reach=Math.min(1,edge.distance);
      segment({edge,a:n,b:other,start:0},0,reach,`Missed junction ${n.id}: no enabled beacon within the junction coverage distance`,reach);
    }
  }
  return result;
}
