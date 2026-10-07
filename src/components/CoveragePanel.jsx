import React,{useState} from "react";
import {analyzeCoverage} from "../engines/coverage.js";
import {geometryForProject} from "../models/deployments.js";
import {BEACON_PROFILES} from "../engines/beaconPlacement.js";

export default function CoveragePanel({project,update,planner}) {
  const [error,setError]=useState("");const result=project.coverageAnalysis,settings={circles:true,heatmap:true,deadZones:true,overlap:true,gaps:true,cellSize:.5,...project.coverageSettings};
  const floors=[...new Set(project.graph.nodes.map(n=>n.floorId))];
  function setting(field,value){if(field==="cellSize"&&planner&&project.beaconPlan){planner.command("configure",{cellSize:value});return;}update({...project,coverageSettings:{...settings,[field]:value}});}
  function analyze(){if(planner){planner.command("configure",{cellSize:settings.cellSize});return;}try{const next=analyzeCoverage({graph:project.graph,floorGeometry:geometryForProject(project),beacons:project.beaconPlan.beacons,profile:project.beaconProfile||BEACON_PROFILES[0],placementQuality:project.beaconPlan.quality,configuration:{...project.planningSettings,cellSize:settings.cellSize}});update({...project,coverageAnalysis:next,layers:{...project.layers,coverage:{visible:true,locked:true}}});setError("");}catch(e){setError(e.message);}}
  function downloadReport(){const {floorReports,...summary}=result;const blob=new Blob([JSON.stringify({...summary,floors:floorReports.map(({cells,...floor})=>floor),placementWarnings:project.beaconPlan.warnings},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="deployment-quality-report.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
  return <section className="panel-section coverage-panel"><h2>Coverage analysis</h2><small>Geometry + graph only. No RF propagation, attenuation or RSSI prediction.</small>
    <label>Coverage floor<select value={settings.floorId||floors[0]||""} onChange={e=>setting("floorId",e.target.value)}>{floors.map(f=><option key={f}>{f}</option>)}</select></label>
    <label>Area resolution (m)<input type="number" min=".1" step=".1" value={settings.cellSize} onChange={e=>setting("cellSize",Number(e.target.value))}/></label>
    {[["circles","Radius circles"],["heatmap","Coverage-count heatmap"],["deadZones","Dead zones"],["overlap","Overlap"],["gaps","Graph gaps"]].map(([id,label])=><label className="check-label" key={id}><input type="checkbox" checked={settings[id]} onChange={e=>setting(id,e.target.checked)}/>{label}</label>)}
    <button onClick={analyze} disabled={!project.beaconPlan||project.placementNeedsReview}>Analyze coverage</button><small>Metrics aggregate all modelled floors; the floor selector changes the overlay only.</small>
    {project.placementNeedsReview&&<p>Recalculate placement before coverage analysis.</p>}
    {result&&<><div className="coverage-legend"><span>Red: dead</span><span>Green: single</span><span>Purple: overlap</span></div><div className="metrics-grid">
      <div><span>Walkable coverage</span><strong>{result.totalArea?`${result.coveragePercentage.toFixed(1)}%`:"Unavailable"}</strong></div><div><span>Graph coverage</span><strong>{result.graphCoveragePercentage.toFixed(1)}%</strong></div>
      <div><span>Dead zones</span><strong>{result.deadZones.length} · {result.deadZoneArea.toFixed(1)} m²</strong></div><div><span>Overlap</span><strong>{result.overlapArea.toFixed(1)} m² · {result.overlapPercentage.toFixed(1)}%</strong></div><div><span>Graph gaps</span><strong>{result.gaps.length}</strong></div>
    </div><small>Sampled area: {result.totalArea.toFixed(1)} m². Actual grid: {result.resolution.cellSize.toFixed(2)} m; graph step: {result.resolution.graphStep.toFixed(2)} m. Solid blue circles show reliable radius; dashed orange circles show marginal radius. Neither is an RF coverage guarantee.</small>
    <h3>Deployment quality report</h3><div className="metrics-grid">{Object.entries(result.quality).filter(([k])=>k.endsWith("Score")).map(([k,v])=><div key={k}><span>{k}</span><strong>{v.toFixed(1)}/100</strong></div>)}</div>
    <details><summary>Dead zones and gap analysis</summary>{result.deadZones.slice(0,30).map((d,i)=><p key={i}>{d.floorId}: {d.area.toFixed(2)} m² near ({d.bounds.x.toFixed(1)}, {d.bounds.y.toFixed(1)}) m</p>)}{result.gaps.slice(0,30).map((g,i)=><p key={i}>{g.floorId} · {g.edgeId}: {g.start.toFixed(2)}–{g.end.toFixed(2)} m ({g.length.toFixed(2)} m gap)</p>)}<small>Up to 30 entries per list; download the report for every entry.</small></details>
    <ul>{result.warnings.slice(0,30).map((w,i)=><li key={i}>{w.message}</li>)}</ul><button className="secondary" onClick={downloadReport}>Download quality report</button></>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
