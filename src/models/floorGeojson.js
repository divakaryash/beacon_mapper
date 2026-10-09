import {validateFloorPlanSetup,localToGeographic} from "./floorPlanSetup.js";
import {boundsOf,objectPoints,rotatedPoint,measurements,polygonArea} from '../engines/geometry.js';

// Local drawings have no geographic origin; never invent longitude/latitude for them.
export function floorGeojson(project,reference=null){
  const scale=Number(project.widthMeters)/Number(project.drawingWidthPixels);
  if(!Number.isFinite(scale)||scale<=0)throw new Error('Calibrate the drawing scale before exporting geometry.');
  const geographicOrigin=project.geographicOrigin;
  if(geographicOrigin)validateFloorPlanSetup({...geographicOrigin,widthMeters:project.widthMeters,heightMeters:project.heightMeters});
  const alignment=geographicOrigin?null:reference?.alignment;
  const matrix=alignment?.geoToNormalizedPdf;
  const determinant=matrix?matrix[0][0]*matrix[1][1]-matrix[1][0]*matrix[0][1]:null;
  if(matrix&&(!Number.isFinite(determinant)||Math.abs(determinant)<1e-15))throw new Error('Invalid geographic alignment.');
  function coordinate(p){
    if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new Error('Cannot export nonfinite coordinates.');
    if(!matrix)return geographicOrigin?localToGeographic({x:p.x*scale,y:-p.y*scale},geographicOrigin):[p.x*scale,-p.y*scale];
    const x=p.x/project.drawingWidthPixels-matrix[2][0],y=p.y/project.drawingHeightPixels-matrix[2][1];
    return [alignment.origin[0]+(x*matrix[1][1]-y*matrix[1][0])/determinant,alignment.origin[1]+(y*matrix[0][0]-x*matrix[0][1])/determinant];
  }
  const sources=new Map((reference?.features||[]).map(f=>[f.id,f]));
  const features=[];
  for(const object of project.objects||[]){
    if(!['room','rectangle','polygon','buildingBoundary','walkableArea','restrictedArea','nonWalkableArea','wall','poi'].includes(object.type))continue;
    const source=sources.get(object.metadata?.sourceId),type=object.metadata?.sourceType||object.category||({room:'Store',wall:'Wall',buildingBoundary:'Boundary',walkableArea:'Walkable Area',restrictedArea:'Restricted Area',nonWalkableArea:'Non Walkable'}[object.type])||object.type;
    const properties={...source?.properties,type,name:object.name||type,floor:reference?.floor??object.floorId??'floor-1',isWalkable:object.type==='poi'?source?.properties?.isWalkable===true:object.type==='walkableArea'&&object.geometryRole!=='restrictedArea'&&object.layerId!=='restrictedAreas'&&!["Wall","Lift","Steps","Stairs","Escalator","Restricted Area","Non Walkable","Green Area"].includes(type),...measurements(object,scale)};
    const box=boundsOf(object),center={x:box.x+box.width/2,y:box.y+box.height/2};
    const points=objectPoints(object).map(p=>rotatedPoint(p,center,object.rotation||0));
    if(object.type==='poi'){features.push({type:'Feature',id:object.metadata?.sourceId||object.id,properties,geometry:{type:'Point',coordinates:coordinate(points[0])}});continue;}
    let polygons=[points];
    if(object.type==='wall'){
      const width=Number(object.thicknessMeters??.2)/scale;
      if(!Number.isFinite(width)||width<=0)throw new Error('Wall thickness must be positive.');
      polygons=points.slice(1).map((b,i)=>{const a=points[i],length=Math.hypot(b.x-a.x,b.y-a.y);if(!length)throw new Error('Wall segment has zero length.');const nx=-(b.y-a.y)*width/(2*length),ny=(b.x-a.x)*width/(2*length);return [{x:a.x+nx,y:a.y+ny},{x:b.x+nx,y:b.y+ny},{x:b.x-nx,y:b.y-ny},{x:a.x-nx,y:a.y-ny}];});
    }
    for(const [index,polygon] of polygons.entries()){
      if(!Number.isFinite(polygonArea(polygon))||polygonArea(polygon)<=0)throw new Error('Polygon must have positive area.');
      let ring=polygon.map(coordinate);
      if(ring.length>1&&ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1])ring.pop();
      if(ring.length<3)throw new Error('Polygon requires at least three vertices.');
      const signed=ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
      if(signed<0)ring.reverse();
      ring.push([...ring[0]]);
      features.push({type:'Feature',id:(object.metadata?.sourceId||object.id)+(polygons.length>1?`-${index+1}`:''),properties:object.type==='wall'?{...properties,...measurements({type:'polygon',points:polygon},scale)}:properties,geometry:{type:'Polygon',coordinates:[ring]}});
    }
  }
  if(!features.length)throw new Error('No floor geometry to export.');
  return {type:'FeatureCollection',name:project.name,coordinateSystem:matrix||geographicOrigin?'WGS84 longitude/latitude':'Local metres; origin at drawing top-left, positive Y points up; not geographic GeoJSON',scaleAssumed:!!project.floorAnalysis?.scaleAssumed,features};
}
