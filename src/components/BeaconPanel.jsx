import {BEACON_VIEWS,beaconLabel,beaconRuleSummary,compareAnnotatedBeacons} from "../models/beaconRules.js";
import React,{useEffect,useState,useMemo} from "react";
import {DEFAULT_PLANNING_SETTINGS} from "../engines/deploymentPlanner.js";
export default function BeaconPanel({project,tool,update,setTool,selection,setSelection,planner,error,focus}) {
  const result=project.beaconPlan,settings={...DEFAULT_PLANNING_SETTINGS,...project.planningSettings};
  const [comparison,setComparison]=useState(null);
  useEffect(()=>setComparison(null),[project.beaconPlan,project.annotationData,project.annotationFloor]);
  const summary=useMemo(()=>project.beaconPlan&&!project.placementNeedsReview?beaconRuleSummary(project):null,[project]);
  const coverage=project.coverageAnalysis;
  const advice=coverage?.waypointSuggestions;
  const selected=result?.beacons.find(b=>b.id===selection);
  const floors=[...new Set(project.graph.nodes.map(n=>n.floorId))];
  const command=(action,data)=>planner.command(action,data,{});
  const setting=(field,value)=>result?command("configure",{[field]:value}):update({...project,planningSettings:{...settings,[field]:value}});
  return <section className="panel-section graph-panel deployment-panel"><h2>{project.floorPlanOverlay?"Step 3 · Beacon placement":"Deployment planner"}</h2><small>{planner.busy?"Updating live analysis…":"Live geometry + graph analysis"} · no RF simulation</small>{result&&<p role="status"><strong>{result.beacons.length} beacons generated</strong>{project.floorAnalysis?.method==="aligned-venue-reference"&&<small>Blue: navigation beacons · red: API access points. Review this initial draft before installation.</small>}</p>}
    <section className="panel-section" aria-label="Beacon map comparison">
      <label>Beacons shown on map<select value={project.beaconView||"model"} onChange={e=>update({...project,beaconView:e.target.value})}>
        {Object.entries(BEACON_VIEWS).map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select></label>
      <small>Blue: model · green ring: annotated data · orange diamond: missing annotation match · red: extra model beacon. Differences use the same one-to-one 3 m matching as the comparison.</small>
      <small>Annotated positions are read only. Coverage calculations always describe the model layout.</small>
    </section>
    <p>Priority 1: 6–10 m beacon spacing. Then cover floor connections → entry / exit → important junctions → remaining waypoints. Automatic positions less than 6 m apart are rejected, even if landmark coverage decreases. Covered dead ends need no extra beacon.</p>
    {result?.spacingNotice&&<p role="status">{result.spacingNotice}</p>}
    {summary&&<section className="panel-section" aria-label="Placement rules">
      <p>Landmarks covered: <strong>{summary.landmarks?`${(100*summary.landmarksCovered/summary.landmarks).toFixed(1)}%`:"N/A"}</strong> · {summary.landmarksCovered}/{summary.landmarks}</p>
      <p>Waypoints covered: <strong>{summary.waypointsCovered}/{summary.waypoints}</strong></p>
      <p>{summary.conflicts.length} beacons conflicting with 2 or more rules</p>
      {summary.conflicts.map(({beacon,rules})=><button key={beacon.id} className="warning-link" onClick={()=>{setSelection(beacon.id);focus(beacon);}}>{beaconLabel(beacon.id)} · {rules.join(" + ")}</button>)}
      <small>Conflicts flag spacing / mounting warnings where a beacon also serves landmark coverage. Shared coverage alone is not a conflict.</small>
      <button disabled={planner.busy} onClick={()=>{try{setComparison(compareAnnotatedBeacons(project));}catch(error){setComparison({error:error.message});}}}>Compare annotated beacons</button>
      {comparison&&(comparison.error?<p role="alert">{comparison.error}</p>:<p role="status">Placement agreement: <strong>{comparison.accuracy.toFixed(1)}%</strong> · {comparison.missingBeacons.length} missing matches · {comparison.extraBeacons.length} extra model beacons · {comparison.matched}/{comparison.actual} reference beacons matched within {comparison.tolerance} m. Precision {comparison.precision.toFixed(1)}%, recall {comparison.recall.toFixed(1)}%. {comparison.meanError!==null?`Mean matched distance ${comparison.meanError.toFixed(2)} m.`:""} Maximum one-to-one matches within tolerance; percentage is F1, including extra and missing beacons.</p>)}
    </section>}
    <section className="panel-section" aria-label="Waypoint path coverage">
      <h3>Waypoint paths covered by beacons</h3>
      {planner.busy?<p role="status">Updating coverage…</p>:project.placementNeedsReview?<p role="status">Recalculate placement to update coverage.</p>:coverage?.totalGraphLength>0?<>
        <p><strong>{coverage.graphCoveragePercentage.toFixed(1)}%</strong> covered</p>
        <progress aria-label="Waypoint paths covered by beacons" max="100" value={coverage.graphCoveragePercentage} style={{width:"100%"}} />
        <small>{coverage.graphCoveredLength.toFixed(1)} m covered of {coverage.totalGraphLength.toFixed(1)} m waypoint paths · all modelled floors.</small>
        <small>Geometric coverage estimate · no RF simulation.</small>
      </>:<p>{result?"No measurable waypoint paths available.":"Generate placement to calculate coverage."}</p>}
    </section>
    {coverage&&<section className="panel-section">
      <h3>Uncovered waypoint paths</h3>
      <p>{Math.max(0,coverage.totalGraphLength-coverage.graphCoveredLength).toFixed(1)} m uncovered · {coverage.gaps.length} gaps</p>
      <small>Red lines mark uncovered paths. Orange numbered markers show suggested additional beacons.</small>
      <button disabled={planner.busy||project.placementNeedsReview||!coverage.gaps.length} onClick={()=>command("suggestCoverage",{})}>Find beacon positions for full coverage</button>
      {advice&&<>
        <p><strong>{advice.projectedPercentage.toFixed(1)}%</strong> estimated coverage with {advice.suggestions.length} additional beacons.</p>
        <small>{advice.remainingLength>.000001?`${advice.remainingLength.toFixed(2)} m remains uncovered. Check blocked paths, mounting clearance and minimum beacon spacing; this search cannot guarantee 100%.`:"All sampled waypoint paths are covered by the proposed layout. Review mounting locations before installation."}{advice.limitReached?" Search reached its 50-beacon limit.":""}</small>
        {advice.suggestions.map(s=><button className="warning-link" key={s.id} onClick={()=>focus(s)}>{s.id} · {s.floorId} · ({s.worldX.toFixed(1)}, {s.worldY.toFixed(1)}) m ↗</button>)}
      </>}
      <details><summary>Locate gaps and causes</summary>{(advice?.reasons||coverage.gaps).slice(0,100).map((gap,i)=><button className="warning-link" key={`${gap.edgeId}-${i}`} onClick={()=>focus({x:(gap.x1+gap.x2)/2,y:(gap.y1+gap.y2)/2,floorId:gap.floorId})}>{gap.floorId} · {gap.length.toFixed(2)} m · {gap.reason||"Not covered by an enabled beacon with clear visibility. Run suggestions to inspect the cause."} ↗</button>)}</details>
    </section>}
    {result?.poiSummary&&<p>{result.poiSummary.served} / {result.poiSummary.total} POIs assigned · {result.poiSummary.sharedBeacons} shared beacons</p>}
    <label className="check-label"><input type="checkbox" checked={settings.allowVoidBeacons} onChange={e=>setting("allowVoidBeacons",e.target.checked)}/>Allow beacons in void areas</label><small>Void areas and restricted areas are separate. Restricted areas always block placement; voids remain excluded from walking routes.</small>
    <div className="button-row"><button disabled={planner.busy} onClick={()=>command("generate",{})}>Generate placement</button><button disabled={planner.busy} onClick={()=>setTool("beaconInsert")}>Place beacon</button></div><small>{project.floorAnalysis?.routeSource==="geojson"?"JSON paths only. Lift, stair and escalator points may share one beacon when each is visible within 5 m. Connecting paths target 6–10 m spacing.":project.floorAnalysis?.routeSource==="missing"?"Automatic POI placement. Lifts, stairs and escalators need a visible beacon within 5 m; nearby points may share one.":"Topology-aware mounting: graph references guide spacing, not final coordinates."}</small>
    <section className="panel-section" aria-label="Edit beacon placement">
      <h3>Move a beacon</h3>
      <label>Beacon<select disabled={planner.busy} value={selection||""} onChange={e=>{setSelection(e.target.value||null);const b=result?.beacons.find(b=>b.id===e.target.value);if(b)focus(b);}}><option value="">Choose beacon</option>{result?.beacons.map(b=><option key={b.id} value={b.id}>{beaconLabel(b.id)}{b.locked?" · locked":""}</option>)}</select></label>
      <button disabled={planner.busy||!selected||selected.locked} onClick={()=>setTool("beaconMove")}>Move selected beacon</button>
      <button className="danger" disabled={planner.busy||!selected||selected.locked} onClick={async()=>{setTool("pan");const output=await command("delete",{id:selection});if(output)setSelection(null);}}>Delete selected beacon</button>
      {selected?.locked&&<small>This beacon is locked.</small>}
      {floors.length>1&&<label>New beacon floor<select disabled={planner.busy} value={project.beaconEditingFloorId||floors[0]} onChange={e=>update({...project,beaconEditingFloorId:e.target.value})}>{floors.map(f=><option key={f}>{f}</option>)}</select></label>}
      {["beaconInsert","beaconMove"].includes(tool)&&<><p role="status">{tool==="beaconInsert"?"Click near a waypoint line to place a beacon along it.":`Click near a waypoint line for the new location of ${beaconLabel(selection)||"the selected beacon"}.`}</p><button disabled={planner.busy} onClick={()=>setTool("pan")}>Cancel · return to pan</button></>}
      <small>Placement, movement and deletion update waypoint coverage. New positions snap along the nearest valid waypoint line, including between endpoints. The map returns to pan mode.</small>
    </section>
    <label className="check-label"><input type="checkbox" checked={project.beaconLabelsVisible!==false} onChange={e=>update({...project,beaconLabelsVisible:e.target.checked})}/>Show beacon IDs</label>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
