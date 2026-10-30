import {createManualAnnotationProject} from "./models/floorPlanOverlay.js";
import FloorPlanAlignment from "./components/FloorPlanAlignment.jsx";
import {annotationFeatures,annotationFloors,annotationSetup} from "./models/annotatedFloor.js";
import {validateFloorPlanSetup} from "./models/floorPlanSetup.js";
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
import { isPdf, readFloorPlan, analyzeImportedFloor, matchingFloorReference } from "./models/floorPlanImport.js";
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
  const field = (name, value) => onChange({ ...object, [name]: value,...(name==="geometryRole"&&value==="voidArea"?{type:"voidArea",layerId:"voidAreas",category:"Void",metadata:{...object.metadata,sourceType:"Void"}}:name==="geometryRole"&&value==="restrictedArea"?{type:"restrictedArea",layerId:"restrictedAreas",category:"Restricted Area",metadata:{...object.metadata,sourceType:"Restricted Area"}}:{}) });
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
      {["rectangle","room","polygon","buildingBoundary","walkableArea","restrictedArea","voidArea","nonWalkableArea"].includes(object.type)&&<label>Geometry role<select value={object.geometryRole||(["rectangle","room","polygon"].includes(object.type)?"none":object.type)} onChange={e=>field("geometryRole",e.target.value)}>{[["none","Drawing only"],["buildingBoundary","Building boundary"],["walkableArea","Walkable area"],["restrictedArea","Restricted area"],["voidArea","Void area"],["nonWalkableArea","Non-walkable area"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
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
  const [tool, setTool] = useState("pan");
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
  const [importMode,setImportMode]=useState("annotated");
  const [pendingMap,setPendingMap]=useState(null);
  const [annotationData,setAnnotationData]=useState(null);
  const [waypointData,setWaypointData]=useState(null);
  const [annotationFloor,setAnnotationFloor]=useState("");
  const floorProjects=useRef(new Map());
  function selectAnnotationFloor(floor){
    try{
      const setup=annotationSetup(annotationData,floor);
      if(project?.annotationData===annotationData){
        floorProjects.current.set(project.annotationFloor,project);
        const next=floorProjects.current.get(floor)||normalizeProject({
          ...createManualAnnotationProject({},annotationData,floor,waypointData),
          layers:defaultLayers(),gridSize:20,snapToGrid:false
        });
        ++importRequest.current;
        setLiveProject(null);history.reset(next);
        setSelectedId(null);setGraphSelection(null);setBeaconSelection(null);setRoute(null);setSimulation(null);
        setTool(next.floorPlanOverlay?"alignMap":"select");
        setStatus(`Floor ${floor} loaded`);
      }
      setUploadSetup(setup);setAnnotationFloor(floor);setImportError("");
    }catch(error){setImportError(error.message);}
  }
  const annotationFields=<section>
    <p>Upload GeoJSON and waypoint data (required). Floors are read from the data. A floor plan image is optional.</p>
    <label>GeoJSON / waypoint data (required)<input type="file" required multiple accept=".json,.geojson,.txt" disabled={importing} onChange={async e=>{
      const files=Array.from(e.target.files||[]);if(!files.length)return;
      try{
        const payload={type:"FeatureCollection",features:(await Promise.all(files.map(async file=>{
          try{return annotationFeatures(JSON.parse(await file.text()));}
          catch(error){throw new Error(`${file.name}: ${error.message}`);}
        }))).flat()};
        const parsed=annotationFloors(payload);
        const setup=annotationSetup(payload,parsed.floors[0]);
        floorProjects.current.clear();setAnnotationData(payload);setWaypointData(null);
        setAnnotationFloor(parsed.floors[0]);setUploadSetup(setup);setImportMode("annotated");setImportError("");
      }catch(error){setAnnotationData(null);setWaypointData(null);setImportError(error.message);}
    }}/></label>
    {annotationData&&<label>Floor / level<select value={annotationFloor} disabled={importing} onChange={e=>selectAnnotationFloor(e.target.value)}>
      {annotationFloors(annotationData).floors.map(f=><option key={f} value={f}>Floor {f}</option>)}
    </select></label>}
  </section>;
  const [uploadSetup,setUploadSetup]=useState({latitude:"",longitude:"",widthMeters:"",heightMeters:""});
  let uploadReady=false,setupError="";
  try {validateFloorPlanSetup(uploadSetup);uploadReady=true;} catch(error) {setupError=error.message;}
  const uploadFields=<div><p><small>{importMode==="annotated"?"GeoJSON defines the fixed workspace and physical scale. Move, rotate, resize or flip the floor plan overlay in Step 2.":"Anchor: top-left of the drawing. North is up; east is right. Dimensions cover the entire uploaded drawing, including its margins."}</small></p><div className="field-grid">{[["latitude","Initial latitude"],["longitude","Initial longitude"],["widthMeters","Drawing width (m)"],["heightMeters","Drawing height (m)"]].map(([key,label])=><label key={key}>{label}<input type="number" step="any" required disabled={importing||importMode==="annotated"} value={uploadSetup[key]} onChange={e=>setUploadSetup({...uploadSetup,[key]:e.target.value})}/></label>)}</div></div>;
  const [focusLocation,setFocusLocation]=useState(null);
  const [planningError,setPlanningError]=useState("");
  const committedRef=useRef(committedProject);committedRef.current=committedProject;
  const planner=useDeploymentPlanner(committedProject,(output,preview,action)=>{
    const current=committedRef.current;if(!current)return;
    const profile=[...BEACON_PROFILES,...(current.beaconProfiles||[])].find(p=>p.id===output.settings.defaultProfileId);
    const next={...current,beaconPlan:output.plan,coverageAnalysis:output.coverage,planningSettings:output.settings,coverageSettings:{...current.coverageSettings,cellSize:output.settings.cellSize},beaconProfile:profile,autoPlanPending:false,deploymentError:null,placementNeedsReview:!!current.floorAnalysis?.scaleAssumed,layers:action==="generate"?{...current.layers,beacons:{visible:true,locked:false},coverage:{...current.layers.coverage,visible:!current.floorAnalysis}}:current.layers};
    setPlanningError("");if(preview)setLiveProject(next);else {setLiveProject(null);history.commit(next);}
  },error=>{setPlanningError(error);setLiveProject(null);if(committedRef.current)history.commit({...committedRef.current,autoPlanPending:false,deploymentError:error});});
  useEffect(()=>setLiveProject(null),[committedProject]);
  const autoPlanning=useRef(null);
  useEffect(()=>{
    if(!committedProject?.autoPlanPending||autoPlanning.current===committedProject.graph)return;
    autoPlanning.current=committedProject.graph;
    planner.command("generate");
  },[committedProject]);
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
      if(saved?.annotationData){
        setAnnotationData(saved.annotationData);setAnnotationFloor(saved.annotationFloor);setWaypointData(saved.waypointData||null);
        setUploadSetup(annotationSetup(saved.annotationData,saved.annotationFloor));setImportMode("annotated");
      }
      const restored=normalizeProject(saved);
      history.reset(restored);
      setStatus(saved ? "Restored from this browser" : "No project loaded");
      if(saved&&saved.floorAnalysis?.method!=="aligned-venue-reference"&&saved.floorAnalysis?.method!=="uploaded-annotations"){
        try {
          const reference=await matchingFloorReference(saved);
          if(reference){
            const detected=await analyzeImportedFloor(saved,Number(saved.widthMeters)/saved.drawingWidthPixels);
            if(committedRef.current?.objects!==restored.objects)return;
            // Keep the previous drawing in undo history when replacing a bad inferred map.
            history.commit(normalizeProject({...restored,referencePresentationInitialized:false,objects:detected.objects,graph:detected.graph,widthMeters:detected.widthMeters,heightMeters:detected.heightMeters,floorAnalysis:detected.analysis,beaconPlan:null,coverageAnalysis:null,activeDeploymentId:null,placementNeedsReview:false,planningSettings:{...restored.planningSettings,nextBeaconNumber:1,cellSize:1,additionalBeaconBudget:100},autoPlanPending:false,layers:{...restored.layers,navigationGraph:{visible:true,locked:false},beacons:{visible:true,locked:false},coverage:{visible:true,locked:false}}}));
          }
        }catch(error){setImportError(`Reference correction could not be applied: ${error.message}`);}
      }
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
      if (event.key === "Escape") setTool("pan");

    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [project, selectedId]);

  function update(next) {
    const changed=project&&(next.graph!==project.graph||next.objects!==project.objects||next.widthMeters!==project.widthMeters||next.heightMeters!==project.heightMeters||next.drawingWidthPixels!==project.drawingWidthPixels||next.drawingHeightPixels!==project.drawingHeightPixels);
    if(project?.floorAnalysis&&next.widthMeters!==project.widthMeters&&Number(next.widthMeters)>0){
      const scale=Number(next.widthMeters)/next.drawingWidthPixels;
      next={...next,heightMeters:next.drawingHeightPixels*scale,graph:{...next.graph,nodes:next.graph.nodes.map(n=>({...n,worldX:n.x*scale,worldY:n.y*scale})),edges:next.graph.edges.map(e=>{const a=next.graph.nodes.find(n=>n.id===e.source),b=next.graph.nodes.find(n=>n.id===e.target);return {...e,distance:Math.hypot(a.x-b.x,a.y-b.y)*scale};})},beaconPlan:null,coverageAnalysis:null,planningSettings:{...next.planningSettings,nextBeaconNumber:1},autoPlanPending:false,floorAnalysis:{...next.floorAnalysis,scaleAssumed:false,scaleSource:{kind:'user-dimensions',widthMeters:Number(next.widthMeters),heightMeters:next.drawingHeightPixels*scale}}};
    }
    history.commit(changed?{...next,placementNeedsReview:!!next.beaconPlan,coverageAnalysis:null}:next);
  }
  async function beaconAction(action,data,preview=false){
    if(!scale||(!project.beaconPlan&&action!=="insert"))return;
    if(!preview)setTool("pan");
    const output=await planner.command(action,{...data,snapToWaypoint:["move","insert"].includes(action)&&project.graph.edges.length>0,floorId:data.floorId||project.beaconEditingFloorId||project.graph.nodes[0]?.floorId||"floor-1",worldX:data.x*scale,worldY:data.y*scale},{preview,selection:data.id});
    if(output&&!preview)setBeaconSelection(data.id||output.plan.beacons.at(-1)?.id||null);
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

  async function importFloorPlan(file) {
    if (!file && !annotationData) return;
    const request = ++importRequest.current;
    setImporting(true);
    setImportError("");
    setPlanningError("");
    setLiveProject(null);
    const base = { objects: [], graph:{nodes:[],edges:[]}, layers: defaultLayers(), gridSize: 20, snapToGrid: false };
    try {
      const setup=validateFloorPlanSetup(uploadSetup);
      const annotated=importMode==="annotated";
      const imported = file?await readFloorPlan(file,{annotated}):{};
      if(request!==importRequest.current)return;
      let next;
      if(annotated){
        next=createManualAnnotationProject(imported,annotationData,annotationFloor,waypointData);
      }else{
        imported.drawingHeightPixels=imported.drawingWidthPixels*setup.heightMeters/setup.widthMeters;
        const metersPerPixel=setup.widthMeters/imported.drawingWidthPixels;
        const detected=await analyzeImportedFloor(imported,metersPerPixel);
        next={...imported,name:file.name,widthMeters:setup.widthMeters,heightMeters:setup.heightMeters,geographicOrigin:{latitude:setup.latitude,longitude:setup.longitude},objects:detected.objects,graph:detected.graph,floorAnalysis:detected.analysis,autoPlanPending:false};
      }
      if(request!==importRequest.current)return;
      history.reset(normalizeProject({...base,...next,layers:{...base.layers,navigationGraph:{visible:true,locked:false},beacons:{visible:true,locked:false},coverage:{visible:false,locked:false}}}));
      setPendingMap(null);setSelectedId(null);setGraphSelection(null);setBeaconSelection(null);setRoute(null);setSimulation(null);
      floorProjects.current.clear();
      setTool(next.floorPlanOverlay?"alignMap":"select");
      setStatus(annotated?`Floor ${annotationFloor} imported`:"Map imported · generate placement when ready");
    } catch (error) {
      if (request === importRequest.current) setImportError(`Could not import floor plan: ${error.message}`);
    } finally { if (request === importRequest.current) setImporting(false); }
  }

  async function reset() { ++importRequest.current;setImporting(false);await clearProject(); history.reset(null); setSelectedId(null); setStatus("No project loaded"); }

  const projectStats = useMemo(() => project ? {
    rooms: project.objects.filter((object) => object.type === "room").length,
    pois: project.objects.filter((object) => object.type === "poi").length,
    objects: project.objects.length,
  } : null, [project]);

  const importHint=!annotationData?"Upload GeoJSON / waypoint data to continue.":!uploadReady?setupError:"Ready to import. Floor plan image is optional.";
  const importActions=<div className="import-actions">{pendingMap&&<p>Selected map: {pendingMap.name} <button type="button" disabled={importing} onClick={()=>setPendingMap(null)}>Remove</button></p>}<p role="status">{importing?"Importing data…":importHint}</p><button type="button" disabled={importing||!uploadReady||!annotationData} onClick={()=>importFloorPlan(pendingMap||(project?.annotationData===annotationData&&project.annotationFloor===annotationFloor?project.file:null))}>{importing?"Importing…":"Import data"}</button></div>;

  if (!project) return (
    <main className="welcome"><section className="welcome-card">
      <p className="eyebrow">INPS · Local planning workspace</p><h1>Import your map. Align it yourself.</h1>
      <p>Import your floor geometry and waypoints. Optionally add a floor plan image for alignment. Generate beacons when you choose. Everything stays in this browser.</p>
      {annotationFields}{uploadFields}<label className="upload"><span>{importing ? "Analyzing floor plan…" : "Choose floor plan (optional)"}</span><input disabled={importing} type="file" accept={acceptedTypes} onChange={e=>{setPendingMap(e.target.files?.[0]||null);e.target.value="";}} /></label>{importActions}<small>PNG, JPG, SVG, or PDF (first page)</small>
      {importError && <p role="alert">{importError}</p>}
      <button className="secondary" onClick={()=>history.reset(normalizeProject({...structuredClone(sampleMall),file:new File([sampleFloorSvg],"sample-mall.svg",{type:"image/svg+xml"}),layers:defaultLayers()}))}>Open sample mall</button><small>Hand-modelled demonstration, not a surveyed deployment.</small>
    </section></main>
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">Indoor Navigation Planning Studio</p><h1>{project.name || "Untitled floor"}</h1></div>
        <div className="project-stats"><span>{projectStats.rooms} rooms</span><span>{projectStats.pois} POIs</span><span>{projectStats.objects} objects</span>{project.beaconPlan&&<span>{project.beaconPlan.beacons.length} IW beacons</span>}</div>
        <div className="header-actions"><button type="button" disabled={!history.canUndo} onClick={history.undo}>Undo</button><button type="button" disabled={!history.canRedo} onClick={history.redo}>Redo</button><span className="status">{status}</span></div>
      </header>

      <aside className="left-panel">
        {importing&&<p role="status">Importing floor plan…</p>}
        <section className="panel-section">
          <div className="section-title"><h2>Floor plan</h2><span>{formatScale(scale)}</span></div>
          {project.geographicOrigin&&<p><small>Current anchor: {project.geographicOrigin.latitude}, {project.geographicOrigin.longitude} · top-left, north up</small></p>}{annotationFields}{uploadFields}<label className="upload compact"><span>{importing ? "Analyzing floor plan…" : "Add / replace floor plan (optional)"}</span><input disabled={importing} type="file" accept={acceptedTypes} onChange={e=>{setPendingMap(e.target.files?.[0]||null);e.target.value="";}} /></label>{importActions}
          {project.floorAnalysis&&<div role="status"><p><strong>{project.floorPlanOverlay?"Manual alignment · no automatic placement":project.floorAnalysis.status==="missing-paths"?"POI placement · no route lines needed":project.floorAnalysis.status==="failed"?"Automatic analysis needs correction":project.autoPlanPending?"Generating initial deployment…":project.floorAnalysis.method==="aligned-venue-reference"?"API reference · review boundary":project.floorPlanOverlay?"Manual alignment · GeoJSON fixed":"Automatic draft · review geometry"}</strong></p>{project.floorAnalysis.scaleAssumed&&<p>Provisional drawing width: 100 m. Enter the actual full drawing width below to regenerate beacon count and coverage at the correct scale.</p>}{project.floorAnalysis.detected&&<p><small>{project.floorAnalysis.detected.walkableRegions} walkable regions · {project.floorAnalysis.detected.roomCandidates} {project.floorAnalysis.method==="aligned-venue-reference"?"API shops":"room candidates"} · {project.floorAnalysis.detected.walls} {project.floorAnalysis.method==="aligned-venue-reference"?"walls":"wall polygons"} · {project.floorAnalysis.detected.labeledLandmarks} labeled landmarks</small></p>}{project.floorAnalysis.routeSource==="geojson"&&<p><strong>{project.floorAnalysis.sourcePathCount} JSON paths · {project.floorAnalysis.junctions} junctions</strong></p>}{project.floorAnalysis.warnings.map((warning,i)=><p key={i}><small>{warning}</small></p>)}</div>}
          {project.pdfPageCount && <small>PDF page 1 of {project.pdfPageCount}. Calibrate using a known drawing dimension.</small>}
          {importError && <p role="alert">{importError}</p>}
          <div className="field-grid">
            <label>Width (m)<input type="number" min="0" step="0.1" value={project.widthMeters ?? ""} onChange={(event) => update({ ...project, widthMeters: event.target.value })} /></label>
            <label>Height (m)<input readOnly={!!project.floorAnalysis} type="number" min="0" step="0.1" value={project.heightMeters ?? ""} onChange={(event) => update({ ...project, heightMeters: event.target.value })} /></label>
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

      <section className="canvas-area">{importError&&<p className="map-import-error" role="alert">{importError}</p>}<StudioCanvas beaconEditingDisabled={planner.busy} project={project} onBeaconViewChange={beaconView=>update({...project,beaconView})} onOverlayChange={floorPlanOverlay=>update({...project,floorPlanOverlay})} tool={!planner.busy&&["beaconInsert","beaconMove"].includes(tool)?tool:"pan"} poiCategory={poiCategory} selectedId={null} onSelect={setSelectedId} onAdd={addObject} onChange={updateObject} onDelete={deleteObject} graphSelection={graphSelection} setGraphSelection={setGraphSelection} onGraphAction={graphAction} route={route} setBeaconSelection={setBeaconSelection} onBeaconAction={beaconAction} focusLocation={focusLocation} beaconSelection={beaconSelection} simulation={simulation}/></section>
      <aside className="right-panel"><BeaconPanel project={project} tool={tool} update={update} setTool={setTool} selection={beaconSelection} setSelection={setBeaconSelection} planner={planner} error={planningError} focus={location=>setFocusLocation({...location,request:Date.now()})}/></aside>
    </main>
  );
}
