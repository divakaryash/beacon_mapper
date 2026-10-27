import {suggestWaypointCoverage} from "./waypointSuggestions.js";
import { DeploymentPlanner } from "./deploymentPlanner.js";
let planner;
self.onmessage = ({data:{id,inputs,action,data,selection}}) => {
  try {
    if(inputs)planner=new DeploymentPlanner(inputs);
    if(!planner)throw new Error("No deployment loaded.");
    let output;
    if(action==="suggestCoverage"){
      output={...planner.output,coverage:{...planner.output.coverage,waypointSuggestions:suggestWaypointCoverage({graph:planner.graph,floorGeometry:planner.floorGeometry,beacons:planner.beacons,profile:planner.profile(planner.settings.defaultProfileId),configuration:planner.settings,coverage:planner.output.coverage})}};
    }
    else if(action==="generate")output=planner.generate();
    else if(action==="configure")output=planner.configure(data);
    else if(action==="recalculate")output=planner.recalculate(data.scope,data.id);
    else if(action==="inspect")output=planner.output;
    else output=planner.edit(action,data);
    self.postMessage({id,output,inspector:planner.inspector(selection||data?.id)});
  }catch(error){planner=null;self.postMessage({id,error:error.message});}
};
