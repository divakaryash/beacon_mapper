import { beaconAnnotationExport } from "../models/beaconAnnotationExport.js";
import { downloadFile } from "../models/deploymentExport.js";
import { beaconLabel, nearbyBeacons } from "../models/beaconRules.js";
import React, { useEffect, useState } from "react";
import { DEFAULT_PLANNING_SETTINGS } from "../engines/deploymentPlanner.js";
export default function BeaconPanel({ project, tool, update, setTool, selection, setSelection, planner, error, focus }) {
  const result = project.beaconPlan, settings = { ...DEFAULT_PLANNING_SETTINGS, ...project.planningSettings };
  const [exportError, setExportError] = useState("");
  const [minimum, setMinimum] = useState(String(settings.minimumSpacing)), [maximum, setMaximum] = useState(String(settings.maximumSpacing));
  useEffect(() => { setMinimum(String(settings.minimumSpacing)); setMaximum(String(settings.maximumSpacing)); }, [settings.minimumSpacing, settings.maximumSpacing]);
  const min = Number(minimum), max = Number(maximum), validRange = Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min;
  const selected = result?.beacons.find(b => b.id === selection);
  const inspector = planner.inspector?.id === selected?.id ? planner.inspector : null;
  const neighbors = selected ? nearbyBeacons(selected, result.beacons) : [];
  const floors = [...new Set(project.graph.nodes.map(n => n.floorId))];
  const command = (action, data) => planner.command(action, data, {});
  const setting = (field, value) => result ? command("configure", { [field]: value }) : update({ ...project, planningSettings: { ...settings, [field]: value } });
  return <section className="panel-section graph-panel deployment-panel">

    {/* <h2>Beacon placement</h2>

    {selected && <section className="panel-section" aria-label="Selected beacon properties" aria-live="polite">

      <h3>Beacon {beaconLabel(selected.id)} · properties</h3>

      <p>ID: {selected.id}<br />Floor: {selected.floorId}<br />Position: ({selected.worldX.toFixed(2)}, {selected.worldY.toFixed(2)}) m<br />Coverage radius: {selected.coverageRadius} m<br />Status: {selected.enabled === false ? "Disabled" : "Enabled"}{selected.locked ? " · locked" : ""}</p>

      <h4>Distances to nearby beacons</h4>

      {neighbors.length ? neighbors.map(b => <p key={b.id}>{b.direction}: Beacon {beaconLabel(b.id)} · <strong>{b.meters.toFixed(2)} m</strong></p>) : <p>No other enabled beacons on this floor.</p>}

      <small>Straight-line distances in metres. Directions follow the map.</small>

      {inspector?.nearestEdge && <p>Nearest waypoint line: {inspector.nearestEdge.distance.toFixed(2)} m</p>}

      {inspector?.nearestPoi && <p>Nearest POI: {inspector.nearestPoi.name || inspector.nearestPoi.id} · {inspector.nearestPoi.distance.toFixed(2)} m</p>}

    </section>} */}

    <form id="beacon-placement-form" onSubmit={event => {
      event.preventDefault();
      if (!planner.busy && validRange) {
        command("generate", { minimumSpacing: min, maximumSpacing: max, spacing: (min + max) / 2 });
      }
    }}>
    <label>Minimum spacing (m)<input type="number" required min="0.000001" step="any" value={minimum} onChange={e => setMinimum(e.target.value)} /></label>

    <label>Maximum spacing (m)<input type="number" required min={min > 0 ? min : "0.000001"} step="any" value={maximum} onChange={e => setMaximum(e.target.value)} /></label>

    {!validRange && <p role="alert">Enter a positive minimum and a maximum at least as large.</p>}

    </form>

    <div className="button-row">

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

    { <section className="panel-section" aria-label="Edit beacon placement">

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

    </section>}

    <label className="check-label"><input type="checkbox" checked={project.beaconLabelsVisible === true} onChange={e => update({ ...project, beaconLabelsVisible: e.target.checked })} />Show beacon IDs</label>

    {exportError && <p role="alert">

      {exportError}

    </p>}

    {error && <p role="alert">

      {error}

    </p>}

  </section>;
}
