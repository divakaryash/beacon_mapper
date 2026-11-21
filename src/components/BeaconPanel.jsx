import { beaconAnnotationExport } from "../models/beaconAnnotationExport.js";
import { downloadFile } from "../models/deploymentExport.js";
import { BEACON_VIEWS, beaconCountSummary, beaconLabel, compareAnnotatedBeacons, nearbyBeacons, annotatedBeaconPositions } from "../models/beaconRules.js";
import React, { useEffect, useMemo, useState } from "react";
import { DEFAULT_PLANNING_SETTINGS } from "../engines/deploymentPlanner.js";
import { analyzeCoverage } from "../engines/coverage.js";
import { geometryForProject } from "../models/deployments.js";
import { BEACON_PROFILES } from "../engines/beaconPlacement.js";
export default function BeaconPanel({ project, tool, update, setTool, selection, setSelection, planner, error, focus }) {
  const result = project.beaconPlan, settings = { ...DEFAULT_PLANNING_SETTINGS, ...project.planningSettings };
  const [comparison, setComparison] = useState(null), [exportError, setExportError] = useState("");
  const [minimum, setMinimum] = useState(String(settings.minimumSpacing)), [maximum, setMaximum] = useState(String(settings.maximumSpacing));
  useEffect(() => { setMinimum(String(settings.minimumSpacing)); setMaximum(String(settings.maximumSpacing)); }, [settings.minimumSpacing, settings.maximumSpacing]);
  const min = Number(minimum), max = Number(maximum), validRange = Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min;
  useEffect(() => setComparison(null), [project.beaconPlan, project.annotationData, project.annotationFloor]);
  const coverage = project.coverageAnalysis;
  const annotatedCoverage = useMemo(() => {
    if (!project.annotationData || !project.annotationAlignment)
      return null;
    try {
      const profile = project.beaconProfile || BEACON_PROFILES[0];
      const beacons = annotatedBeaconPositions(project).map(b => ({
        ...b,
        coverageRadius: profile.coverageRadius,
        reliableRadius: project.planningSettings?.reliableRadius ?? DEFAULT_PLANNING_SETTINGS.reliableRadius,
        marginalRadius: project.planningSettings?.marginalRadius ?? DEFAULT_PLANNING_SETTINGS.marginalRadius
      }));
      return {
        count: beacons.length, result: analyzeCoverage({
          graph: project.graph,
          floorGeometry: geometryForProject(project), beacons, profile,
          configuration: { ...DEFAULT_PLANNING_SETTINGS, ...project.planningSettings, graphOnly: true }
        })
      };
    }
    catch (error) {
      return { error: error.message };
    }
  }, [project.annotationData, project.annotationAlignment, project.annotationFloor, project.graph,
  project.objects, project.widthMeters, project.heightMeters, project.drawingWidthPixels,
  project.drawingHeightPixels, project.planningSettings, project.beaconProfile]);
  const selected = result?.beacons.find(b => b.id === selection);
  const inspector = planner.inspector?.id === selected?.id ? planner.inspector : null;
  const neighbors = selected ? nearbyBeacons(selected, result.beacons) : [];
  const floors = [...new Set(project.graph.nodes.map(n => n.floorId))];
  const command = (action, data) => planner.command(action, data, {});
  const setting = (field, value) => result ? command("configure", { [field]: value }) : update({ ...project, planningSettings: { ...settings, [field]: value } });
  return <section className="panel-section graph-panel deployment-panel">

    <h2>

      {project.floorPlanOverlay ? "Step 3 · Beacon placement" : "Deployment planner"}


    </h2>

    {(result || project.annotationData) && <p role="status">

      <strong>

        {beaconCountSummary(project)}


      </strong>

      {project.floorAnalysis?.method === "aligned-venue-reference" && <small>Blue: navigation beacons · red: API access points. Review this initial draft before installation.</small>}


    </p>}


    {selected && <section className="panel-section" aria-label="Selected beacon properties" aria-live="polite">


      <h3>Beacon {beaconLabel(selected.id)} · properties</h3>


      <p>ID: {selected.id}<br />Floor: {selected.floorId}<br />Position: ({selected.worldX.toFixed(2)}, {selected.worldY.toFixed(2)}) m<br />Coverage radius: {selected.coverageRadius} m<br />Status: {selected.enabled === false ? "Disabled" : "Enabled"}{selected.locked ? " · locked" : ""}</p>


      <h4>Distances to nearby beacons</h4>


      {neighbors.length ? neighbors.map(b => <p key={b.id}>{b.direction}: Beacon {beaconLabel(b.id)} · <strong>{b.meters.toFixed(2)} m</strong></p>) : <p>No other enabled beacons on this floor.</p>}


      <small>Straight-line distances in metres. Directions follow the map.</small>


      {inspector?.nearestEdge && <p>Nearest waypoint line: {inspector.nearestEdge.distance.toFixed(2)} m</p>}


      {inspector?.nearestPoi && <p>Nearest POI: {inspector.nearestPoi.name || inspector.nearestPoi.id} · {inspector.nearestPoi.distance.toFixed(2)} m</p>}




    </section>}


    <section className="panel-section" aria-label="Beacon map comparison">


      <label>Beacons shown on map<select value={project.beaconView || "model"} onChange={e => update({ ...project, beaconView: e.target.value })}>


        {Object.entries(BEACON_VIEWS).map(([value, label]) => <option key={value} value={value}>

          {label}


        </option>)}




      </select></label>


      <small>Blue: model · green ring: annotated data · orange diamond: missing annotation match · red: extra model beacon. Differences use the same one-to-one 3 m matching as the comparison.</small>


      <small>Annotated positions are read only. The summaries below compare each layout separately; map coverage follows the selected view.</small>




    </section>


    {result && !project.placementNeedsReview && <section className="panel-section" aria-label="Compare annotated beacons">


      <button disabled={planner.busy} onClick={() => {
        try {
          setComparison(compareAnnotatedBeacons(project));
        }
        catch (error) {
          setComparison({ error: error.message });
        }
      }}>Compare annotated beacons</button>


      {comparison && (comparison.error ? <p role="alert">

        {comparison.error}


      </p> : <p role="status">Placement agreement: <strong>{comparison.accuracy.toFixed(1)}%</strong> · {comparison.missingBeacons.length} missing matches · {comparison.extraBeacons.length} extra model beacons · {comparison.matched}/{comparison.actual} reference beacons matched within {comparison.tolerance} m. Precision {comparison.precision.toFixed(1)}%, recall {comparison.recall.toFixed(1)}%. {comparison.meanError !== null ? `Mean matched distance ${comparison.meanError.toFixed(2)} m.` : ""} Maximum one-to-one matches within tolerance; percentage is F1, including extra and missing beacons.</p>)}




    </section>}


    <section className="panel-section" aria-label="Waypoint path coverage">


      <h3>Waypoint paths covered by model beacons</h3>


      {planner.busy ? <p role="status">Updating coverage…</p> : project.placementNeedsReview ? <p role="status">Recalculate placement to update coverage.</p> : coverage?.totalGraphLength > 0 ? <>


        <p><strong>{coverage.graphCoveragePercentage.toFixed(1)}%</strong> covered</p>


        <progress aria-label="Waypoint paths covered by beacons" max="100" value={coverage.graphCoveragePercentage} style={{ width: "100%" }} />


        <small>{coverage.graphCoveredLength.toFixed(1)} m covered of {coverage.totalGraphLength.toFixed(1)} m waypoint paths · all modelled floors.</small>


        {/* <small>Geometric coverage estimate · no RF simulation.</small> */}




      </> : <p>

        {result ? "No measurable waypoint paths available." : "Generate placement to calculate coverage."}


      </p>}




    </section>


    <section className="panel-section" aria-label="Annotated beacon waypoint path coverage">


      <h3>Waypoint paths covered by annotated beacons</h3>


      {project.placementNeedsReview ? <p role="status">Review the drawing scale before calculating annotated coverage.</p>
        : annotatedCoverage?.error ? <p role="status">

          {annotatedCoverage.error}


        </p>
          : annotatedCoverage?.result.totalGraphLength > 0 ? <>


            <p><strong>{annotatedCoverage.result.graphCoveragePercentage.toFixed(1)}%</strong> covered</p>


            <progress aria-label="Waypoint paths covered by annotated beacons" max="100" value={annotatedCoverage.result.graphCoveragePercentage} style={{ width: "100%" }} />


            <small>{annotatedCoverage.result.graphCoveredLength.toFixed(1)} m covered of {annotatedCoverage.result.totalGraphLength.toFixed(1)} m waypoint paths · {annotatedCoverage.count} annotated beacons · imported floor {project.annotationFloor}.</small>


            <button type="button" onClick={() => update({ ...project, beaconView: "data", layers: { ...project.layers, beacons: { ...project.layers.beacons, visible: true }, coverage: { ...project.layers.coverage, visible: true } } })}>Show annotated coverage on map</button>




          </> : <p>

            {annotatedCoverage ? "No measurable waypoint paths available." : "Import annotated beacon data to calculate coverage."}


          </p>}


      <small>Geometric coverage using the current planning radii and floor geometry. Model beacons are excluded from this summary.</small>




    </section>


    {result?.poiSummary && <p>{result.poiSummary.served} / {result.poiSummary.total} POIs assigned · {result.poiSummary.sharedBeacons} shared beacons</p>}


    <label className="check-label"><input type="checkbox" checked={settings.allowVoidBeacons} onChange={e => setting("allowVoidBeacons", e.target.checked)} />Allow beacons in void areas</label>

    <small>Void areas and restricted areas are separate. Restricted areas always block placement; voids remain excluded from walking routes.</small>


    <label>Minimum spacing (m)<input type="number" min="0" step="any" value={minimum} onChange={e => setMinimum(e.target.value)} /></label>


    <label>Maximum spacing (m)<input type="number" min="0" step="any" value={maximum} onChange={e => setMaximum(e.target.value)} /></label>


    {!validRange && <p role="alert">Enter a positive minimum and a maximum at least as large.</p>}


    <div className="button-row">

      <button disabled={planner.busy || !validRange} onClick={() => command("generate", { minimumSpacing: min, maximumSpacing: max, spacing: (min + max) / 2 })}>Generate placement</button>


      <button disabled={planner.busy || !result?.beacons.length} onClick={() => {
        try {
          downloadFile("beacon-annotated-data.json", beaconAnnotationExport(project));
          setExportError("");
        }
        catch (error) {
          setExportError(error.message);
        }
      }}>Export beacon JSON</button>

      <button disabled={planner.busy} onClick={() => setTool("beaconInsert")}>Place beacon</button>


    </div>

    <small>

      {project.floorAnalysis?.routeSource === "geojson" ? "JSON paths only. Lift, stair and escalator points may share one beacon when each is visible within 5 m. Connecting paths use the configured spacing range." : project.floorAnalysis?.routeSource === "missing" ? "Automatic POI placement. Lifts, stairs and escalators need a visible beacon within 5 m; nearby points may share one." : "Topology-aware mounting: graph references guide spacing, not final coordinates."}


    </small>


    <section className="panel-section" aria-label="Edit beacon placement">


      <h3>Move a beacon</h3>

      <small>Click a beacon to select it, then drag it to a new waypoint position. You can also select it below.</small>


      <label>Beacon<select disabled={planner.busy} value={selection || ""} onChange={e => {
        setSelection(e.target.value || null);
        const b = result?.beacons.find(b => b.id === e.target.value);
        if (b)
          focus(b);
      }}>

        <option value="">Choose beacon</option>

        {result?.beacons.map(b => <option key={b.id} value={b.id}>

          {beaconLabel(b.id)}

          {b.locked ? " · locked" : ""}


        </option>)}


      </select></label>


      <button disabled={planner.busy || !selected || selected.locked} onClick={() => setTool("beaconMove")}>Move selected beacon</button>


      <button className="danger" disabled={planner.busy || !selected || selected.locked} onClick={async () => {
        setTool("pan");
        const output = await command("delete", { id: selection });
        if (output)
          setSelection(null);
      }}>Delete selected beacon</button>


      {selected?.locked && <small>This beacon is locked.</small>}


      {floors.length > 1 && <label>New beacon floor<select disabled={planner.busy} value={project.beaconEditingFloorId || floors[0]} onChange={e => update({ ...project, beaconEditingFloorId: e.target.value })}>

        {floors.map(f => <option key={f}>

          {f}


        </option>)}


      </select></label>}


      {["beaconInsert", "beaconMove"].includes(tool) && <>

        <p role="status">

          {tool === "beaconInsert" ? "Click near a waypoint line to place a beacon along it." : `Click near a waypoint line for the new location of ${beaconLabel(selection) || "the selected beacon"}.`}


        </p>

        <button disabled={planner.busy} onClick={() => setTool("pan")}>Cancel · return to pan</button>


      </>}


      <small>Placement, movement and deletion update waypoint coverage. New positions snap along the nearest valid waypoint line, including between endpoints. The map returns to pan mode.</small>




    </section>


    <label className="check-label"><input type="checkbox" checked={project.beaconLabelsVisible !== false} onChange={e => update({ ...project, beaconLabelsVisible: e.target.checked })} />Show beacon IDs</label>


    {exportError && <p role="alert">

      {exportError}


    </p>}

    {error && <p role="alert">

      {error}


    </p>}




  </section>;
}
