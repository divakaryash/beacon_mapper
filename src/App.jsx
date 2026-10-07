import React, { useEffect, useMemo, useRef, useState } from "react";
import StudioCanvas from "./components/StudioCanvas.jsx";
import GraphPanel from "./components/GraphPanel.jsx";
import BeaconPanel from "./components/BeaconPanel.jsx";
import SimulationPanel from "./components/SimulationPanel.jsx";
import CoveragePanel from "./components/CoveragePanel.jsx";
import { BEACON_PROFILES } from "./engines/beaconPlacement.js";
import { NavigationGraph } from "./engines/navigationGraph.js";
import { calculateScale, formatScale } from "./domain/scale.js";
import { measurements, moveObject } from "./engines/geometry.js";
import { useHistory } from "./hooks/useHistory.js";
import { defaultLayers, LAYERS, normalizeProject, POI_CATEGORIES, TOOLS } from "./models/drawing.js";
import { clearProject, loadProject, saveProject } from "./storage/projectStore.js";
import {sampleMall,sampleFloorSvg} from "./samples/sampleMall.js";
import { isPdf, readFloorPlan } from "./models/floorPlanImport.js";
import {useDeploymentPlanner} from "./hooks/useDeploymentPlanner.js";

const acceptedTypes = ".png,.jpg,.jpeg,.svg,.pdf";

function LayersPanel({ project, update }) {
  function setLayer(id, field, value) {
    update({ ...project, layers: { ...project.layers, [id]: { ...project.layers[id], [field]: value } } });
  }
  return (
    <section className="panel-section">
      <div className="section-title"><h2>Layers</h2><span>{LAYERS.length}</span></div>
      <div className="layer-list">
        {LAYERS.map((layer) => (
          <div className="layer-row" key={layer.id}>
            <span className="layer-color" style={{ background: layer.color }} />
            <span>{layer.label}</span>
            <button type="button" title={project.layers[layer.id]?.visible ? "Hide layer" : "Show layer"} onClick={() => setLayer(layer.id, "visible", !project.layers[layer.id]?.visible)}>{project.layers[layer.id]?.visible ? "◉" : "○"}</button>
            <button type="button" title={project.layers[layer.id]?.locked ? "Unlock layer" : "Lock layer"} onClick={() => setLayer(layer.id, "locked", !project.layers[layer.id]?.locked)}>{project.layers[layer.id]?.locked ? "🔒" : "·"}</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Inspector({ object, metersPerPixel, onChange, onDuplicate, onDelete }) {
  if (!object) return <section className="panel-section inspector-empty"><h2>Properties</h2><p>Select an object to inspect its geometry and edit its details.</p></section>;
  const metrics = measurements(object, metersPerPixel);
  const detailed = object.type === "room" || object.type === "poi";
  const field = (name, value) => onChange({ ...object, [name]: value });
  return (
    <section className="panel-section">
      <div className="section-title"><h2>Properties</h2><span>{object.type}</span></div>
      <label>ID<input value={object.id} readOnly /></label>
      {detailed && <>
        <label>Name<input value={object.name || ""} onChange={(event) => field("name", event.target.value)} /></label>
        <label>Category<input value={object.category || ""} onChange={(event) => field("category", event.target.value)} /></label>
        <label>Floor<input value={object.floor || ""} onChange={(event) => field("floor", event.target.value)} /></label>
      </>}
      {object.type === "text" && <label>Text<input value={object.text || ""} onChange={(event) => field("text", event.target.value)} /></label>}
      <label>Rotation<input type="number" value={Math.round(object.rotation || 0)} onChange={(event) => field("rotation", Number(event.target.value))} /></label>
      <label>Geometry floor ID<input value={object.floorId||"floor-1"} onChange={e=>field("floorId",e.target.value)}/></label>
      {["rectangle","room","polygon","buildingBoundary","walkableArea","restrictedArea","nonWalkableArea"].includes(object.type)&&<label>Geometry role<select value={object.geometryRole||(["rectangle","room","polygon"].includes(object.type)?"none":object.type)} onChange={e=>field("geometryRole",e.target.value)}>{[["none","Drawing only"],["buildingBoundary","Building boundary"],["walkableArea","Walkable area"],["restrictedArea","Restricted area"],["nonWalkableArea","Non-walkable area"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
      {object.type==="wall"&&<label>Wall thickness (m)<input type="number" min=".01" step=".05" value={object.thicknessMeters??.2} onChange={e=>field("thicknessMeters",Number(e.target.value))}/></label>}
      {object.type==="walkablePath"&&<label>Walkable width (m)<input type="number" min=".1" step=".1" value={object.widthMeters??2} onChange={e=>field("widthMeters",Number(e.target.value))}/></label>}
      <div className="metrics-grid">
        {metrics.area !== null && <div><span>Area</span><strong>{metrics.area.toFixed(2)} m²</strong></div>}
        {metrics.perimeter !== null && <div><span>Perimeter</span><strong>{metrics.perimeter.toFixed(2)} m</strong></div>}
        {metrics.length !== null && <div><span>Length</span><strong>{metrics.length.toFixed(2)} m</strong></div>}
        <div><span>Coordinates</span><strong>{object.points?.length ?? 1}</strong></div>
      </div>
      <div className="coordinate-list">
        {(object.points || [{ x: object.x, y: object.y }]).map((point, index) => <code key={index}>{index + 1}: {point.x.toFixed(1)}, {point.y.toFixed(1)} px</code>)}
      </div>
      <div className="button-row"><button className="secondary" type="button" onClick={onDuplicate}>Duplicate</button><button className="danger" type="button" onClick={onDelete}>Delete</button></div>
    </section>
  );
}

export default function App() {
  const history = useHistory();
  const committedProject = history.project;
  const [liveProject,setLiveProject]=useState(null);
  const project=liveProject||committedProject;
  const [tool, setTool] = useState("select");
  const [poiCategory, setPoiCategory] = useState("Store");
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("Loading local project…");
  const [graphSelection, setGraphSelection] = useState(null);
  const [route, setRoute] = useState(null);
  const [simulation,setSimulation]=useState(null);
  const [beaconSelection,setBeaconSelection]=useState(null);
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const importRequest = useRef(0);
  const [focusLocation,setFocusLocation]=useState(null);
  const [planningError,setPlanningError]=useState("");
  const committedRef=useRef(committedProject);committedRef.current=committedProject;
  const planner=useDeploymentPlanner(committedProject,(output,preview,action)=>{
    const current=committedRef.current;if(!current)return;
    const profile=[...BEACON_PROFILES,...(current.beaconProfiles||[])].find(p=>p.id===output.settings.defaultProfileId);
    const next={...current,beaconPlan:output.plan,coverageAnalysis:output.coverage,planningSettings:output.settings,coverageSettings:{...current.coverageSettings,cellSize:output.settings.cellSize},beaconProfile:profile,placementNeedsReview:false,layers:action==="generate"?{...current.layers,beacons:{visible:true,locked:false},coverage:{...current.layers.coverage,visible:true}}:current.layers};
    setPlanningError("");if(preview)setLiveProject(next);else {setLiveProject(null);history.commit(next);}
  },error=>{setPlanningError(error);setLiveProject(null);});
  useEffect(()=>setLiveProject(null),[committedProject]);
  useEffect(()=>{if(beaconSelection&&committedProject?.beaconPlan)planner.command("inspect",{}, {selection:beaconSelection});},[beaconSelection,committedProject?.beaconPlan]);

  useEffect(() => {
    loadProject().then(async (saved) => {
      if (isPdf(saved?.file) && !saved.floorPlanPreview) {
        try {
          const rendered = await readFloorPlan(saved.file);
          // Preserve existing drawing coordinates when repairing a previously saved PDF.
          saved = { ...saved, floorPlanPreview: rendered.floorPlanPreview, pdfPageCount: rendered.pdfPageCount };
        } catch (error) { setImportError(`PDF could not be opened: ${error.message}. Re-import the file to retry.`); }
      }
      history.reset(normalizeProject(saved));
      setStatus(saved ? "Restored from this browser" : "No project loaded");
    }).catch(() => setStatus("Local storage is unavailable"));
  }, []);

  useEffect(() => {
    if (!committedProject) return;
    setStatus("Saving…");
    const timer = setTimeout(() => saveProject(committedProject).then(() => setStatus("Saved locally")).catch(() => setStatus("Could not save locally")), 250);
    return () => clearTimeout(timer);
  }, [committedProject]);

  const selected = project?.objects.find((object) => object.id === selectedId);
  const scale = calculateScale(project?.widthMeters, project?.drawingWidthPixels);

  useEffect(() => {
    function shortcuts(event) {
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? history.redo() : history.undo(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") { event.preventDefault(); history.redo(); return; }
      if (typing) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) { event.preventDefault(); deleteObject(selectedId); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && selected) { event.preventDefault(); duplicateObject(selected); }
      const match = TOOLS.find(([, , shortcut]) => shortcut.toLowerCase() === event.key.toLowerCase());
      if (match && !event.metaKey && !event.ctrlKey) setTool(match[0]);
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [project, selectedId]);

  function update(next) {
    const changed=project&&(next.graph!==project.graph||next.objects!==project.objects||next.widthMeters!==project.widthMeters||next.heightMeters!==project.heightMeters||next.drawingWidthPixels!==project.drawingWidthPixels||next.drawingHeightPixels!==project.drawingHeightPixels);
    history.commit(changed?{...next,placementNeedsReview:!!next.beaconPlan,coverageAnalysis:null}:next);
  }
  function beaconAction(action,data,preview=false){
    if(!scale||!project.beaconPlan)return;
    planner.command(action,{...data,floorId:data.floorId||project.beaconEditingFloorId||project.graph.nodes[0]?.floorId||"floor-1",worldX:data.x*scale,worldY:data.y*scale},{preview,selection:data.id});
  }
  function graphAction(action, data) {
    if (!scale) { setStatus("Calibrate scale first"); return; }
    const graph = new NavigationGraph(project.graph);
    try {
      if (action === "create") graph.addNode({ ...data, worldX: data.x * scale, worldY: data.y * scale, floorId: "floor-1" }, { snapDistance: .15 });
      if (action === "move") {
        const current = graph.nodes.get(data.id);
        const near = graph.findNearbyNode(current.floorId, data.x * scale, data.y * scale, .15, data.id);
        if (near) graph.mergeNodes(data.id, near.id);
        else graph.moveNode(data.id, { ...data, worldX: data.x * scale, worldY: data.y * scale });
      }
      if (action === "connect") {
        const a = graph.nodes.get(data.source), b = graph.nodes.get(data.target);
        const crossFloor = a.floorId !== b.floorId;
        graph.addEdge({ ...data, edgeType: crossFloor ? "Lift Connection" : "Walkway", ...(crossFloor ? {distance:3} : {}) });
      }
      update({ ...project, graph: graph.serialize(), layers: { ...project.layers, navigationGraph: { visible:true, locked:false } } });
      setRoute(null);
    } catch (error) { setStatus(error.message); }
  }
  function updateObject(nextObject) { update({ ...project, objects: project.objects.map((object) => object.id === nextObject.id ? nextObject : object) }); }
  function addObject(object) { update({ ...project, objects: [...project.objects, object] }); setSelectedId(object.id); setTool("select"); }
  function deleteObject(id) { update({ ...project, objects: project.objects.filter((object) => object.id !== id) }); setSelectedId(null); }
  function duplicateObject(object) {
    const duplicate = moveObject({ ...object, id: `${object.type}-${crypto.randomUUID()}`, name: object.name ? `${object.name} copy` : object.name }, Number(project.gridSize), Number(project.gridSize));
    addObject(duplicate);
  }

  async function importFloorPlan(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    const request = ++importRequest.current;
    setImporting(true);
    setImportError("");
    const base = project || { objects: [], layers: defaultLayers(), gridSize: 20, snapToGrid: true };
    try {
      const imported = await readFloorPlan(file);
      if (request !== importRequest.current) return;
      history.reset(normalizeProject({ ...base, ...imported, name: file.name, coverageAnalysis: null, placementNeedsReview: !!base.beaconPlan, layers: { ...base.layers, floorPlan: { ...base.layers.floorPlan, visible: true } } }));
      setSelectedId(null); setGraphSelection(null); setBeaconSelection(null); setRoute(null);
    } catch (error) {
      if (request === importRequest.current) setImportError(`Could not import floor plan: ${error.message}`);
    } finally { if (request === importRequest.current) setImporting(false); }
  }

  async function reset() { await clearProject(); history.reset(null); setSelectedId(null); setStatus("No project loaded"); }

  const projectStats = useMemo(() => project ? {
    rooms: project.objects.filter((object) => object.type === "room").length,
    pois: project.objects.filter((object) => object.type === "poi").length,
    objects: project.objects.length,
  } : null, [project]);

  if (!project) return (
    <main className="welcome"><section className="welcome-card">
      <p className="eyebrow">INPS · Local planning workspace</p><h1>Model the building before placing a beacon.</h1>
      <p>Import a floor plan to start a project. Everything stays in this browser.</p>
      <label className="upload"><span>{importing ? "Opening floor plan…" : "Choose floor plan"}</span><input disabled={importing} type="file" accept={acceptedTypes} onChange={importFloorPlan} /></label><small>PNG, JPG, SVG, or PDF (first page)</small>
      {importError && <p role="alert">{importError}</p>}
      <button className="secondary" onClick={()=>history.reset(normalizeProject({...structuredClone(sampleMall),file:new File([sampleFloorSvg],"sample-mall.svg",{type:"image/svg+xml"}),layers:defaultLayers()}))}>Open sample mall</button><small>Hand-modelled demonstration, not a surveyed deployment.</small>
    </section></main>
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">Indoor Navigation Planning Studio</p><h1>{project.name || "Untitled floor"}</h1></div>
        <div className="project-stats"><span>{projectStats.rooms} rooms</span><span>{projectStats.pois} POIs</span><span>{projectStats.objects} objects</span></div>
        <div className="header-actions"><button type="button" disabled={!history.canUndo} onClick={history.undo}>Undo</button><button type="button" disabled={!history.canRedo} onClick={history.redo}>Redo</button><span className="status">{status}</span></div>
      </header>

      <nav className="tool-rail" aria-label="Drawing tools">
        {TOOLS.map(([id, label, shortcut]) => <button key={id} className={tool === id ? "active" : ""} type="button" title={`${label} (${shortcut})`} onClick={() => setTool(id)}><span>{label.slice(0, 2)}</span><small>{label}</small></button>)}
      </nav>

      <aside className="left-panel">
        <section className="panel-section">
          <div className="section-title"><h2>Floor plan</h2><span>{formatScale(scale)}</span></div>
          <label className="upload compact"><span>{importing ? "Opening floor plan…" : "Replace source"}</span><input disabled={importing} type="file" accept={acceptedTypes} onChange={importFloorPlan} /></label>
          {project.pdfPageCount && <small>PDF page 1 of {project.pdfPageCount}. Calibrate using a known drawing dimension.</small>}
          {importError && <p role="alert">{importError}</p>}
          <div className="field-grid">
            <label>Width (m)<input type="number" min="0" step="0.1" value={project.widthMeters ?? ""} onChange={(event) => update({ ...project, widthMeters: event.target.value })} /></label>
            <label>Height (m)<input type="number" min="0" step="0.1" value={project.heightMeters ?? ""} onChange={(event) => update({ ...project, heightMeters: event.target.value })} /></label>
          </div>
          <div className="field-grid">
            <label>Grid (px)<input type="number" min="2" value={project.gridSize} onChange={(event) => update({ ...project, gridSize: Math.max(2, Number(event.target.value)) })} /></label>
            <label className="check-label"><input type="checkbox" checked={project.snapToGrid} onChange={(event) => update({ ...project, snapToGrid: event.target.checked })} /> Snap to grid</label>
          </div>
          {tool === "poi" && <label>POI type<select value={poiCategory} onChange={(event) => setPoiCategory(event.target.value)}>{POI_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>}
        </section>
        <LayersPanel project={project} update={update} />
        <button className="reset" type="button" onClick={reset}>Clear local project</button>
      </aside>

      <section className="canvas-area"><StudioCanvas project={project} tool={tool} poiCategory={poiCategory} selectedId={selectedId} onSelect={setSelectedId} onAdd={addObject} onChange={updateObject} onDelete={deleteObject} graphSelection={graphSelection} setGraphSelection={setGraphSelection} onGraphAction={graphAction} route={route} setBeaconSelection={setBeaconSelection} onBeaconAction={beaconAction} focusLocation={focusLocation} beaconSelection={beaconSelection} simulation={simulation}/></section>
      <aside className="right-panel"><SimulationPanel project={committedProject} onVisualization={setSimulation}/><BeaconPanel project={project} update={update} setTool={setTool} selection={beaconSelection} setSelection={setBeaconSelection} planner={planner} error={planningError} focus={location=>setFocusLocation({...location,request:Date.now()})}/><CoveragePanel project={project} update={update} planner={planner}/><GraphPanel project={project} scale={scale} update={update} setTool={setTool} selection={graphSelection} setSelection={setGraphSelection} setRoute={setRoute} /><Inspector object={selected} metersPerPixel={scale} onChange={updateObject} onDuplicate={() => duplicateObject(selected)} onDelete={() => deleteObject(selected.id)} /></aside>
    </main>
  );
}
