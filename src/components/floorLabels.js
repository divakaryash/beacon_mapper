import {Vector3} from 'three';

// Project labels after orbit, zoom and resize. Give entrances and circulation
// labels priority; nearby room names become visible as the user zooms in.
export function floorLabels(model,container){
  const excluded=new Set(['Room Door','Door Only','Boundary','Wall','Beam','Piller','Unclassified floor','Restricted Area','Void','Walkable Area','Non Walkable']);
  const items=[];
  for(const mesh of model.children){
    const {type,name}=mesh.userData;
    if(!mesh.visible||!name||excluded.has(type)||/^Detected room /i.test(name))continue;
    const anchor=new Vector3();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.boundingBox.getCenter(anchor).add(mesh.position);
    anchor.y=mesh.geometry.boundingBox.max.y+mesh.position.y+.25;
    const element=document.createElement('span');
    element.textContent=name;
    if(mesh.geometry.type==='ConeGeometry'){
      element.className='model-poi-label';
      element.style.setProperty('--pin-color','#'+mesh.material.color.getHexString());
    }
    container.appendChild(element);
    items.push({anchor,element,halfWidth:Math.min(85,name.length*3.4+4),priority:mesh.geometry.type==='ConeGeometry'?0:1});
  }
  items.sort((a,b)=>a.priority-b.priority);
  const screen=new Vector3();
  return (camera,width,height)=>{
    const occupied=[];
    for(const {anchor,element,halfWidth} of items){
      screen.copy(anchor).project(camera);
      const x=(1+screen.x)*width/2,y=(1-screen.y)*height/2;
      const visible=Math.abs(screen.z)<=1&&x>halfWidth&&x<width-halfWidth&&y>15&&y<height-15&&
        !occupied.some(box=>Math.abs(y-box.y)<22&&Math.abs(x-box.x)<halfWidth+box.halfWidth);
      element.hidden=!visible;
      if(visible){element.style.left=x+'px';element.style.top=y+'px';occupied.push({x,y,halfWidth});}
    }
  };
}
