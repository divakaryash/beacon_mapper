import {localToGeographic,validateFloorPlanSetup} from './floorPlanSetup.js';
import {overlayPoint} from './floorPlanOverlay.js';

export function mapboxPlacement(project){
  const origin=project.geographicOrigin|| (project.annotationAlignment?.origin&&{longitude:project.annotationAlignment.origin[0],latitude:project.annotationAlignment.origin[1]});
  const setup=validateFloorPlanSetup({...origin,widthMeters:project.widthMeters,heightMeters:project.heightMeters});
  const width=Number(project.drawingWidthPixels),height=Number(project.drawingHeightPixels);
  if(!(width>0&&height>0))throw new Error('The drawing needs valid pixel dimensions.');
  const coordinate=p=>localToGeographic({x:p.x/width*setup.widthMeters,y:-p.y/height*setup.heightMeters},setup);
  const frame=[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
  const overlay=project.floorPlanOverlay;
  const corners=overlay?[{x:0,y:0},{x:overlay.width,y:0},{x:overlay.width,y:overlay.height},{x:0,y:overlay.height}].map(p=>overlayPoint(overlay,p)):frame;
  return {coordinates:corners.map(coordinate),bounds:frame.map(coordinate)};
}

export function mapboxDrawingPoint(project,{lng,lat}){
  if(!Number.isFinite(lng)||!Number.isFinite(lat))throw new Error('Map position must be finite.');
  const alignment=project.geographicOrigin?null:project.annotationAlignment;
  const matrix=alignment?.geoToNormalizedPdf;
  if(matrix){
    const lon=lng-alignment.origin[0],latitude=lat-alignment.origin[1];
    return {x:(lon*matrix[0][0]+latitude*matrix[1][0]+matrix[2][0])*project.drawingWidthPixels,y:(lon*matrix[0][1]+latitude*matrix[1][1]+matrix[2][1])*project.drawingHeightPixels};
  }
  const setup=validateFloorPlanSetup({...project.geographicOrigin,widthMeters:project.widthMeters,heightMeters:project.heightMeters});
  const radians=Math.PI/180,radius=6378137,scale=setup.widthMeters/project.drawingWidthPixels;
  const longitude=((lng-setup.longitude+180)%360+360)%360-180;
  return {x:longitude*radians*radius*Math.cos(setup.latitude*radians)/scale,y:-(lat-setup.latitude)*radians*radius/scale};
}
