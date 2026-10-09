import {simplifyContour} from "../engines/geometry.js";
import {compileFloorGeometry, geometryConflict} from "../engines/floorGeometry.js";
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
  if(type==="polyline"&&data.points?.length>=4){
    const first=data.points[0],last=data.points.at(-1);
    if(first.x===last.x&&first.y===last.y){type="polygon";data={...data,points:data.points.slice(0,-1)};}
  }
  const object = { id: `${type}-${crypto.randomUUID()}`, type, layerId: layerForType(type), rotation: 0, ...data };
  if (type === "room") return { name: "Untitled room", category: "Room", floor: "Ground", ...object };
  if (type === "poi") return { name: data.category ?? "POI", category: "Custom", floor: "Ground", ...object };
  if (type === "text") return { text: "Label", fontSize: 18, ...object };
  return object;
}

export function normalizeBeaconPlan(plan) {
  if (!plan) return plan;
  const beacons=plan.beacons.map(b=>({...b,type:"Navigation"}));
  const {anchorBeacons,...statistics}=plan.statistics||{};
  return {...plan,beacons,statistics:{...statistics,navigationBeacons:beacons.filter(b=>b.enabled!==false).length}};
}

export function normalizeProject(project) {
  if (!project) return null;
  const reference = !!project.floorAnalysis;
  let objects=project.objects||[],floorAnalysis=project.floorAnalysis,updatedContours=false;
  if(floorAnalysis?.method==="bounded-raster-topology"&&(floorAnalysis.contourVersion||0)<2){
    const {width,height}=floorAnalysis.resolution||{};
    const tolerance=1.25*Math.min(project.drawingWidthPixels/width,project.drawingHeightPixels/height);
    if(Number.isFinite(tolerance)&&tolerance>0){
      objects=objects.map(object=>{
        if(object.origin!=="automatic"||!object.points||object.locked||object.category==="Wall")return object;
        const points=simplifyContour(object.points,tolerance);
        const holes=object.holes?.map(ring=>simplifyContour(ring,tolerance));
        updatedContours ||= points.length!==object.points.length||holes?.some((ring,i)=>ring.length!==object.holes[i].length);
        return {...object,points,...(holes?{holes}:{})};
      });
      floorAnalysis={...floorAnalysis,contourVersion:2};
    }
  }
  const layers = {...defaultLayers(), ...project.layers};
  if (reference && !project.referencePresentationInitialized) {
    for (const id of ["coverage", "warnings"]) layers[id] = {...layers[id], visible:false};
    layers.navigationGraph = {...layers.navigationGraph, visible:true, locked:false};
    layers.beacons = {...layers.beacons, visible:true, locked:false};
  }
  let beaconPlan=normalizeBeaconPlan(project.beaconPlan),removedBlockedAutomatic=false;
  if(beaconPlan&&project.objects?.length&&Number(project.widthMeters)>0&&Number(project.drawingWidthPixels)>0){
    const scale=Number(project.widthMeters)/Number(project.drawingWidthPixels);
    try {
      const floors=compileFloorGeometry({objects,metersPerPixel:scale});
      const beacons=beaconPlan.beacons.filter(b=>{
        const floor=floors.get(b.floorId||"floor-1"),conflict=floor&&geometryConflict({x:b.x*scale,y:b.y*scale},floor,{requireWalkable:false});
        const remove=!b.locked&&b.origin!=="manual"&&["restricted-area","non-walkable-area","inside-wall"].includes(conflict);
        removedBlockedAutomatic ||= remove;return !remove;
      });
      if(removedBlockedAutomatic)beaconPlan={...beaconPlan,beacons};
    } catch { /* Invalid geometry remains available for correction in the editor. */ }
  }
  return {
    objects: [], graph: { nodes: [], edges: [] }, deployments:[], beaconProfiles:[], coverageSettings:{circles:true,heatmap:true,deadZones:true,overlap:true,gaps:true,cellSize:.5,floorId:""}, layers: defaultLayers(), gridSize: 20, snapToGrid: true,
    drawingHeightPixels: project.drawingHeightPixels || 800, ...project,
    objects,floorAnalysis,
    autoPlanPending:updatedContours||removedBlockedAutomatic||!!project.autoPlanPending,
    placementNeedsReview:updatedContours||removedBlockedAutomatic||!!project.placementNeedsReview||!!(project.beaconPlan&&!project.beaconPlan.geometryValidation),
    coverageAnalysis:updatedContours||removedBlockedAutomatic||(project.beaconPlan&&!project.beaconPlan.geometryValidation)?null:project.coverageAnalysis,
    beaconPlan,
    deployments: (project.deployments||[]).map(d=>({...d,plan:normalizeBeaconPlan(d.plan)})),
    layers,
    referencePresentationInitialized: reference || !!project.referencePresentationInitialized,
  };
}


export function visibleAnnotation(object){
  if(!['automatic','reference'].includes(object.origin))return true;
  if(object.type==='walkableArea')return false;
  return !(object.origin==='automatic'&&(object.type==='buildingBoundary'||object.category==='Wall'));
}
