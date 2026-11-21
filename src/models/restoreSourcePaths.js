import { createManualAnnotationProject } from './floorPlanOverlay.js';

// Older saved projects contain a clipped graph even when the source overlay is complete.
// Restore the original graph once, retaining edited geometry and existing beacon records.
export function restoreSourcePaths(project) {
  if (!project.annotationData || project.floorAnalysis?.routeSource !== 'geojson' ||
      project.floorAnalysis.sourceWaypointVersion === 1) {
    return project;
  }

  const imported = createManualAnnotationProject(
    {}, project.annotationData, project.annotationFloor, project.waypointData || null,
  );
  const scale = Number(project.widthMeters) / Number(project.drawingWidthPixels);
  const graph = {
    ...imported.graph,
    nodes: imported.graph.nodes.map(node => ({
      ...node,
      // Source geometry stays fixed geographically; preserve this project's canvas scale.
      x: node.worldX / scale,
      y: node.worldY / scale,
    })),
  };

  return {
    ...project,
    graph,
    planningSettings: {...project.planningSettings, trustWaypointPaths: true},
    floorAnalysis: {...project.floorAnalysis, ...imported.floorAnalysis, sourceWaypointVersion: 1},
  };
}
