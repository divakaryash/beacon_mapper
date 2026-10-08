export const LAYERS = [
  { id: "floorPlan", label: "Floor Plan", color: "#94a3b8" },
  { id: "walls", label: "Walls", color: "#172033" },
  { id: "rooms", label: "Rooms", color: "#2563eb" },
  { id: "walkableAreas", label: "Walkable Areas", color: "#16a085" },
  { id: "restrictedAreas", label: "Restricted Areas", color: "#dc5d50" },
  { id: "navigationGraph", label: "Navigation Graph", color: "#8b5cf6" },
  { id: "pois", label: "POIs", color: "#d97706" },
  { id: "beacons", label: "Beacons", color: "#0891b2" },
  { id: "navigationBeacons", label: "Navigation Beacons", color: "#0891b2" },
  { id: "anchorBeacons", label: "Anchor Beacons", color: "#e39522" },
  { id: "disabledBeacons", label: "Disabled Beacons", color: "#94a3b8" },
  { id: "coverage", label: "Coverage", color: "#7c3aed" },
  { id: "warnings", label: "Warnings", color: "#dc2626" },
];

export const TOOLS = [
  ["select", "Select", "V"], ["move", "Move", "M"], ["pan", "Pan", "H"], ["rectangle", "Rectangle", "R"],
  ["room", "Room", "O"], ["polygon", "Polygon", "G"], ["polyline", "Polyline", "L"],
  ["wall", "Wall", "W"], ["walkablePath", "Walkable Path", "K"],
  ["walkableArea", "Walkable Area", "A"], ["restrictedArea", "Restricted Area", "X"],
  ["buildingBoundary", "Boundary", "B"], ["nonWalkableArea", "Non-walkable", "N"],
  ["poi", "POI", "P"], ["text", "Text", "T"], ["delete", "Delete", "D"],
];

export const POI_CATEGORIES = [
  "Store", "Outlet", "Lift", "Stairs", "Escalator", "Entrance", "Exit", "ATM", "Washroom", "Food Court", "Reception", "Custom",
];

export function defaultLayers() {
  return Object.fromEntries(LAYERS.map((layer) => [layer.id, { visible: true, locked: ["navigationGraph", "beacons", "coverage"].includes(layer.id) }]));
}

export function layerForType(type) {
  if (type === "wall") return "walls";
  if (type === "room") return "rooms";
  if (["walkableArea", "walkablePath"].includes(type)) return "walkableAreas";
  if (["restrictedArea","nonWalkableArea"].includes(type)) return "restrictedAreas";
  if (type === "buildingBoundary") return "walls";
  if (type === "poi") return "pois";
  return "rooms";
}

export function makeObject(type, data = {}) {
  const object = { id: `${type}-${crypto.randomUUID()}`, type, layerId: layerForType(type), rotation: 0, ...data };
  if (type === "room") return { name: "Untitled room", category: "Room", floor: "Ground", ...object };
  if (type === "poi") return { name: data.category ?? "POI", category: "Custom", floor: "Ground", ...object };
  if (type === "text") return { text: "Label", fontSize: 18, ...object };
  return object;
}

export function normalizeProject(project) {
  if (!project) return null;
  const reference = project.floorAnalysis?.method === "aligned-venue-reference";
  const layers = {...defaultLayers(), ...project.layers};
  if (reference && !project.referencePresentationInitialized) {
    for (const id of ["coverage", "warnings", "walkableAreas"]) layers[id] = {...layers[id], visible:false};
    layers.navigationGraph = {...layers.navigationGraph, visible:true, locked:false};
    layers.beacons = {...layers.beacons, visible:true, locked:false};
  }
  return {
    objects: [], graph: { nodes: [], edges: [] }, deployments:[], beaconProfiles:[], coverageSettings:{circles:true,heatmap:true,deadZones:true,overlap:true,gaps:true,cellSize:.5,floorId:""}, layers: defaultLayers(), gridSize: 20, snapToGrid: true,
    drawingHeightPixels: project.drawingHeightPixels || 800, ...project,
    placementNeedsReview:!!project.placementNeedsReview||!!(project.beaconPlan&&!project.beaconPlan.geometryValidation),
    coverageAnalysis:project.beaconPlan&&!project.beaconPlan.geometryValidation?null:project.coverageAnalysis,
    layers,
    referencePresentationInitialized: reference || !!project.referencePresentationInitialized,
  };
}
