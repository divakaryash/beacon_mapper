import {Group,Mesh} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Only the live preview is batched. Keep triangle ranges so a click still
// selects the original editable feature, even on a shared material.
export function batchFloorMeshes(source){
  const groups=new Map(),result=new Group();
  for(const mesh of source.children){
    if(!mesh.visible)continue;
    const key=mesh.material.uuid;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(mesh);
  }
  for(const meshes of groups.values()){
    const geometries=[],ranges=[];
    let triangles=0;
    for(const mesh of meshes){
      const g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
      g.translate(mesh.position.x,mesh.position.y,mesh.position.z);
      geometries.push(g);
      triangles+=g.attributes.position.count/3;
      ranges.push({end:triangles,id:mesh.userData.objectId});
    }
    const geometry=mergeGeometries(geometries);
    for(const g of geometries)g.dispose();
    const mesh=new Mesh(geometry,meshes[0].material.clone());
    mesh.userData.ranges=ranges;
    result.add(mesh);
  }
  return result;
}

export function pickedFloorObject(hit){
  return hit?.object.userData.ranges.find(range=>hit.faceIndex<range.end)?.id||null;
}

// Raycasting sees coincident triangles at the same distance. Apply the
// preview's depth priority only to those ties.
export function foremostFloorHit(hits){
  const nearest=hits[0];
  if(!nearest)return null;
  return hits.find(hit=>Math.abs(hit.distance-nearest.distance)<1e-6&&
    hit.object.material.polygonOffset&&hit.object.material.polygonOffsetFactor<0)||nearest;
}
