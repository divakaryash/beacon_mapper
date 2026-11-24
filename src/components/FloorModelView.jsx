import React,{useEffect,useRef,useState} from 'react';
import {AmbientLight,Color,DirectionalLight,OrthographicCamera,Raycaster,Scene,Vector2,WebGLRenderer} from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {floorCameraFrame} from '../models/floorCameraFrame.js';
import {floorLabels} from './floorLabels.js';
import {buildFloorModel,disposeFloorModel} from '../models/floorModel.js';
import {downloadFile} from '../models/deploymentExport.js';
import {floorGeojson} from '../models/floorGeojson.js';
import {batchFloorMeshes,foremostFloorHit,pickedFloorObject} from '../models/floorRenderBatches.js';

export default function FloorModelView({project,onSelect}){
  const host=useRef(null),labelHost=useRef(null),state=useRef(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    const element=host.current,scene=new Scene();
    let renderer,controls,observer,frame;
    try{
      renderer=new WebGLRenderer({antialias:true});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
      element.appendChild(renderer.domElement);
      scene.background=new Color('#686868');
      scene.add(new AmbientLight(0xffffff,2));
      const sun=new DirectionalLight(0xffffff,1.4);
      sun.position.set(-2,5,3);scene.add(sun);
      const camera=new OrthographicCamera(-1,1,1,-1,.01,10000);
      const resize=()=>{
        const {clientWidth:w,clientHeight:h}=element;
        if(!w||!h)return;
        const aspect=w/h,fit=state.current?.fit;
        const halfHeight=fit?Math.max(fit.height,fit.width/aspect)*.56:1;
        camera.top=halfHeight;camera.bottom=-halfHeight;
        camera.right=halfHeight*aspect;camera.left=-camera.right;
        renderer.setSize(w,h);camera.updateProjectionMatrix();
      };
      const render=()=>{
        if(frame!=null)return;
        frame=requestAnimationFrame(()=>{
          frame=null;
          renderer.render(scene,camera);
          state.current?.positionLabels?.(camera,element.clientWidth,element.clientHeight);
        });
      };
      controls=new OrbitControls(camera,renderer.domElement);
      controls.maxPolarAngle=Math.PI/3;
      controls.minZoom=.25;
      controls.addEventListener('change',render);
      observer=new ResizeObserver(()=>{
        resize();render();
      });
      observer.observe(element);
      state.current={scene,controls,camera,render,resize};
    }catch(e){setError(e.message);}
    return ()=>{cancelAnimationFrame(frame);observer?.disconnect();controls?.dispose();renderer?.dispose();renderer?.domElement.remove();state.current=null;};
  },[]);
  useEffect(()=>{
    const view=state.current;
    if(!view)return;
    let model,source;
    try{
      const collection=floorGeojson(project,null,{local:true});
      source=buildFloorModel(project,collection);
      if(!source.children.length)throw new Error('Draw a polygon to preview the floor.');
      for(const mesh of source.children)mesh.visible=project.layers[mesh.userData.layerId]?.visible!==false;
      view.positionLabels=floorLabels(source,labelHost.current);
      model=batchFloorMeshes(source);
      view.model=model;view.scene.add(model);
      if(!view.fit||view.frameWidth!==project.widthMeters||view.file!==project.file){
        const fit=floorCameraFrame(model);
        if(!fit)throw new Error("Show a floor layer to preview its geometry.");
        const {center,radius,direction}=fit;
        view.fit=fit;
        view.camera.zoom=1;
        view.camera.near=radius/1000;view.camera.far=radius*10;
        view.resize();
        view.controls.target.copy(center);
        view.camera.position.copy(center).addScaledVector(direction,3*radius);
        view.controls.update();view.controls.saveState();view.frameWidth=project.widthMeters;view.file=project.file;
      }
      view.render();setError('');
    }catch(e){setError(e.message);}finally{if(source)disposeFloorModel(source);}
    return ()=>{view.positionLabels=null;labelHost.current?.replaceChildren();if(model){view.scene.remove(model);disposeFloorModel(model);view.model=null;}};
  },[project]);
  const pointer=useRef(null);
  function pick(e){
    if(!pointer.current||Math.hypot(e.clientX-pointer.current.x,e.clientY-pointer.current.y)>4)return;
    const view=state.current;if(!view?.model)return;
    const box=host.current.getBoundingClientRect(),ray=new Raycaster();
    ray.setFromCamera(new Vector2((e.clientX-box.left)/box.width*2-1,1-(e.clientY-box.top)/box.height*2),view.camera);
    const hits=ray.intersectObjects(view.model.children.filter(mesh=>mesh.visible),false);
    onSelect(pickedFloorObject(foremostFloorHit(hits)));
  }
  async function save(format){
    try{
      const name=(project.name||'floor').replace(/\.[^.]+$/,'');
      if(format==='glb'){
        const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
        const model=buildFloorModel(project);
        try{
          const bytes=await new GLTFExporter().parseAsync(model,{binary:true});
          downloadFile(name+'.glb',new Blob([bytes],{type:'model/gltf-binary'}));
        }finally{disposeFloorModel(model);}
      }else downloadFile(name+'.geojson',floorGeojson(project));
    }catch(e){setError(e.message);}
  }
  return <div className="model-view"><div ref={host} className="model-viewport" aria-label="3D floor model" onPointerDown={e=>{pointer.current={x:e.clientX,y:e.clientY};}} onPointerUp={pick}/>
    <div className="model-labels" ref={labelHost} aria-hidden="true"/>
    <div className="model-actions"><button onClick={()=>state.current?.controls.reset()}>Reset view</button><button onClick={()=>save('glb')}>Download GLB</button><button onClick={()=>save('geojson')}>Download polygons</button></div>
    <p className="model-help">{error||'Drag to orbit · Scroll to zoom · Click a polygon to edit'}</p></div>;
}
