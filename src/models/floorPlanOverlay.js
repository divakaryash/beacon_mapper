import {annotationSetup,annotatedReference} from './annotatedFloor.js';
import {analyzeVenueReference} from '../engines/venueReference.js';

export function createFloorPlanOverlay(width,height,canvasWidth,canvasHeight){
  if(![width,height,canvasWidth,canvasHeight].every(n=>Number.isFinite(n)&&n>0))throw new Error('Invalid floor plan dimensions.');
  return {width,height,x:canvasWidth/2,y:canvasHeight/2,scale:Math.min(canvasWidth/width,canvasHeight/height),rotation:0,flipX:false,flipY:false,opacity:.5,geojsonVisible:true,snap:true};
}

export function overlayPoint(overlay,point){
  const angle=overlay.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
  const x=(point.x-overlay.width/2)*overlay.scale*(overlay.flipX?-1:1),y=(point.y-overlay.height/2)*overlay.scale*(overlay.flipY?-1:1);
  return {x:overlay.x+cos*x-sin*y,y:overlay.y+sin*x+cos*y};
}

export function overlayTransform(overlay){
  return `translate(${overlay.x} ${overlay.y}) rotate(${overlay.rotation}) scale(${overlay.scale*(overlay.flipX?-1:1)} ${overlay.scale*(overlay.flipY?-1:1)}) translate(${-overlay.width/2} ${-overlay.height/2})`;
}

export function snapFloorPlanOverlay(overlay,targets,tolerance){
  if(!overlay.snap)return overlay;
  const anchors=[[0,0],[overlay.width,0],[overlay.width,overlay.height],[0,overlay.height],[overlay.width/2,overlay.height/2]].map(([x,y])=>overlayPoint(overlay,{x,y}));
  let nearest=null,best=tolerance;
  for(const anchor of anchors)for(const target of targets){
    const distance=Math.hypot(target.x-anchor.x,target.y-anchor.y);
    if(distance<best){best=distance;nearest={x:target.x-anchor.x,y:target.y-anchor.y};}
  }
  return nearest?{...overlay,x:overlay.x+nearest.x,y:overlay.y+nearest.y}:overlay;
}

export function createManualAnnotationProject(imported,payload,floor,routePayload=null){
  const setup=annotationSetup(payload,floor),reference=annotatedReference(payload,floor,setup,routePayload);
  // GeoJSON defines a fixed metric workspace; only the image moves during alignment.
  const drawingWidthPixels=1200,drawingHeightPixels=drawingWidthPixels*setup.heightMeters/setup.widthMeters;
  const detected=analyzeVenueReference(reference,{drawingWidth:drawingWidthPixels,drawingHeight:drawingHeightPixels});
  return {...imported,name:imported?.file?.name??`Floor ${floor}`,drawingWidthPixels,drawingHeightPixels,widthMeters:setup.widthMeters,heightMeters:setup.heightMeters,annotationAlignment:reference.alignment,annotationData:payload,annotationFloor:String(floor),waypointData:routePayload,geographicOrigin:null,objects:detected.objects,graph:detected.graph,floorAnalysis:{...detected.analysis,warnings:[...(imported?.file?['Align the floor plan overlay manually. GeoJSON coordinates stay fixed.']:[]),...detected.analysis.warnings]},planningSettings:{placementStrategy:detected.analysis.routeSource==='geojson'?'centerline':'pois',requireRouteEnds:detected.analysis.routeSource==='geojson',spacing:8,minimumSpacing:6,maximumSpacing:10,additionalBeaconBudget:0},floorPlanOverlay:imported?.file?createFloorPlanOverlay(imported.drawingWidthPixels,imported.drawingHeightPixels,drawingWidthPixels,drawingHeightPixels):null,autoPlanPending:false,beaconPlan:null,coverageAnalysis:null};
}
