export const MODEL_BEACON_COLOR = '#0891b2';
export const ANNOTATED_BEACON_COLOR = '#16a34a';
export const BEACON_DOT_RADIUS = 7;
export const OVERLAPPING_ANNOTATION_RADIUS = 3.5;

// Detect visual overlap in drawing coordinates without moving either beacon.
export function overlappingAnnotatedBeaconIds(modelBeacons, annotatedBeacons) {
  const diameter = BEACON_DOT_RADIUS * 2 + 2;
  const bins = new Map();
  const key = (floor, x, y) => `${floor}:${x}:${y}`;

  for (const beacon of modelBeacons) {
    const bin = key(beacon.floorId, Math.floor(beacon.x / diameter), Math.floor(beacon.y / diameter));
    if (!bins.has(bin)) bins.set(bin, []);
    bins.get(bin).push(beacon);
  }

  const overlapping = new Set();
  for (const beacon of annotatedBeacons) {
    const x = Math.floor(beacon.x / diameter);
    const y = Math.floor(beacon.y / diameter);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nearby = bins.get(key(beacon.floorId, x + dx, y + dy)) || [];
        if (nearby.some(model => Math.hypot(model.x - beacon.x, model.y - beacon.y) <= diameter)) {
          overlapping.add(beacon.id);
        }
      }
    }
  }
  return overlapping;
}
