import {ConeGeometry, DoubleSide, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Path, Shape, ShapeGeometry, Vector2} from 'three';
import {floorGeojson} from './floorGeojson.js';
import {pinColor} from './polygonAppearance.js';

export function buildFloorModel(project,collection=floorGeojson(project,null,{local:true})){
  const model=new Group();
  model.name=project.name||'Floor';
  model.userData={units:'metres',heightDatum:'floor level',drawingWidthMeters:Number(project.widthMeters)};
  const materials=new Map();
  const objects=new Map(project.objects.map(object=>[object.metadata?.sourceId||object.id,object]));
  const features=collection.features;
  for(const {id,geometry,properties} of features){
    let buffer,color=properties.fillColor;
    if(geometry.type==='Polygon'){
      const rings=geometry.coordinates.map(ring=>ring.slice(0,-1).map(([x,y])=>new Vector2(x,y)));
      const shape=new Shape(rings[0]);
      shape.holes=rings.slice(1).map(ring=>new Path(ring));
      buffer=properties.height>0?new ExtrudeGeometry(shape,{depth:properties.height,bevelEnabled:false}):new ShapeGeometry(shape);
      buffer.rotateX(-Math.PI/2);
    }else if(geometry.type==='Point'){
      // The pin is a map symbol, independent of measured building geometry.
      buffer=new ConeGeometry(.35,.9,12);
      buffer.rotateZ(Math.PI);
      color=properties['marker-color']||pinColor(properties.type);
    }else continue;
    const floorSurface=geometry.type==='Polygon'&&properties.height===0;
    const offset=floorSurface&&!properties.isWalkable&&properties.type!=='Boundary'?-1:0;
    const materialKey=JSON.stringify([color,offset]);
    if(!materials.has(materialKey)){
      materials.set(materialKey,new MeshStandardMaterial({
        color,side:DoubleSide,roughness:.9,polygonOffset:offset!==0,
        polygonOffsetFactor:offset,polygonOffsetUnits:offset
      }));
    }
    const mesh=new Mesh(buffer,materials.get(materialKey));
    if(geometry.type==='Point')mesh.position.set(geometry.coordinates[0],.45,-geometry.coordinates[1]);
    else if(properties.type==='Boundary'&&properties.height===0)mesh.position.y=-.025;
    else mesh.position.y=properties.baseHeight||0;
    mesh.name=properties.name||id;
    const object=objects.get(id)||objects.get(String(id).replace(/-\d+$/,''));
    mesh.userData={objectId:object?.id||id,layerId:object?.layerId,...properties};
    model.add(mesh);
  }
  return model;
}

export function disposeFloorModel(model){
  const materials=new Set();
  for(const mesh of model.children){mesh.geometry.dispose();materials.add(mesh.material);}
  for(const material of materials)material.dispose();
}
