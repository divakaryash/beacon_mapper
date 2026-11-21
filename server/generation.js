import { DeploymentPlanner, DEFAULT_PLANNING_SETTINGS } from '../src/engines/deploymentPlanner.js';
import { BEACON_PROFILES } from '../src/engines/beaconPlacement.js';
import { geometryForProject } from '../src/models/deployments.js';
import { floorGeojson } from '../src/models/floorGeojson.js';
import { localToGeographic } from '../src/models/floorPlanSetup.js';
import { createManualAnnotationProject } from '../src/models/floorPlanOverlay.js';
export function generateData(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('A JSON object is required.');
  if ([body.project, body.annotations, body.inputs].filter(v => v !== undefined).length !== 1) {
    throw new Error('Provide exactly one of project, annotations or inputs.');
  }
  let project = body.project;
  if (body.annotations !== undefined) {
    if (body.floor === undefined)
      throw new Error('floor is required with annotations.');
    project = createManualAnnotationProject({}, body.annotations, body.floor, body.waypoints ?? null);
  }
  // Also accept the deployment JSON produced by the app's export command.
  if (project?.schemaVersion === 1 && Array.isArray(project.geometry) && project.scale) {
    project = {
      ...project, ...project.scale, objects: project.geometry,
      beaconPlan: project.deployment,
      beaconProfiles: (project.profiles || []).filter(p => !BEACON_PROFILES.some(base => base.id === p.id))
    };
  }
  let inputs = body.inputs;
  if (project) {
    if (!Array.isArray(project.objects) || !Array.isArray(project.graph?.nodes) || !Array.isArray(project.graph?.edges)) {
      throw new Error('project requires objects and graph.nodes / graph.edges arrays.');
    }
    const geometry = geometryForProject(project);
    inputs = {
      graph: project.graph, floorGeometry: geometry,
      profiles: [...BEACON_PROFILES, ...(project.beaconProfiles || [])],
      settings: {
        ...DEFAULT_PLANNING_SETTINGS, defaultProfileId: project.beaconProfile?.id || BEACON_PROFILES[0].id,
        spacing: project.beaconPlan?.configuration?.spacing || 8,
        planningMode: project.beaconPlan?.configuration?.mode || 'hybrid',
        cellSize: project.coverageSettings?.cellSize || .5, ...project.planningSettings
      },
      beacons: project.beaconPlan?.beacons || [],
      pois: project.objects.filter(o => o.type === 'poi').map(o => ({
        ...o,
        floorId: o.floorId || project.graph.nodes[0]?.floorId || 'floor-1',
        worldX: o.x * geometry.metersPerPixel, worldY: o.y * geometry.metersPerPixel
      })),
    };
  }
  if (!inputs || !Array.isArray(inputs.graph?.nodes) || !Array.isArray(inputs.graph?.edges) || !inputs.floorGeometry) {
    throw new Error('inputs requires graph.nodes / graph.edges arrays and floorGeometry.');
  }
  if (body.settings !== undefined && (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings))) {
    throw new Error('settings must be a JSON object.');
  }
  const planner = new DeploymentPlanner({ ...inputs, settings: { ...inputs.settings, ...body.settings } });
  const output = planner.generate();
  let coordinates = null, source = null;
  if (project?.geographicOrigin || project?.annotationAlignment) {
    // Reuse the exact inverse geographic transform used by beacon GeoJSON export.
    if (output.plan.beacons.length)
      coordinates = floorGeojson({
        ...project,
        graph: { nodes: [], edges: [] },
        objects: output.plan.beacons.map(b => ({ id: b.id, type: 'poi', x: b.x, y: b.y })),
      }).features.map(f => f.geometry.coordinates);
    else
      coordinates = [];
    source = project.geographicOrigin ? 'geographicOrigin' : 'annotationAlignment';
  }
  else if (body.geographicOrigin !== undefined) {
    const origin = body.geographicOrigin;
    if (!origin || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude) ||
      Math.abs(origin.latitude) >= 89.9 || Math.abs(origin.longitude) > 180) {
      throw new Error('geographicOrigin requires valid numeric latitude and longitude.');
    }
    coordinates = output.plan.beacons.map(b => localToGeographic({ x: b.worldX, y: -b.worldY }, origin));
    source = 'geographicOrigin';
  }
  const beacons = output.plan.beacons.map((beacon, index) => {
    const point = coordinates?.[index];
    if (point && (!point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)) {
      throw new Error('Beacon position is outside valid geographic coordinates.');
    }
    return { ...beacon, latitude: point?.[1] ?? null, longitude: point?.[0] ?? null };
  });
  return {
    apiVersion: '1', ...output, plan: { ...output.plan, beacons },
    georeferencing: {
      available: coordinates !== null, source,
      ...(coordinates === null ? { message: 'No geographic alignment supplied. Latitude and longitude are null; supply annotations, a georeferenced project, or geographicOrigin.' } : {})
    }
  };
}
