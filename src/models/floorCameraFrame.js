import {Vector3} from 'three';

// The fixed opening view looks north across a level floor. Measure the drawn
// vertices in camera coordinates so an asymmetric plan is visually centered.
export function floorCameraFrame(model,pitch=Math.PI/9){
  const direction=new Vector3(0,Math.cos(pitch),Math.sin(pitch));
  const up=new Vector3(0,Math.sin(pitch),-Math.cos(pitch));
  const p=new Vector3();
  let left=Infinity,right=-Infinity,top=-Infinity,bottom=Infinity,near=-Infinity,far=Infinity;
  model.updateMatrixWorld(true);
  for(const mesh of model.children){
    if(!mesh.visible)continue;
    const vertices=mesh.geometry.getAttribute('position');
    for(let i=0;i<vertices.count;i++){
      p.fromBufferAttribute(vertices,i).applyMatrix4(mesh.matrixWorld);
      const y=p.dot(up),depth=p.dot(direction);
      left=Math.min(left,p.x);right=Math.max(right,p.x);
      bottom=Math.min(bottom,y);top=Math.max(top,y);
      far=Math.min(far,depth);near=Math.max(near,depth);
    }
  }
  if(!Number.isFinite(left))return null;
  const width=Math.max(1,right-left),height=Math.max(1,top-bottom);
  const center=new Vector3((left+right)/2,0,0).addScaledVector(up,(top+bottom)/2).addScaledVector(direction,(near+far)/2);
  return {width,height,center,direction,radius:Math.max(1,Math.hypot(width,height,near-far)/2)};
}
