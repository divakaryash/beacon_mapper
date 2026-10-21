import React,{useEffect,useRef,useState} from 'react';
import {mapboxPlacement,mapboxDrawingPoint} from '../models/mapboxPlacement.js';
import {floorGeojson} from '../models/floorGeojson.js';

let library;
function loadMapbox(){
  if(window.mapboxgl)return Promise.resolve(window.mapboxgl);
  if(!library)library=new Promise((resolve,reject)=>{
    const css=document.createElement('link');css.rel='stylesheet';css.href='https://api.mapbox.com/mapbox-gl-js/v3.32.0/mapbox-gl.css';document.head.append(css);
    const script=document.createElement('script');script.src='https://api.mapbox.com/mapbox-gl-js/v3.32.0/mapbox-gl.js';script.onload=()=>resolve(window.mapboxgl);script.onerror=()=>{library=null;reject(new Error('Could not load Mapbox. Check your internet connection.'));};document.head.append(script);
  });
  return library;
}

export default function MapboxView({project,tool,beaconSelection,setBeaconSelection,onBeaconAction}){
  const container=useRef(null);
  const camera=useRef(null);
  const interaction=useRef();
  interaction.current={tool,setBeaconSelection,onBeaconAction};
  const token=import.meta.env.MAPBOX_PUBLIC_ACCESS_TOKEN;
  const configured=token?.startsWith('pk.');
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!configured)return;
    let map,url,cancelled=false;
    setError('');
    (async()=>{
      const placement=mapboxPlacement(project);
      const gl=await loadMapbox();if(cancelled)return;
      map=new gl.Map({container:container.current,accessToken:token,style:'mapbox://styles/mapbox/streets-v12',center:placement.bounds[0],zoom:18,...camera.current});
      map.addControl(new gl.NavigationControl());
      map.on('error',event=>{if(!cancelled)setError(event.error?.message||'Mapbox could not load. Check the public token and connection.');});
      const resize=new ResizeObserver(()=>map.resize());resize.observe(container.current);map.on('remove',()=>resize.disconnect());
      map.on('click',event=>{if(interaction.current.tool==='beaconInsert')interaction.current.onBeaconAction('insert',mapboxDrawingPoint(project,event.lngLat));});
      map.on('load',()=>{
        if(cancelled)return;
        try{
          const bounds=new gl.LngLatBounds();[...placement.bounds,...placement.coordinates].forEach(p=>bounds.extend(p));if(!camera.current)map.fitBounds(bounds,{padding:60,maxZoom:22,duration:0});
          const image=project.floorPlanPreview||project.file;
          if(image&&image.type!=='application/pdf'&&project.layers.floorPlan?.visible!==false){
            url=URL.createObjectURL(image);
            map.addSource('floor-plan',{type:'image',url,coordinates:placement.coordinates});
            map.addLayer({id:'floor-plan',type:'raster',source:'floor-plan',paint:{'raster-opacity':project.floorPlanOverlay?.opacity??.7,'raster-fade-duration':0}});
          }
          if(project.layers.beacons?.visible!==false){
            const beacons=(project.beaconPlan?.beacons||[]).filter(b=>project.layers[b.enabled===false?'disabledBeacons':'navigationBeacons']?.visible!==false);
            if(beacons.length){
              const data=floorGeojson({...project,graph:{nodes:[],edges:[]},objects:beacons.map(b=>({id:b.id,type:'poi',x:b.x,y:b.y,floorId:b.floorId}))});
              for(const feature of data.features){
                const beacon=beacons.find(b=>b.id===feature.id);
                const locked=beacon.locked||project.layers.beacons?.locked||project.layers[beacon.enabled===false?'disabledBeacons':'navigationBeacons']?.locked;
                const element=document.createElement('button');element.type='button';element.className='mapbox-beacon';element.title=beacon.id;element.setAttribute('aria-label',`Beacon ${beacon.id}`);element.setAttribute('aria-pressed',String(beaconSelection===beacon.id));element.style.background=beacon.enabled===false?'#94a3b8':'#0891b2';
                const marker=new gl.Marker({element,draggable:!locked&&['select','move'].includes(tool)}).setLngLat(feature.geometry.coordinates).addTo(map);
                element.addEventListener('click',event=>{event.stopPropagation();interaction.current.setBeaconSelection(beacon.id);if(interaction.current.tool==='delete'&&!locked)interaction.current.onBeaconAction('delete',beacon);});
                marker.on('dragend',()=>interaction.current.onBeaconAction('move',{id:beacon.id,floorId:beacon.floorId,...mapboxDrawingPoint(project,marker.getLngLat())}));
              }
            }
          }
          if(project.objects.length){
            const data=floorGeojson(project);
            if(!data.coordinateSystem.startsWith('WGS84'))throw new Error('Geographic geometry is unavailable.');
            map.addSource('geometry',{type:'geojson',data});
            map.addLayer({id:'rooms',type:'fill',source:'geometry',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['get','fill'],'fill-opacity':.2}});
            map.addLayer({id:'outlines',type:'line',source:'geometry',filter:['!=',['geometry-type'],'Point'],paint:{'line-color':['coalesce',['get','stroke'],'#38bdf8'],'line-width':1.5}});
            map.addLayer({id:'pois',type:'circle',source:'geometry',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':4,'circle-color':'#f59e0b'}});
          }
        }catch(e){setError(e.message);}
      });
    })().catch(e=>{if(!cancelled)setError(e.message);});
    return ()=>{cancelled=true;if(map)camera.current={center:map.getCenter(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()};map?.remove();if(url)URL.revokeObjectURL(url);};
  },[project,token,tool,beaconSelection]);
  return <div className="mapbox-view"><div ref={container} className="mapbox-map"/>{(!configured||error)&&<div className="mapbox-settings">{!configured&&<p>Set MAPBOX_PUBLIC_ACCESS_TOKEN in .env to your public Mapbox token, then restart the app.</p>}{error&&<p role="alert">{error}</p>}</div>}</div>;
}
