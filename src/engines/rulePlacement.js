import { beaconGeometryConflict, visibleAcrossPhysicalWalls, nearestValidGraphPosition, segmentProjection } from './floorGeometry.js';

const distance = (a, b) => Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY);
// Priority placement inspired by the supplied optimizer. Coverage radius and
// consecutive route spacing are deliberately separate planning quantities.
export function placeByRules({ graph, floors, settings = {}, pois = [], preserved = [] }) {
  settings = { minimumSpacing: 6, maximumSpacing: 10, spacing: 8, reliableRadius: 6, ...settings };
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const links = new Map(graph.nodes.map(n => [n.id, []]));
  for (const e of graph.edges) {
    if (nodes.get(e.source).floorId !== nodes.get(e.target).floorId) continue;
    links.get(e.source).push(e); links.get(e.target).push(e);
  }
  const min = settings.minimumSpacing, max = settings.maximumSpacing;
  const beacons = [...preserved], warnings = [];
  const pendingTargets = [];
  const preservedSet = new Set(preserved);
  const priority = rule => rule === 'Floor connector' ? 1
    : ['Junction', 'Entrance / exit', 'Key POI'].includes(rule) ? 2
    : ['Dead end', 'Room entrance', 'POI'].includes(rule) ? 3 : 4;
  function assignTarget(beacon, target, rule) {
    if (preservedSet.has(beacon)) return;
    beacon.servedTargets = [...(beacon.servedTargets || []), { id: target.id, rule }];
    beacon.placementPriority = Math.min(beacon.placementPriority, priority(rule));
  }
  const visible = (a, b) => a.floorId === b.floorId && visibleAcrossPhysicalWalls({ x: a.worldX, y: a.worldY }, { x: b.worldX, y: b.worldY }, floors.get(a.floorId));
  const close = p => beacons.find(
  b =>
    b.enabled !== false &&
    b.floorId === p.floorId &&
    distance(b, p) < min - 1e-6 &&
    visible(b, p)
);
  
for (let i = 0; i < preserved.length; i++) {
  const b = preserved[i];

  if (b.enabled === false) continue;

  const conflict = preserved
    .slice(0, i)
    .find(a =>
      a.enabled !== false &&
      a.floorId === b.floorId &&
      distance(a, b) < min - 1e-6 &&
      visible(a, b)
    );

  if (conflict) {
    warnings.push({ code: 'preserved-spacing-conflict', message:
      `Preserved beacons ${conflict.id} and ${b.id} are less than ${min} m apart; retained unchanged.` });
  }
}

function coversJunctionBranches(beacon, junction) {
  if (
    beacon.enabled === false ||
    beacon.floorId !== junction.floorId
  ) return false;

  const radius = Math.min(
    beacon.reliableRadius ?? settings.reliableRadius,
    settings.reliableRadius
  );

  if (
    distance(beacon, junction) > radius + 1e-6 ||
    !visible(beacon, junction)
  ) return false;

  return links.get(junction.id).every(edge => {
    const otherId =
      edge.source === junction.id
        ? edge.target
        : edge.source;

    const other = nodes.get(otherId);
    if (!other) return false;

    const length = distance(junction, other);
    if (length <= 1e-9) return true;

    const reach = Math.min(length, radius);
    const t = reach / length;

    const sample = {
      floorId: junction.floorId,
      worldX: junction.worldX +
        (other.worldX - junction.worldX) * t,
      worldY: junction.worldY +
        (other.worldY - junction.worldY) * t
    };

    return (
      distance(beacon, sample) <= radius + 1e-6 &&
      visible(beacon, sample)
    );
  });
}
  // Follow degree-two samples so endpoint clearance is independent of graph density.
  const terminalClearances = [];
  for (const terminal of graph.nodes.filter(n => links.get(n.id).length === 1)) {
    let current = terminal.id, edge = links.get(current)[0], travelled = 0;
    const seen = new Set();
    while (edge && travelled < 2 && !seen.has(edge.id)) {
      seen.add(edge.id);
      terminalClearances.push({ edge, current, travelled });
      travelled += edge.distance;
      current = edge.source === current ? edge.target : edge.source;
      edge = links.get(current).length === 2 ? links.get(current).find(e => !seen.has(e.id)) : null;
    }
  }
  function isNearDeadEnd(p) {
    return terminalClearances.some(({ edge, current, travelled }) => {
      const offset = p.nodeId === edge.source ? 0 : p.nodeId === edge.target ? edge.distance
        : p.edgeId === edge.id ? p.edgeOffset : NaN;
      const inward = travelled + (edge.source === current ? offset : edge.distance - offset);
      return inward >= -1e-6 && inward < 2 - 1e-6;
    });
  }

  function add(p, rule, reason, extra = {}) {
    if (!p) return null;

    if (isNearDeadEnd(p)) return null;

    if (
      beaconGeometryConflict(
        { x: p.worldX, y: p.worldY },
        floors.get(p.floorId)
      ) ||
      close(p)
    ) {
      return null;
    }

    const b = {
      ...p,
      ...extra,
      type: 'Navigation',
      id: `rule-${beacons.length + 1}`,
      origin: 'automatic',
      enabled: true,
      placementRule: rule,
      placementPriority: priority(rule),
      placementReason: reason,
      placementStrategy: rule
    };

    beacons.push(b);
    return b;
  }

  const vertical = new Set(['Lift', 'Stairs', 'Escalator', 'Ramp']);
  function candidates(target, radius) {
    const positions = [];
    const exact = nodes.get(target.nodeId || target.id);
    if (exact?.floorId === target.floorId) positions.push({ ...exact, nodeId: exact.id });
    const nearest = nearestValidGraphPosition(target, graph, floors);
    if (nearest) positions.push(nearest);
    for (const edge of graph.edges) {
      const a = nodes.get(edge.source), b = nodes.get(edge.target);
      if (a.floorId !== target.floorId || b.floorId !== target.floorId) continue;
      const projection = segmentProjection({ x: target.worldX, y: target.worldY },
        { x: a.worldX, y: a.worldY }, { x: b.worldX, y: b.worldY });
      if (projection.distance > radius) continue;
      const center = projection.t * edge.distance;
      const offsets = new Set([center, 0, edge.distance]);
      for (let d = .25; d <= radius + 1e-6; d += .25) {
        offsets.add(Math.max(0, center - d)); offsets.add(Math.min(edge.distance, center + d));
      }
      for (const offset of offsets) {
        const t = offset / edge.distance;
        positions.push({ floorId: a.floorId, x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y),
          worldX: a.worldX + t * (b.worldX - a.worldX), worldY: a.worldY + t * (b.worldY - a.worldY),
          edgeId: edge.id, edgeOffset: offset });
      }
    }
    return positions.filter(p => distance(p, target) <= radius + 1e-6 && visible(p, target))
      .sort((a, b) => distance(a, target) - distance(b, target));
  }
  function serve(target, rule, radius) {
    const shared = beacons.find(b => b.enabled !== false &&
      distance(b, target) <= Math.min(radius, b.reliableRadius ?? settings.reliableRadius) + 1e-6 && visible(b, target));
    if (shared) { assignTarget(shared, target, rule); return; }
    for (const p of candidates(target, radius)) {
      if (add(p, rule, `${rule}: ${target.name || target.type || target.category || target.id}. Target offset ${distance(p, target).toFixed(2)} m.`,
        { servedTargets: [{ id: target.id, rule }] })) return;
    }
    pendingTargets.push({ target, rule, radius });
    warnings.push({ code: 'rule-unserved', targetId: target.id, message: `${rule} ${target.name || target.id}: no visible valid position within ${radius} m satisfies the ${min} m minimum.` });
  }
  const ordered = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (const n of ordered.filter(n => vertical.has(n.type))) serve(n, 'Floor connector', Math.min(5, settings.reliableRadius));
  for (const p of pois.filter(p => vertical.has(p.category))) serve(p, 'Floor connector', Math.min(5, settings.reliableRadius));
  // P2 junctions precede key POIs so a shared mount retains branch coverage.
  for (const n of ordered.filter(n => links.get(n.id).length >= 3).sort((a, b) => links.get(b.id).length - links.get(a.id).length)) {
    const shared = beacons.find(
  b => coversJunctionBranches(b, n)
);
    if (shared) {
      assignTarget(shared, n, 'Junction');
      continue;
    }
    const extra = { servedTargets: [{ id: n.id, rule: 'Junction' }] };
   
const junctionPosition = {
  ...n,
  nodeId: n.id
};

if (
  coversJunctionBranches(junctionPosition, n) &&
  add(
    junctionPosition,
    'Junction',
    `Junction (${links.get(n.id).length} connections): ` +
    `placed directly with outgoing branch checks.`,
    extra
  )
) {
  continue;
}

    
const candidate = candidates(n, Math.min(settings.reliableRadius, max * .8))
  .find(p => !close(p) && !isNearDeadEnd(p) &&
    !beaconGeometryConflict({ x: p.worldX, y: p.worldY }, floors.get(p.floorId)) && coversJunctionBranches(p, n));
    if (candidate && add(candidate, 'Junction', `Junction (${links.get(n.id).length} connections): nearby valid route position with outgoing branch checks.`, extra)) continue;
    pendingTargets.push({ target: n, rule: 'Junction', radius: settings.reliableRadius });
    warnings.push({ code: 'rule-unserved', targetId: n.id, message: `Junction ${n.id}: exact placement and nearby waypoint retry within ${(max * .8).toFixed(2)} m could not satisfy valid installation geometry and ${min} m minimum spacing.` });
  }
  const entries = new Set(['Entry', 'Entrance', 'Exit', 'Main Entry']);
  const keyPois = new Set([...entries, 'Reception', 'Cafeteria']);
  for (const n of ordered.filter(n => keyPois.has(n.type)))
    serve(n, entries.has(n.type) ? 'Entrance / exit' : 'Key POI', settings.reliableRadius);
  for (const p of pois.filter(p => keyPois.has(p.category)))
    serve(p, entries.has(p.category) ? 'Entrance / exit' : 'Key POI', settings.reliableRadius);
  // P3 room entrances and remaining POIs retain their existing target coverage.
  for (const n of ordered.filter(n => n.type === 'Room Entrance')) serve(n, 'Room entrance', settings.reliableRadius);
  for (const p of pois.filter(p => !vertical.has(p.category) && !keyPois.has(p.category)))
    serve(p, p.category === 'Room Entrance' ? 'Room entrance' : 'POI', settings.reliableRadius);

  // Collapse degree-two sampling nodes into continuous routes before dividing
  // distances. This makes results independent of waypoint sampling density.
  const visited = new Set(), chains = [];
  function walk(start, first) {
    let current = start, edge = first, length = 0; const parts = [];
    while (edge && !visited.has(edge.id)) {
      visited.add(edge.id);
      const next = edge.source === current ? edge.target : edge.source;
      parts.push({ edge, a: nodes.get(current), b: nodes.get(next), start: length });
      length += edge.distance; current = next;
      if (links.get(current).length !== 2 || beacons.some(b => b.enabled !== false && b.nodeId === current)) break;
      edge = links.get(current).find(e => !visited.has(e.id));
    }
    chains.push({ parts, length });
  }
  for (const n of ordered) if (links.get(n.id).length !== 2 || beacons.some(b => b.enabled !== false && b.nodeId === n.id))
    for (const e of links.get(n.id)) if (!visited.has(e.id)) walk(n.id, e);
  for (const e of graph.edges) if (!visited.has(e.id) && nodes.get(e.source).floorId === nodes.get(e.target).floorId) walk(e.source, e);
  for (const chain of chains) {
    const { parts, length } = chain;
    function at(s) {
      const part = parts.find(p => s <= p.start + p.edge.distance + 1e-7) || parts.at(-1);
      const t = Math.max(0, Math.min(1, (s - part.start) / part.edge.distance)), { a, b, edge } = part;
      return { floorId: a.floorId, x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), worldX: a.worldX + t * (b.worldX - a.worldX), worldY: a.worldY + t * (b.worldY - a.worldY), edgeId: edge.id, edgeOffset: (edge.source === a.id ? t : 1 - t) * edge.distance };
    }
    
function stations(includeBoundaries = true) {
  const positions = [];

  for (const part of parts) {
    for (const b of beacons) {
      if (
        b.enabled === false ||
        b.floorId !== part.a.floorId
      ) continue;

      if (b.nodeId === part.a.id) {
        positions.push(part.start);
      } else if (b.nodeId === part.b.id) {
        positions.push(part.start + part.edge.distance);
      } else if (b.edgeId === part.edge.id) {
        const offset =
          part.edge.source === part.a.id
            ? b.edgeOffset
            : part.edge.distance - b.edgeOffset;

        if (Number.isFinite(offset)) {
          positions.push(part.start + offset);
        }
      }
    }
  }

  if (includeBoundaries) {
    positions.push(0, length);
  }

  return [...new Set(
    positions.filter(
      p => Number.isFinite(p) &&
        p >= -1e-6 &&
        p <= length + 1e-6
    )
  )].sort((a, b) => a - b);
}

    Object.assign(chain, { at, stations });
  }
  // Finish P3 on every route before any P4 spacing or coverage fill.
  for (const chain of chains) {
    const { parts, length, at } = chain;
    // Share reliable coverage or install 2–4 m inward along the route.

    for (const [terminal, endOffset] of [
      [parts[0].a, 0],
      [parts.at(-1).b, length]
    ]) {
      if (links.get(terminal.id).length !== 1) continue;

      const reliable = settings.reliableRadius;

      // Existing beacon already covers the dead end.
      const covered = beacons.some(b =>
        b.enabled !== false &&
        b.floorId === terminal.floorId &&
        distance(b, terminal) <= Math.min(reliable, b.reliableRadius ?? settings.reliableRadius) &&
        visible(b, terminal)
      );

      if (covered) {
        const shared = beacons.find(b => b.enabled !== false && visible(b, terminal) &&
          distance(b, terminal) <= Math.min(reliable, b.reliableRadius ?? settings.reliableRadius));
        assignTarget(shared, terminal, 'Dead end');
        continue;
      }

      const offsets = [3, 3.5, 2.5, 4, 2].filter(d => d <= reliable && d <= length);

      let placed = false;

      for (const d of offsets) {
        const s = endOffset === 0
          ? d
          : length - d;

        if (s < 0 || s > length) continue;

        const p = at(s);

        if (
          distance(p, terminal) > reliable ||
          !visible(p, terminal)
        ) continue;

        const beacon = add(
          p,
          'Dead end',
          'Inward placement covering terminal and corridor.',
          {
            servedTargets: [{
              id: terminal.id,
              rule: 'Dead end'
            }]
          }
        );

        if (beacon) {
          placed = true;
          break;
        }
      }

      if (!placed) {
        warnings.push({
          code: 'dead-end-unserved',
          nodeId: terminal.id,
          message:
            `Could not cover dead end ${terminal.id} ` +
            `using a valid inward beacon position.`
        });
      }
    }
  }
  // P4 regular waypoints fill remaining intervals after all priority targets.
  for (const chain of chains) {
    const { parts, length, at, stations } = chain;
    if (parts[0].a.id === parts.at(-1).b.id && !beacons.some(b => b.enabled !== false && parts.some(p => b.nodeId === p.a.id || b.edgeId === p.edge.id)))
      add({ ...parts[0].a, nodeId: parts[0].a.id }, 'Corridor gap', 'Initial station for a closed corridor loop.');
    const stops = stations();
    for (let j = 1; j < stops.length; j++) {
      const start = stops[j - 1], gap = stops[j] - start;
      const least = Math.ceil((gap - 1e-6) / max), most = Math.floor((gap + 1e-6) / min);
      const count = Math.max(1, least <= most ? Math.max(least, Math.min(most, Math.round(gap / settings.spacing))) : least);
      for (let i = 1; i < count; i++) add(at(start + gap * i / count), 'Corridor gap', `Divided a ${gap.toFixed(2)} m route section into ${count} intervals of ${(gap / count).toFixed(2)} m; requested ${min}–${max} m.`);
    }
  }
  // Repair spacing with P4 first, then adjust P3 only within its target coverage.
  // Preserved beacons and P1/P2 anchors never move.
  const protectedBeacons = new Set(beacons.filter(b => preservedSet.has(b) || b.placementPriority <= 2));
  const gaps = () => chains.flatMap(chain => {
    const stops = chain.stations();
    return stops.slice(1).flatMap((end, i) => end - stops[i] > max + 1e-6 ? [{ chain, start: stops[i], end, length: end-stops[i] }] : []);
  });
  const penalty = () => gaps().reduce((sum, g) => sum + g.length - max, 0);
  
  function inwardDistance(beacon, terminal) {
    for (const chain of chains) {
      const fromStart = chain.parts[0].a.id === terminal.id;
      if (!fromStart && chain.parts.at(-1).b.id !== terminal.id) continue;
      for (const part of chain.parts) {
        const offset = beacon.nodeId === part.a.id ? 0 : beacon.nodeId === part.b.id ? part.edge.distance
          : beacon.edgeId === part.edge.id ? (part.edge.source === part.a.id ? beacon.edgeOffset : part.edge.distance - beacon.edgeOffset) : NaN;
        if (Number.isFinite(offset)) return fromStart ? part.start + offset : chain.length - part.start - offset;
      }
    }
    return Infinity;
  }

const assignedTargetsValid = b =>
  (b.servedTargets || []).every(t => {
    const target =
      nodes.get(t.id) ||
      pois.find(p => p.id === t.id);

    if (!target) return true;

    if (t.rule === 'Junction') {
      return coversJunctionBranches(b, target);
    }

    const inwardTarget = b.placementRule === 'Dead end' && t === b.servedTargets[0];
    const radius = t.rule === 'Floor connector' ? Math.min(5, settings.reliableRadius)
      : inwardTarget ? Math.min(4, settings.reliableRadius) : settings.reliableRadius;

    return (
      (!inwardTarget || (inwardDistance(b, target) >= 2 - 1e-6 && inwardDistance(b, target) <= 4 + 1e-6)) &&
      target.floorId === b.floorId &&
      distance(b, target) <= radius + 1e-6 &&
      visible(b, target)
    );
  });

  let repairs = 0;
  for (let pass = 0; pass < 4 && repairs < 100; pass++) {
    let improved = false;
    for (const gap of gaps().sort((a,b) => b.length-a.length)) {
      const { chain, start, end } = gap, before = penalty();
      // Search the full feasible interval rather than retrying only its midpoint.
      const offsets = new Set([(start+end)/2, start+min, end-min, start+max, end-max]);
      const step = Math.max(.25, (end-start)/80);
      for (let s = start+min; s <= end-min+1e-6; s += step) offsets.add(s);
      let accepted = false;
      for (const s of [...offsets].filter(s => s-start >= min-1e-6 && end-s >= min-1e-6).sort((a,b) => Math.abs(a-(start+end)/2)-Math.abs(b-(start+end)/2))) {
        const b = add(chain.at(s), 'Corridor gap', `Maximum-spacing repair: added a station inside a ${gap.length.toFixed(2)} m interval; requested ${min}–${max} m.`);
        if (!b) continue;
        if (penalty() < before-1e-6) { accepted = true; break; }
        beacons.splice(beacons.indexOf(b),1);
      }
      if (!accepted) {
        // First try the shift that closes this gap, retaining every assigned landmark.
        const endpoints = [start,end].map(s => ({ s, b: beacons.find(b => b.enabled !== false && b.floorId === chain.parts[0].a.floorId && distance(b,chain.at(s)) < 1e-6) })).filter(({b}) => b && !protectedBeacons.has(b) && !b.locked && b.origin === 'automatic').sort((a, b) => b.b.placementPriority - a.b.placementPriority);
        const shifts = new Set([gap.length-max, min*2-gap.length]);
        for (let shift=.25;shift<=min+1e-6;shift+=.25) shifts.add(shift);
        outer: for (const shift of [...shifts].filter(s=>s>1e-6).sort((a,b)=>Math.abs(a-(gap.length-max))-Math.abs(b-(gap.length-max)) || a-b)) for (const {s,b} of endpoints) for (const sign of [1,-1]) {
          const at = s+shift*sign;
          if (at < 0 || at > chain.length) continue;
          const p = chain.at(at), original = { ...b };
          if (isNearDeadEnd(p)) continue;
          
if (
  beaconGeometryConflict(
    { x: p.worldX, y: p.worldY },
    floors.get(p.floorId)
  ) ||
  beacons.some(other =>
    other !== b &&
    other.enabled !== false &&
    other.floorId === p.floorId &&
    distance(other, p) < min - 1e-6 &&
    visible(other, p)
  )
) continue;

          Object.assign(b,p,{nodeId:undefined});
          if (assignedTargetsValid(b) && penalty() < before-1e-6) {
            b.placementReason = `${original.placementReason} Adjusted ${shift.toFixed(2)} m along the route to repair maximum spacing (${max} m).`;
            accepted = true; break outer;
          }
          Object.keys(b).forEach(k => { if (!(k in original)) delete b[k]; });
          Object.assign(b,original);
        }
      }
      if (accepted) { improved = true; repairs++; }
      if (repairs >= 100) break;
    }
    if (!improved) break;
  }
  // Final navigation-route coverage repair.
  // Check all paths, not just paths near walls.

  const sampleStep = 1;
  const routeSamples = [];

  for (const chain of chains) {
    if (!chain.parts.length || chain.length <= 0) {
      continue;
    }

    const count = Math.max(
      1,
      Math.ceil(chain.length / sampleStep)
    );

    for (let i = 0; i <= count; i++) {
      routeSamples.push(
        chain.at(chain.length * i / count)
      );
    }
  }

  function coversSample(b, p) {
    const reliable = Math.min(
      b.reliableRadius ?? settings.reliableRadius,
      settings.reliableRadius
    );

    return (
      b.enabled !== false &&
      b.floorId === p.floorId &&
      distance(b, p) <= reliable + 1e-6 &&
      visible(b, p)
    );
  }

  function uncoveredSamples() {
    return routeSamples.filter(
      p => !beacons.some(b => coversSample(b, p))
    );
  }

  // Include exact separation boundaries, which a uniform sampling grid can miss.
  const routeCandidates = [...routeSamples];
  for (const chain of chains) {
    for (const s of chain.stations()) for (const offset of [-max, -min, -4, -3, -2, 2, 3, 4, min, max]) {
      if (s + offset >= 0 && s + offset <= chain.length) routeCandidates.push(chain.at(s + offset));
    }
  }
  // Repair uncovered navigation sections.
  for (let iteration = 0; iteration < 100; iteration++) {
    const missing = uncoveredSamples();

    if (!missing.length) break;

    let best = null;
    let bestGain = 0;

    for (const p of routeCandidates) {
      if (
        isNearDeadEnd(p) || close(p) ||
        beaconGeometryConflict(
          { x: p.worldX, y: p.worldY },
          floors.get(p.floorId)
        )
      ) continue;

      const gain = missing.filter(target =>
        target.floorId === p.floorId &&
        distance(p, target) <=
          settings.reliableRadius + 1e-6 &&
        visible(p, target)
      ).length;

      if (gain > bestGain) {
        best = p;
        bestGain = gain;
      }
    }

    if (!best || bestGain === 0) {
      // Reposition only lower priorities, without losing any already-covered sample.
      const covered = routeSamples.filter(p => !missing.includes(p));
      const before = penalty();
      let moved = false;
      outerCoverage: for (const b of beacons.filter(b => b.origin === 'automatic' && !b.locked && !protectedBeacons.has(b)).sort((a, b) => b.placementPriority - a.placementPriority)) {
        const original = { ...b };
        for (const p of routeCandidates) {
          if (p.floorId !== b.floorId || isNearDeadEnd(p) ||
            distance(b, p) > max || beaconGeometryConflict({ x: p.worldX, y: p.worldY }, floors.get(p.floorId)) ||
            beacons.some(other => other !== b && other.enabled !== false && visible(other, p) && distance(other, p) < min - 1e-6)) continue;
          Object.assign(b, p, { nodeId: undefined });
          if (assignedTargetsValid(b) && penalty() <= before + 1e-6 &&
            missing.some(target => coversSample(b, target)) &&
            covered.every(target => beacons.some(other => coversSample(other, target)))) {
            b.placementReason = `${original.placementReason} Adjusted along the route to repair reliable coverage.`;
            moved = true; break outerCoverage;
          }
          Object.keys(b).forEach(k => { if (!(k in original)) delete b[k]; });
          Object.assign(b, original);
        }
      }
      if (moved) continue;
      break;
    }

    const placed = add(
      best,
      'Route coverage repair',
      `Installed for ${bestGain} uncovered ` +
      `navigation-path samples.`
    );

    if (!placed) break;
  }

  const missingCoverage = uncoveredSamples();

  if (missingCoverage.length) {
    warnings.push({
      code: 'route-coverage-unresolved',
      message:
        `${missingCoverage.length} path samples ` +
        `remain without reliable wall-visible ` +
        `beacon coverage.`
    });
  }

  // Diagnose actual beacon-to-beacon gaps.
  // Do not count virtual route endpoints.
  for (const chain of chains) {
    if (!chain.parts.length) continue;

    const actual = chain.stations(false);

    for (let i = 1; i < actual.length; i++) {
      const gap = actual[i] - actual[i - 1];

      if (gap > max + 1e-6) {
        warnings.push({
          code: 'actual-beacon-gap',
          floorId: chain.parts[0].a.floorId,
          edgeId: chain.parts[0].edge.id,
          length: gap,
          message:
            `Actual beacon gap ${gap.toFixed(2)} m ` +
            `exceeds maximum ${max} m.`
        });
      }
    }
  }

  for (let i = warnings.length - 1; i >= 0; i--) {
    const warning = warnings[i];
    const pending = warning.code === 'dead-end-unserved'
      ? { target: nodes.get(warning.nodeId), rule: 'Dead end', radius: settings.reliableRadius }
      : warning.code === 'rule-unserved' ? pendingTargets.find(t => t.target.id === warning.targetId) : null;
    if (pending && beacons.some(b => pending.rule === 'Junction' ? coversJunctionBranches(b, pending.target)
      : coversSample(b, pending.target) && distance(b, pending.target) <= pending.radius + 1e-6)) warnings.splice(i, 1);
  }

  const unresolved = gaps().map(g => ({floorId:g.chain.parts[0].a.floorId, edgeId:g.chain.parts[0].edge.id,length:g.length}));
  return { beacons, warnings, unresolved, topology: { edges: [], method: 'priority-rules-and-continuous-route-spacing' } };
}
