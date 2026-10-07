import SimulationOverlay from "./SimulationOverlay.jsx";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boundsOf, moveObject, resizeObject, rotationFromCenter } from "../engines/geometry.js";
import { clientToWorld, fitView, snapPoint, zoomView } from "../engines/coordinates.js";
import { LAYERS, makeObject } from "../models/drawing.js";
import CoverageOverlay from "./CoverageOverlay.jsx";

const pointString = (points = []) => points.map(({ x, y }) => `${x},${y}`).join(" ");
const polygonTools = new Set(["polygon", "walkableArea", "restrictedArea","buildingBoundary","nonWalkableArea"]);
const lineTools = new Set(["polyline", "wall", "walkablePath"]);
const boxTools = new Set(["rectangle", "room"]);

const ObjectShape = memo(function ObjectShape({ object, color, selected, onPointerDown }) {
  const bounds = boundsOf(object);
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const common = { onPointerDown: (event) => onPointerDown(event, object), className: "drawing-object" };
  let shape;

  if (["rectangle", "room"].includes(object.type) && !object.points) {
    shape = <rect {...common} x={object.x} y={object.y} width={object.width} height={object.height} rx={object.type === "room" ? 2 : 0} />;
  } else if (["room", "polygon", "walkableArea", "restrictedArea","buildingBoundary","nonWalkableArea"].includes(object.type)) {
    shape = <polygon {...common} points={pointString(object.points)} />;
  } else if (["polyline", "wall", "walkablePath"].includes(object.type)) {
    shape = <polyline {...common} points={pointString(object.points)} />;
  } else if (object.type === "poi") {
    shape = (
      <g {...common}>
        <circle cx={object.x} cy={object.y} r="12" />
        <circle className="poi-core" cx={object.x} cy={object.y} r="4" />
        <text x={object.x + 17} y={object.y + 5}>{object.name || object.category}</text>
      </g>
    );
  } else if (object.type === "text") {
    shape = <text {...common} x={object.x} y={object.y} fontSize={object.fontSize || 18}>{object.text}</text>;
  }

  return (
    <g data-object-id={object.id} className={`object-group ${selected ? "is-selected" : ""}`} style={{ "--object-color": color }}>
      <g transform={`rotate(${object.rotation || 0} ${center.x} ${center.y})`}>{shape}</g>
    </g>
  );
});

function SelectionHandles({ object, onHandleDown }) {
  if (!object || object.type === "poi" || object.type === "text") return null;
  const bounds = boundsOf(object);
  const handles = {
    nw: [bounds.x, bounds.y], ne: [bounds.x + bounds.width, bounds.y],
    se: [bounds.x + bounds.width, bounds.y + bounds.height], sw: [bounds.x, bounds.y + bounds.height],
  };
  const centerX = bounds.x + bounds.width / 2;
  return (
    <g className="selection-box">
      <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} />
      {Object.entries(handles).map(([handle, [x, y]]) => (
        <rect key={handle} className="resize-handle" x={x - 5} y={y - 5} width="10" height="10" onPointerDown={(event) => onHandleDown(event, "resize", handle)} />
      ))}
      <line x1={centerX} y1={bounds.y} x2={centerX} y2={bounds.y - 28} />
      <circle className="rotate-handle" cx={centerX} cy={bounds.y - 32} r="6" onPointerDown={(event) => onHandleDown(event, "rotate")} />
    </g>
  );
}

function FloorPlan({ project, source }) {
  if (!source || project.layers.floorPlan?.visible === false) return null;
  const width = Number(project.drawingWidthPixels) || 1200;
  const height = Number(project.drawingHeightPixels) || 800;
  return <image className="floor-source" href={source} x="0" y="0" width={width} height={height} preserveAspectRatio="none" />;
}

export default function StudioCanvas({ project, tool, poiCategory, selectedId, onSelect, onAdd, onChange, onDelete, graphSelection, setGraphSelection, onGraphAction, route, setBeaconSelection, onBeaconAction, focusLocation, beaconSelection, simulation }) {
  const svgRef = useRef(null);
  const viewRef = useRef({ x: 0, y: 0, width: 1200, height: 800 });
  const interaction = useRef(null);
  const handlers=useRef();
  const objectDown=useCallback((event,object)=>handlers.current.handleObjectDown(event,object),[]);
  const [draftPoints, setDraftPoints] = useState([]);
  const [draftCursor, setDraftCursor] = useState(null);
  const [rectDraft, setRectDraft] = useState(null);
  const [previewObject, setPreviewObject] = useState(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const source = useMemo(() => {
    const background = project.floorPlanPreview || project.file;
    return background && background.type !== "application/pdf" ? URL.createObjectURL(background) : null;
  }, [project.file, project.floorPlanPreview]);
  const selected = project.objects.find((object) => object.id === selectedId);
  const graphNodes = useMemo(() => new Map((project.graph?.nodes || []).map(n => [n.id,n])), [project.graph]);
  const width = Number(project.drawingWidthPixels) || 1200;
  const height = Number(project.drawingHeightPixels) || 800;

  useEffect(() => () => source && URL.revokeObjectURL(source), [source]);
  useEffect(() => {
    const down = (event) => {
      if (["INPUT","SELECT","TEXTAREA"].includes(event.target?.tagName)) return;
      if (event.code === "Space" && !event.repeat) { event.preventDefault(); setSpacePressed(true); }
      if (event.key === "Escape") { setDraftPoints([]); setRectDraft(null); }
      if (event.key === "Enter" && draftPoints.length > 1) finishPath();
    };
    const up = (event) => event.code === "Space" && setSpacePressed(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  });

  useEffect(() => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const next = fitView(width, height, rect.width, rect.height);
    viewRef.current = next;
    applyView(next);
  }, [width, height, source]);
  useEffect(()=>{
    if(!focusLocation||!Number.isFinite(focusLocation.x)||!svgRef.current)return;
    const rect=svgRef.current.getBoundingClientRect(),w=Math.min(width,300),h=w*rect.height/rect.width;
    const next={x:focusLocation.x-w/2,y:focusLocation.y-h/2,width:w,height:h};viewRef.current=next;applyView(next);
  },[focusLocation]);
  useEffect(()=>{const active=interaction.current;if(active?.mode==="beaconMove")svgRef.current.querySelector(`[data-beacon-id="${active.beacon.id}"]`)?.removeAttribute("transform");},[project.beaconPlan]);

  function applyView(view) {
    svgRef.current?.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
  }

  function worldPoint(event) {
    return snapPoint(clientToWorld(event, svgRef.current), Number(project.gridSize), project.snapToGrid);
  }

  function finishPath() {
    if (draftPoints.length < (polygonTools.has(tool) ? 3 : 2)) return;
    onAdd(makeObject(tool, { points: draftPoints }));
    setDraftPoints([]);
    setDraftCursor(null);
  }

  function handlePointerDown(event) {
    const point = worldPoint(event);
    if (tool === "pan" || spacePressed || event.button === 1) {
      event.currentTarget.setPointerCapture(event.pointerId);
      interaction.current = { mode: "pan", clientX: event.clientX, clientY: event.clientY, view: { ...viewRef.current } };
      return;
    }
    if(tool === "beaconInsert"){onBeaconAction("insert",point);return;}
    if (tool === "graphNode") { onGraphAction("create", point); return; }
    if (tool === "select" || tool === "move") { onSelect(null); return; }
    if (boxTools.has(tool)) {
      event.currentTarget.setPointerCapture(event.pointerId);
      interaction.current = { mode: "rectangle", start: point, type: tool };
      setRectDraft({ x: point.x, y: point.y, width: 0, height: 0 });
      return;
    }
    if (tool === "poi") { onAdd(makeObject("poi", { x: point.x, y: point.y, category: poiCategory, name: poiCategory })); return; }
    if (tool === "text") { onAdd(makeObject("text", { x: point.x, y: point.y })); return; }
    // Pointer events may report detail=0 (unlike mouse click events).
    if ((polygonTools.has(tool) || lineTools.has(tool)) && event.detail <= 1) {
      setDraftPoints((points) => [...points, point]);
      setDraftCursor(point);
    }
  }

  function handleObjectDown(event, object) {
    if(spacePressed||event.button===1||!["select","move","delete"].includes(tool))return;
    event.stopPropagation();
    if (project.layers[object.layerId]?.locked) return;
    if (tool === "delete") { onDelete(object.id); return; }
    if (tool !== "select" && tool !== "move") return;
    onSelect(object.id);
    const point = worldPoint(event);
    svgRef.current.setPointerCapture(event.pointerId);
    interaction.current = { mode: "move", object, start: point, current: point };
  }

  function handleHandleDown(event, mode, handle) {
    event.stopPropagation();
    svgRef.current.setPointerCapture(event.pointerId);
    interaction.current = { mode, handle, object: selected };
  }

  function handlePointerMove(event) {
    const active = interaction.current;
    if (!active) {
      if (draftPoints.length) setDraftCursor(worldPoint(event));
      return;
    }
    if (active.mode === "pan") {
      const rect = svgRef.current.getBoundingClientRect();
      const next = {
        ...active.view,
        x: active.view.x - (event.clientX - active.clientX) * active.view.width / rect.width,
        y: active.view.y - (event.clientY - active.clientY) * active.view.height / rect.height,
      };
      viewRef.current = next;
      applyView(next);
      return;
    }
    const point = worldPoint(event);
    if (active.mode === "graphMove") {
      active.current = point;
      const element = svgRef.current.querySelector(`[data-node-id="${active.node.id}"]`);
      element?.setAttribute("transform", `translate(${point.x-active.start.x} ${point.y-active.start.y})`);
      return;
    }
    if(active.mode === "beaconMove"){active.current=point;onBeaconAction("move",{id:active.beacon.id,floorId:active.beacon.floorId,x:active.beacon.x+point.x-active.start.x,y:active.beacon.y+point.y-active.start.y},true);return;}
    if (active.mode === "rectangle") {
      setRectDraft({ x: Math.min(active.start.x, point.x), y: Math.min(active.start.y, point.y), width: Math.abs(point.x - active.start.x), height: Math.abs(point.y - active.start.y) });
    } else if (active.mode === "move") {
      active.current = point;
      const dx = point.x - active.start.x;
      const dy = point.y - active.start.y;
      svgRef.current.querySelector(`[data-object-id="${active.object.id}"]`)?.setAttribute("transform", `translate(${dx} ${dy})`);
    } else if (active.mode === "resize") {
      setPreviewObject(resizeObject(active.object, active.handle, point, Number(project.gridSize) / 2));
    } else if (active.mode === "rotate") {
      setPreviewObject({ ...active.object, rotation: Math.round(rotationFromCenter(active.object, point)) });
    }
  }

  function handlePointerUp(event) {
    const active = interaction.current;
    if (!active) return;
    if(active.mode === "beaconMove" && active.current){svgRef.current.querySelector(`[data-beacon-id="${active.beacon.id}"]`)?.removeAttribute("transform");onBeaconAction("move",{...active.beacon,x:active.beacon.x+active.current.x-active.start.x,y:active.beacon.y+active.current.y-active.start.y});}
    if (active.mode === "graphMove") {
      svgRef.current.querySelector(`[data-node-id="${active.node.id}"]`)?.removeAttribute("transform");
      if (active.current) onGraphAction("move", { id:active.node.id, x:active.node.x+active.current.x-active.start.x, y:active.node.y+active.current.y-active.start.y });
    }
    if (active.mode === "rectangle" && rectDraft?.width > 2 && rectDraft?.height > 2) {
      const data = active.type === "room" ? { points: [
        { x: rectDraft.x, y: rectDraft.y }, { x: rectDraft.x + rectDraft.width, y: rectDraft.y },
        { x: rectDraft.x + rectDraft.width, y: rectDraft.y + rectDraft.height }, { x: rectDraft.x, y: rectDraft.y + rectDraft.height },
      ] } : rectDraft;
      onAdd(makeObject(active.type, data));
    }
    if (active.mode === "move") {
      const group = svgRef.current.querySelector(`[data-object-id="${active.object.id}"]`);
      group?.removeAttribute("transform");
      const dx = active.current.x - active.start.x;
      const dy = active.current.y - active.start.y;
      if (dx || dy) onChange(moveObject(active.object, dx, dy));
    }
    if (["resize", "rotate"].includes(active.mode) && previewObject) onChange(previewObject);
    try { svgRef.current.releasePointerCapture(event.pointerId); } catch { /* capture may already be released */ }
    interaction.current = null;
    setRectDraft(null);
    setPreviewObject(null);
  }

  function handleWheel(event) {
    event.preventDefault();
    const anchor = clientToWorld(event, svgRef.current);
    const factor = Math.exp(-event.deltaY * 0.0015);
    const next = zoomView(viewRef.current, factor, anchor);
    if (next.width < 80 || next.width > 100_000) return;
    viewRef.current = next;
    applyView(next);
  }

  function fit() {
    const rect = svgRef.current.getBoundingClientRect();
    const next = fitView(width, height, rect.width, rect.height);
    viewRef.current = next;
    applyView(next);
  }

  const displayObjects = previewObject ? project.objects.map((object) => object.id === previewObject.id ? previewObject : object) : project.objects;
  const draftPath = [...draftPoints, ...(draftCursor ? [draftCursor] : [])];
  handlers.current={handleObjectDown,beaconAction:onBeaconAction,nodeDown:(e,node)=>{
    if(spacePressed||e.button===1||!["select","move","graphConnect"].includes(tool))return;e.stopPropagation();
    if(tool==="graphConnect"&&graphSelection?.kind==="node"&&graphSelection.id!==node.id){onGraphAction("connect",{source:graphSelection.id,target:node.id});setGraphSelection(null);return;}
    setGraphSelection({id:node.id,kind:"node"});
    if(!project.layers.navigationGraph?.locked&&["select","move"].includes(tool)){svgRef.current.setPointerCapture(e.pointerId);interaction.current={mode:"graphMove",node,start:worldPoint(e)};}
  },edgeDown:(e,edge)=>{if(spacePressed||e.button===1||!["select","move"].includes(tool))return;e.stopPropagation();setGraphSelection({id:edge.id,kind:"edge"});}};
  const graphDrawing=useMemo(()=>project.layers.navigationGraph?.visible&&<g className="navigation-graph">
    {project.graph.edges.map(edge=>{const a=graphNodes.get(edge.source),b=graphNodes.get(edge.target);if(!a||!b)return null;return <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`${a.floorId!==b.floorId?"floor-connector":""} ${route?.edgeIds.includes(edge.id)?"route-edge":""}`} onPointerDown={e=>handlers.current.edgeDown(e,edge)}><title>{edge.edgeType} · {edge.distance.toFixed(2)} m · {edge.direction}</title></line>;})}
    {project.graph.nodes.map(node=><g key={node.id} data-node-id={node.id} onPointerDown={e=>handlers.current.nodeDown(e,node)}><circle cx={node.x} cy={node.y} r={node.type==="Junction"?8:5} className={graphSelection?.id===node.id?"selected-node":""}/>{(node.metadata?.label||node.type!=="Corridor")&&<text x={node.x+10} y={node.y-10}>{node.metadata?.label||node.type} · {node.floorId}</text>}<title>{node.id} · {node.type} · {node.floorId}</title></g>)}
  </g>,[project.graph,project.layers.navigationGraph?.visible,graphNodes,graphSelection,route]);

  const beaconDrawing=useMemo(()=>(project.layers.beacons?.visible && <g className="beacon-layer">{(project.beaconPlan?.beacons||[]).filter(b=>project.layers[b.enabled===false?"disabledBeacons":b.type==="Anchor"?"anchorBeacons":"navigationBeacons"]?.visible!==false).map(b=><g key={b.id} data-beacon-id={b.id} opacity={b.enabled===false?.4:1} onPointerDown={e=>{if(spacePressed||e.button===1||!["select","move","delete"].includes(tool))return;e.stopPropagation();setBeaconSelection(b.id);onSelect(null);if(b.locked||project.layers.beacons.locked||project.layers[b.enabled===false?"disabledBeacons":b.type==="Anchor"?"anchorBeacons":"navigationBeacons"]?.locked)return;if(tool==="delete"){handlers.current.beaconAction("delete",b);return;}svgRef.current.setPointerCapture(e.pointerId);interaction.current={mode:"beaconMove",beacon:b,start:worldPoint(e)};}}><circle cx={b.x} cy={b.y} r={b.type==="Anchor"?11:7} fill={b.enabled===false?"#94a3b8":b.type==="Anchor"?"#e39522":"#0891b2"} stroke={beaconSelection===b.id?"#172033":"white"} strokeWidth={beaconSelection===b.id?4:2}/>{b.locked&&<text x={b.x+10} y={b.y-10} fontSize="12">L</text>}{project.beaconLabelsVisible!==false&&<text className="beacon-id-label" x={b.x+14} y={b.y-12} pointerEvents="none">{b.id}</text>}<title>{b.id}{b.locked?" · locked":""}</title></g>)}</g>),[project.beaconPlan,project.layers,project.beaconLabelsVisible,tool,spacePressed,beaconSelection,onSelect,setBeaconSelection]);
  return (
    <div className={`studio-canvas ${tool === "pan" || spacePressed ? "is-panning" : ""}`}>
      <button className="fit-button" type="button" onClick={fit}>Fit to screen</button>
      <svg
        ref={svgRef}
        aria-label="Infinite floor planning canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={finishPath}
        onWheel={handleWheel}
      >
        <defs>
          <pattern id="minor-grid" width={project.gridSize} height={project.gridSize} patternUnits="userSpaceOnUse">
            <path d={`M ${project.gridSize} 0 L 0 0 0 ${project.gridSize}`} className="minor-grid" />
          </pattern>
          <pattern id="major-grid" width={project.gridSize * 5} height={project.gridSize * 5} patternUnits="userSpaceOnUse">
            <rect width="100%" height="100%" fill="url(#minor-grid)" />
            <path d={`M ${project.gridSize * 5} 0 L 0 0 0 ${project.gridSize * 5}`} className="major-grid" />
          </pattern>
        </defs>
        <rect x="-50000" y="-50000" width="100000" height="100000" className="canvas-paper" />
        <rect x="-50000" y="-50000" width="100000" height="100000" fill="url(#major-grid)" />
        <FloorPlan project={project} source={source} />
        <CoverageOverlay project={project} scale={Number(project.widthMeters)/Number(project.drawingWidthPixels)}/>
        {LAYERS.filter((layer) => project.layers[layer.id]?.visible && !["floorPlan", "navigationGraph", "beacons", "navigationBeacons","anchorBeacons","disabledBeacons","warnings","coverage"].includes(layer.id)).map((layer) => (
          <g key={layer.id} data-layer={layer.id}>
            {displayObjects.filter((object) => object.layerId === layer.id).map((object) => (
              <ObjectShape key={object.id} object={object} color={layer.color} selected={object.id === selectedId} onPointerDown={objectDown} />
            ))}
          </g>
        ))}
        {rectDraft && <rect className="drawing-preview" {...rectDraft} />}
        {graphDrawing}
        {beaconDrawing}
        {project.layers.warnings?.visible&&<g pointerEvents="none">{(project.beaconPlan?.warnings||[]).filter(w=>Number.isFinite(w.x)).slice(0,100).map((w,i)=><circle key={i} cx={w.x} cy={w.y} r="17" fill="none" stroke="#dc2626" strokeDasharray="4 3" strokeWidth="2"><title>{w.message}</title></circle>)}</g>}
        {draftPath.length > 1 && (polygonTools.has(tool)
          ? <polygon className="drawing-preview" points={pointString(draftPath)} />
          : <polyline className="drawing-preview" points={pointString(draftPath)} />)}
        <SimulationOverlay simulation={simulation} beacons={project.beaconPlan?.beacons||[]}/>
        <SelectionHandles object={previewObject || selected} onHandleDown={handleHandleDown} />
      </svg>
      <div className="canvas-hint">Wheel to zoom · Space-drag to pan · Double-click or Enter to finish paths</div>
    </div>
  );
}
