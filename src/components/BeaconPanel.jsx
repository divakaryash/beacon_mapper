import React,{useEffect,useState} from "react";
import {DEFAULT_PLANNING_SETTINGS} from "../engines/deploymentPlanner.js";
function DraftField({label,value,onCommit,type="number",...props}) {
  const [draft,setDraft]=useState(String(value??""));
  useEffect(()=>setDraft(String(value??"")),[value]);
  return <label>{label}<input {...props} type={type} value={draft} required={type==="number"} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")e.target.blur();}} onBlur={e=>{if(!e.target.checkValidity()){e.target.reportValidity();setDraft(String(value??""));return;}const next=type==="number"?Number(draft):draft;if(next!==value)onCommit(next);}}/></label>;
}
export default function BeaconPanel({project,update,setTool,planner,error}) {
  const result=project.beaconPlan,settings={...DEFAULT_PLANNING_SETTINGS,...project.planningSettings};
  const command=(action,data)=>planner.command(action,data,{});
  const setting=(field,value)=>result?command("configure",{[field]:value}):update({...project,planningSettings:{...settings,[field]:value}});
  return <section className="panel-section graph-panel deployment-panel"><h2>{project.floorPlanOverlay?"Step 3 · Beacon placement":"Deployment planner"}</h2><small>{planner.busy?"Updating live analysis…":"Live geometry + graph analysis"} · no RF simulation</small>{result&&<p role="status"><strong>{result.beacons.length} IW beacons generated</strong>{project.floorAnalysis?.method==="aligned-venue-reference"&&<small>Blue: navigation beacons · red: API access points. Review this initial draft before installation.</small>}</p>}
    {result?.poiSummary&&<p>{result.poiSummary.served} / {result.poiSummary.total} POIs assigned · {result.poiSummary.sharedBeacons} shared beacons</p>}
    <label className="check-label"><input type="checkbox" checked={settings.allowVoidBeacons} onChange={e=>setting("allowVoidBeacons",e.target.checked)}/>Allow beacons in void areas</label><small>Void areas and restricted areas are separate. Restricted areas always block placement; voids remain excluded from walking routes.</small>
    <div className="button-row"><button disabled={planner.busy} onClick={()=>command("generate",{})}>Generate placement</button><button disabled={planner.busy} onClick={()=>setTool("beaconInsert")}>Insert beacon</button></div><small>{project.floorAnalysis?.routeSource==="geojson"?"JSON paths only. Lift, stair and escalator points may share one beacon when each is visible within 5 m. Connecting paths target 5–10 m spacing.":project.floorAnalysis?.routeSource==="missing"?"Automatic POI placement. Lifts, stairs and escalators need a visible beacon within 5 m; nearby points may share one.":"Topology-aware mounting: graph references guide spacing, not final coordinates."}</small>
    <label className="check-label"><input type="checkbox" checked={project.beaconLabelsVisible!==false} onChange={e=>update({...project,beaconLabelsVisible:e.target.checked})}/>Show beacon IDs</label><DraftField type="text" label="Beacon ID prefix" value={settings.beaconPrefix} maxLength={20} onCommit={value=>setting("beaconPrefix",value.trim())}/><small>Prefix applies to new beacons only. Existing IDs are preserved.</small>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
