import { annotationFeatures } from './annotatedFloor.js';

// Display source paths without clipping them against walls or restricted geometry.
// The validated planning graph remains independent from this read-only view.
export function sourceWaypointGraph(project) {
  if (!project.annotationData || !project.annotationAlignment) return null;

  const alignment = project.annotationAlignment;
  const matrix = alignment.geoToNormalizedPdf;
  const floor = String(project.annotationFloor);
  const payload = project.waypointData || project.annotationData;
  const features = annotationFeatures(payload);
  const nodes = [];
  const edges = [];
  const scale = Number(project.widthMeters) / Number(project.drawingWidthPixels);

  function position(coordinate) {
    const [longitude, latitude] = coordinate;
    if (![longitude, latitude].every(Number.isFinite)) {
      throw new Error('Source waypoint has invalid coordinates.');
    }
    const dx = longitude - alignment.origin[0];
    const dy = latitude - alignment.origin[1];
    return {
      x: (dx * matrix[0][0] + dy * matrix[1][0] + matrix[2][0]) * project.drawingWidthPixels,
      y: (dx * matrix[0][1] + dy * matrix[1][1] + matrix[2][1]) * project.drawingHeightPixels,
    };
  }

  for (const [featureIndex, feature] of features.entries()) {
    const properties = feature.properties || {};
    if (String(properties.floor ?? properties.level ?? '0') !== floor) continue;
    const geometry = feature.geometry;
    if (!['LineString', 'MultiLineString'].includes(geometry?.type)) continue;
    // These are structural lines, not supplied navigation paths.
    if (['Wall', 'Beam'].includes(properties.type)) continue;

    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    for (const [lineIndex, line] of lines.entries()) {
      const points = line.map(position);
      const prefix = `source-waypoint-${featureIndex}-${lineIndex}`;
      points.forEach((point, index) => nodes.push({
        ...point,
        id: `${prefix}-${index}`,
        sourceId: feature.id ?? feature._id,
        floorId: floor,
        type: 'Corridor',
      }));
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1];
        const b = points[index];
        edges.push({
          id: `${prefix}-edge-${index}`,
          source: `${prefix}-${index - 1}`,
          target: `${prefix}-${index}`,
          sourceId: feature.id ?? feature._id,
          distance: Math.hypot(b.x - a.x, b.y - a.y) * scale,
          edgeType: 'Original waypoint path',
          direction: 'as supplied',
        });
      }
    }
  }
  return { nodes, edges };
}
