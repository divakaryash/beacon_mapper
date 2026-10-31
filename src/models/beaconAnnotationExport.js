import {floorGeojson} from './floorGeojson.js';

export function beaconAnnotationExport(project){
  const payload=project.annotationData;
  const key=Array.isArray(payload)?null:['features','data','mappingElements'].find(k=>Array.isArray(payload?.[k]));
  const source=key?payload[key]:Array.isArray(payload)?payload:null;
  if(!source||!project.annotationAlignment)throw new Error('Import annotated JSON before exporting beacon annotations.');
  if(!project.beaconPlan)throw new Error('Generate beacon placement before exporting.');
  const floor=String(project.annotationFloor),onFloor=f=>String(f.properties?.floor??f.properties?.level??0)===floor;
  const current=source.filter(onFloor),template=current.find(f=>f.properties?.type==='Beacon')||current[0];
  const buildingId=template?.building_ID??current.find(f=>f.building_ID)?.building_ID;
  const beacons=project.beaconPlan.beacons.filter(b=>b.enabled!==false);
  const points=floorGeojson({...project,geographicOrigin:null,graph:{nodes:[],edges:[]},objects:beacons.map(b=>({id:b.id,type:'poi',category:'Beacon',x:b.x,y:b.y}))}).features;
  // Source local coordinates can use a rotated frame unrelated to the canvas.
  const pairs=[];
  function collect(geo,local){
    if(!Array.isArray(geo)||!Array.isArray(local))return;
    if(typeof geo[0]==='number'){if([...geo,...local].every(Number.isFinite)&&local.length===2)pairs.push({geo,local});}
    else geo.forEach((p,i)=>collect(p,local[i]));
  }
  for(const f of current)collect(f.geometry?.coordinates,f.geometry?.coordinnatesLocal);
  const a=pairs[0];
  const b=a&&pairs.reduce((best,p)=>Math.hypot(p.geo[0]-a.geo[0],p.geo[1]-a.geo[1])>Math.hypot(best.geo[0]-a.geo[0],best.geo[1]-a.geo[1])?p:best,a);
  const cross=p=>(b.geo[0]-a.geo[0])*(p.geo[1]-a.geo[1])-(b.geo[1]-a.geo[1])*(p.geo[0]-a.geo[0]);
  const c=b&&pairs.reduce((best,p)=>Math.abs(cross(p))>Math.abs(cross(best))?p:best,a);
  const determinant=c&&cross(c);
  function localCoordinate(p){
    if(!determinant)return null;
    const dx=p[0]-a.geo[0],dy=p[1]-a.geo[1];
    const u=(dx*(c.geo[1]-a.geo[1])-dy*(c.geo[0]-a.geo[0]))/determinant,v=((b.geo[0]-a.geo[0])*dy-(b.geo[1]-a.geo[1])*dx)/determinant;
    return a.local.map((value,i)=>Math.round(value+u*(b.local[i]-value)+v*(c.local[i]-value)));
  }
  const added=points.map((f,i)=>{
    const beacon=beacons[i],coordinates=f.geometry.coordinates,local=localCoordinate(coordinates);
    return {id:`beacon-${floor}-${beacon.id}`,...(buildingId?{building_ID:buildingId}:{}),geometry:{type:'Point',coordinates,...(local?{coordinnatesLocal:local}:{})},properties:{name:beacon.id,centroid:coordinates,level:Number(floor),type:'Beacon',direction:'Bidirectional',surface:'accessible',isForAlign:false,imageLive:true,textLive:true,visibleWaypoint:true,hideElement:false,visible:true,isWalkable:false},type:'Feature',...(template?.createdBy?{createdBy:template.createdBy}:{}),locked:!!beacon.locked,__v:0};
  });
  const features=source.filter(f=>!(onFloor(f)&&f.properties?.type==='Beacon'));
  if(project.waypointData){
    const routes=Array.isArray(project.waypointData)?project.waypointData:['features','data','mappingElements'].map(k=>project.waypointData[k]).find(Array.isArray)||[];
    const ids=new Set(features.map(f=>f.id??f._id));
    for(const route of routes)if((route.id??route._id)==null||!ids.has(route.id??route._id)){features.push(route);ids.add(route.id??route._id);}
  }
  features.push(...added);
  return key?{...payload,[key]:features}:features;
}
