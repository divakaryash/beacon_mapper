import { useEffect, useRef, useState } from "react";
import { BEACON_PROFILES } from "../engines/beaconPlacement.js";
import { DEFAULT_PLANNING_SETTINGS } from "../engines/deploymentPlanner.js";
import { geometryForProject } from "../models/deployments.js";

export function useDeploymentPlanner(project, onResult, onError) {
  const worker=useRef(),active=useRef(),queued=useRef([]),sequence=useRef(0),source=useRef(),expectedPlan=useRef(),observedPlan=useRef(),current=useRef();
  const [busy,setBusy]=useState(false),[inspector,setInspector]=useState(null),[work,setWork]=useState(null);
  current.current={project,onResult,onError};
  useEffect(()=>{
    worker.current=new Worker(new URL("../engines/deploymentWorker.js",import.meta.url),{type:"module"});
    worker.current.onmessage=({data:message})=>{
      const task=active.current;active.current=null;if(!task)return;
      if(message.error){source.current=null;current.current.onError(message.error);task.resolve(null);}
      else {
        const p=current.current.project;
        const stale=!p||(task.preview&&queued.current.some(t=>t.preview||t.action==="move"))||task.base.graph!==p.graph||task.base.objects!==p.objects||task.base.widthMeters!==p.widthMeters||task.base.heightMeters!==p.heightMeters||task.base.beaconProfiles!==p.beaconProfiles||(p.beaconPlan!==task.base.beaconPlan&&p.beaconPlan!==expectedPlan.current);
        if(stale)source.current=null;
        if(!stale){setInspector(message.inspector);setWork(message.output.work);if(task.action!=="inspect"){if(!task.preview)expectedPlan.current=message.output.plan;current.current.onResult(message.output,task.preview,task.action);}}
        task.resolve(message.output);
      }
      const next=queued.current.shift();
      if(next)send(next);else setBusy(false);
    };
    worker.current.onerror=()=>{current.current.onError("Deployment analysis worker failed. Reload to retry.");active.current?.resolve(null);queued.current.forEach(t=>t.resolve(null));active.current=null;queued.current=[];setBusy(false);};
    return ()=>{worker.current.terminate();active.current?.resolve(null);queued.current.forEach(t=>t.resolve(null));};
  },[]);
  function send(task){
    const p=current.current.project;
    task.base=p;
    const changed=!source.current||source.current.graph!==p.graph||source.current.objects!==p.objects||source.current.widthMeters!==p.widthMeters||source.current.heightMeters!==p.heightMeters||source.current.beaconProfiles!==p.beaconProfiles||source.current.drawingWidthPixels!==p.drawingWidthPixels||(p.beaconPlan!==observedPlan.current&&p.beaconPlan!==expectedPlan.current);
    observedPlan.current=p.beaconPlan;
    try {
      let inputs;
      if(changed){const geometry=geometryForProject(p),scale=geometry.metersPerPixel;inputs={graph:p.graph,floorGeometry:geometry,profiles:[...BEACON_PROFILES,...(p.beaconProfiles||[])],settings:{...DEFAULT_PLANNING_SETTINGS,defaultProfileId:p.beaconProfile?.id||BEACON_PROFILES[0].id,spacing:p.beaconPlan?.configuration?.spacing||5.5,planningMode:p.beaconPlan?.configuration?.mode||"hybrid",cellSize:p.coverageSettings?.cellSize||.5,...p.planningSettings},beacons:p.beaconPlan?.beacons||[],pois:p.objects.filter(o=>o.type==="poi").map(o=>({...o,floorId:o.floorId||p.graph.nodes[0]?.floorId||"floor-1",worldX:o.x*scale,worldY:o.y*scale}))};source.current=p;}
      active.current=task;worker.current.postMessage({id:task.id,inputs,action:task.action,data:task.data,selection:task.selection});
    }catch(error){current.current.onError(error.message);task.resolve(null);setBusy(false);}
  }
  function command(action,data={},options={}) {
    return new Promise(resolve=>{
      const task={id:++sequence.current,action,data,preview:!!options.preview,selection:options.selection,resolve};
      setBusy(true);
      if(active.current){if(task.preview||task.action==="inspect"){queued.current=queued.current.filter(t=>{if(t.preview||t.action==="inspect"){t.resolve(null);return false;}return true;});}queued.current.push(task);}else send(task);
    });
  }
  return {command,busy,inspector,work};
}
