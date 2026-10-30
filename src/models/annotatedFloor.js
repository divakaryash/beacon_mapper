import polygonClipping from 'polygon-clipping';
import {validateFloorPlanSetup} from './floorPlanSetup.js';

export function annotationFeatures(payload){
  const features=Array.isArray(payload)?payload:payload?.features??payload?.data??payload?.mappingElements;
  if(!Array.isArray(features)||!features.length||features.length>10000)throw new Error('Provide GeoJSON features, mappingElements, or an API data array (up to 10,000 features).');
  if(!payload?.mappingElements||!payload.masterGraph)return features;
  const graph=payload.masterGraph;
  if(typeof graph!=='object'||Array.isArray(graph)||Object.keys(graph).length>10000)throw new Error('Invalid masterGraph node collection.');
  const nodes=new Map(Object.keys(graph).map(key=>{
    const fields=key.split(','),floor=Number(fields[3]),coordinates=fields.slice(4).map(Number);
    if(fields.length!==6||fields.slice(1).some(v=>v.trim()===''||!Number.isFinite(Number(v)))||Math.abs(coordinates[0])>180||Math.abs(coordinates[1])>=89.9)throw new Error('masterGraph nodes require local x/y, floor and valid longitude/latitude.');
    return [key,{floor,coordinates}];
  }));
  const routes=[],seen=new Set();
  for(const [key,a] of nodes){
    if(!Array.isArray(graph[key]))throw new Error('masterGraph neighbors must be arrays.');
    for(const target of graph[key]){
      const b=nodes.get(target);
      if(!b)throw new Error('masterGraph contains a missing destination node.');
      const pair=JSON.stringify([key,target].sort());
      // Cross-floor transport is represented by its landmarks, never by a same-floor walking line.
      if(a.floor!==b.floor||seen.has(pair)||a.coordinates.every((n,i)=>n===b.coordinates[i]))continue;
      seen.add(pair);
      routes.push({type:'Feature',id:`master-route-${routes.length+1}`,properties:{level:a.floor,lineCategory:'waypoint',source:'masterGraph'},geometry:{type:'LineString',coordinates:[a.coordinates,b.coordinates]}});
      if(features.length+routes.length>10000)throw new Error('Annotation export exceeds the 10,000-feature import limit.');
    }
  }
  return [...features,...routes];
}

export function annotationFloors(payload){
  const features=annotationFeatures(payload);
  if(!Array.isArray(features)||!features.length||features.length>10000)throw new Error('Provide a GeoJSON FeatureCollection, feature array, or API response with data (up to 10,000 features).');
  const floors=[...new Set(features.filter(f=>f?.geometry?.type==='Polygon'&&f.properties?.type!=='Boundary').map(f=>String(f.properties?.floor??f.properties?.level??'0')))];
  if(!floors.length)throw new Error('No annotated floor polygons found.');
  return {features,floors};
}

export function waypointRoutes(payload){
  const features=annotationFeatures(payload);
  if(!Array.isArray(features)||!features.length||features.length>10000)throw new Error('Provide waypoint JSON with up to 10,000 features.');
  const routes=features.filter(f=>f.properties?.lineCategory==='waypoint'&&['LineString','MultiLineString'].includes(f.geometry?.type));
  if(!routes.length)throw new Error('No waypoint LineString or MultiLineString features found.');
  if(routes.some(f=>!Number.isFinite(Number(f.properties?.level??f.properties?.floor))||(f.properties?.level??f.properties?.floor)==null))throw new Error('Every waypoint line must specify a numeric level.');
  return routes.map(f=>({...f,properties:{...f.properties,floor:Number(f.properties.level??f.properties.floor)}}));
}

export function annotationSetup(payload,floor){
  const {features}=annotationFloors(payload);
  let west=Infinity,east=-Infinity,north=-Infinity,south=Infinity;
  function visit(coordinates){
    if(!Array.isArray(coordinates))throw new Error('Annotations contain invalid geographic coordinates.');
    if(typeof coordinates[0]==='number'){
      const [lon,lat]=coordinates;
      if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>=89.9)throw new Error('Annotations contain invalid geographic coordinates.');
      west=Math.min(west,lon);east=Math.max(east,lon);north=Math.max(north,lat);south=Math.min(south,lat);
    }else for(const child of coordinates)visit(child);
  }
  for(const feature of features){
    if(String(feature.properties?.floor??feature.properties?.level??'0')!==String(floor)||['Centroid','Beacon'].includes(feature.properties?.type))continue;
    visit(feature.geometry?.coordinates);
  }
  const radians=Math.PI/180,radius=6378137;
  return validateFloorPlanSetup({latitude:north,longitude:west,widthMeters:(east-west)*radius*radians*Math.cos(north*radians),heightMeters:(north-south)*radius*radians});
}

export function annotatedReference(payload,floor,values,routePayload=null){
  if(String(floor).trim()===""||!Number.isFinite(Number(floor)))throw new Error("Select a numeric floor number.");
  const setup=validateFloorPlanSetup(values),{features}=annotationFloors(payload);
  const routes=routePayload?waypointRoutes(routePayload).filter(f=>String(f.properties.floor)===String(floor)):null;
  if(routes&&!routes.length)throw new Error(`No waypoint lines found for level ${floor}. Choose its matching floor annotations.`);
  const combined=routes?[...features.filter(f=>!['LineString','MultiLineString'].includes(f.geometry?.type)),...routes]:features;
  const selected=combined.filter(f=>String(f.properties?.floor??f.properties?.level??'0')===String(floor)&&f.properties?.type!=='Centroid'&&f.properties?.type!=='Beacon');
  if(!selected.some(f=>f.geometry?.type==='Polygon'&&f.properties?.type!=='Boundary'))throw new Error('Selected floor has no annotated polygons.');
  const radians=Math.PI/180,radius=6378137;
  const sx=radius*radians*Math.cos(setup.latitude*radians)/setup.widthMeters,sy=-radius*radians/setup.heightMeters;
  const project=([lon,lat])=>{
    if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)throw new Error('Annotations contain invalid geographic coordinates.');
    const p=[(lon-setup.longitude)*sx,(lat-setup.latitude)*sy];
    if(p.some(n=>n<-.02||n>1.02))throw new Error('Annotations fall outside the map. Enter the map’s actual top-left latitude/longitude and full dimensions; arbitrary coordinates cannot align geographic polygons.');
    return p;
  };
  const explicit=selected.find(f=>f.properties?.type==='Boundary'&&f.geometry?.coordinates?.[0]?.length>=4);
  const points=selected.filter(f=>f.geometry?.type==='Polygon'&&f.properties?.type!=='Boundary').flatMap(f=>f.geometry.coordinates[0].map(project));
  if(points.length<3)throw new Error('No usable polygon coordinates.');
  // shortcut: missing boundaries use a convex envelope; review concave facades before installation.
  const chain=items=>{const result=[];for(const p of items){while(result.length>1){const a=result.at(-2),b=result.at(-1);if((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])>0)break;result.pop();}result.push(p);}return result;};
  const sorted=points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const boundary=explicit?explicit.geometry.coordinates[0].map(project):[...chain(sorted).slice(0,-1),...chain([...sorted].reverse()).slice(0,-1)];
  if(boundary.length<3)throw new Error('Floor boundary is degenerate.');
  const ids=new Set();
  const repaired=selected.flatMap(feature=>{
    if(feature.geometry?.type!=="Polygon"||feature.properties?.type==="Boundary")return [feature];
    if(!feature.geometry.coordinates?.[0]?.length)throw new Error(`Empty annotation polygon: ${feature.id}`);
    const polygons=polygonClipping.union(feature.geometry.coordinates);
    if(!polygons.length)throw new Error(`Annotation polygon has no area: ${feature.id}`);
    return polygons.map((coordinates,index)=>({...feature,id:index?`${feature.id}-part-${index}`:feature.id,geometry:{...feature.geometry,coordinates}}));
  });
  const normalized=repaired.map((feature,index)=>{
    const sourceId=String(feature.id??feature._id??`annotation-${index}`);
    let id=sourceId;
    while(ids.has(id))id=`${id}-${index}`;
    ids.add(id);
    return {...feature,id,properties:{...feature.properties,originalFeatureId:sourceId,floor:Number(floor)}};
  });
  return {uploaded:true,name:`Annotated floor ${floor}`,floor:Number(floor),features:normalized,alignment:{origin:[setup.longitude,setup.latitude],widthMeters:setup.widthMeters,geoToNormalizedPdf:[[sx,0],[0,sy],[0,0]],boundary,boundarySource:explicit?'Uploaded building boundary.':'Inferred convex outer boundary: review exterior gaps and courtyards before installing beacons.'}};
}
