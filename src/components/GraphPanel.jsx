import React, { useMemo, useState } from "react";
import { NavigationGraph, generateGraphFromWalkablePaths, NODE_TYPES, EDGE_TYPES } from "../engines/navigationGraph.js";

export default function GraphPanel({ project, scale, update, setTool, selection, setSelection, setRoute }) {
  const graph = useMemo(() => new NavigationGraph(project.graph), [project.graph]);
  const analysis = useMemo(() => graph.validate(), [graph]);
  const [spacing, setSpacing] = useState(2.5);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [algorithm, setAlgorithm] = useState("astar");
  const [accessible, setAccessible] = useState(false);
  const [stairs, setStairs] = useState(false);
  const [lifts, setLifts] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);
  const selectedNode = graph.nodes.get(selection?.id);
  const selectedEdge = graph.edges.get(selection?.id);
  const pois = project.objects.filter(o => o.type === "poi");
  function command(action) {
    try { action(graph); update({ ...project, graph: graph.serialize() }); setRoute(null); setResult(null); setMessage(""); }
    catch (error) { setMessage(error.message); }
  }
  function generate() {
    if (!scale) { setMessage("Calibrate the floor scale first."); return; }
    const paths = project.objects.filter(o => o.type === "walkablePath");
    if (!paths.length) { setMessage("Draw walkable paths first."); return; }
    const generated = generateGraphFromWalkablePaths(paths, { metersPerPixel: scale, spacingMeters: spacing });
    update({ ...project, graph: generated.serialize(), layers:{...project.layers,navigationGraph:{visible:true,locked:false}} }); setRoute(null); setResult(null);
  }
  function route() {
    const a = pois.find(p => p.id === start), b = pois.find(p => p.id === end);
    if (!a || !b) { setMessage("Choose two POIs."); return; }
    const source = a.metadata?.nodeId ? graph.nodes.get(a.metadata.nodeId) : graph.nearestNode(a, a.floorId || "floor-1");
    const target = b.metadata?.nodeId ? graph.nodes.get(b.metadata.nodeId) : graph.nearestNode(b, b.floorId || "floor-1");
    const started = performance.now();
    const found = source && target && graph.route(source.id, target.id, { algorithm, accessibleOnly: accessible, avoidStairs: stairs, preferLifts: lifts });
    if (!found) { setMessage("No route satisfies these constraints."); setRoute(null); setResult(null); return; }
    const next = { ...found, elapsedMs: performance.now() - started };
    setResult(next); setRoute(next); setMessage("");
  }
  return <section className="panel-section graph-panel">
    <h2>Navigation graph</h2>
    <p className="graph-summary">{analysis.stats.nodes} nodes · {analysis.stats.edges} edges · {analysis.stats.components} components</p>
    <div className="button-row"><button onClick={() => setTool("graphNode")}>Create node</button><button onClick={() => { setSelection(null); setTool("graphConnect"); }}>Connect nodes</button></div>
    <small>Connect: click source, then target. Select/Move drags nodes.</small>
    <label>Intermediate spacing (m)<input type="number" min="0.5" step="0.5" value={spacing} onChange={e => setSpacing(Math.max(.5, Number(e.target.value)))} /></label>
    <button className="secondary" onClick={generate}>Generate from walkable paths</button>
    {selectedNode && <>
      <label>Node type<select value={selectedNode.type} onChange={e => command(g => { g.nodes.set(selectedNode.id, { ...selectedNode, type: e.target.value }); })}>{NODE_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
      <label>Floor ID<input value={selectedNode.floorId} onChange={e => command(g => g.moveNode(selectedNode.id, { floorId: e.target.value }))} /></label>
      <label>Label<input value={selectedNode.metadata.label || ""} onChange={e => command(g => { g.nodes.set(selectedNode.id, { ...selectedNode, metadata: { ...selectedNode.metadata, label: e.target.value } }); })} /></label>
      <button className="danger" onClick={() => command(g => g.removeNode(selectedNode.id))}>Delete node</button>
      <button onClick={() => command(g => { const edges = [...g.adjacency.get(selectedNode.id)]; if (edges.length !== 2) throw new Error("Select a degree-two node to merge its edges."); g.mergeEdges(...edges); })}>Merge incident edges</button>
    </>}
    {selectedEdge && <>
      <label>Edge type<select value={selectedEdge.edgeType} onChange={e => command(g => g.edges.set(selectedEdge.id, { ...selectedEdge, edgeType: e.target.value }))}>{EDGE_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
      <label>Distance (m)<input type="number" min="0.01" step="0.1" value={selectedEdge.distance} onChange={e => { const distance = Number(e.target.value); if (distance > 0) command(g => g.edges.set(selectedEdge.id, { ...selectedEdge, distance })); }} /></label>
      <label>Direction<select value={selectedEdge.direction} onChange={e => command(g => g.edges.set(selectedEdge.id, { ...selectedEdge, direction: e.target.value }))}>{["both", "forward", "reverse"].map(t => <option key={t}>{t}</option>)}</select></label>
      <label className="check-label"><input type="checkbox" checked={selectedEdge.accessibility} onChange={e => command(g => g.edges.set(selectedEdge.id, { ...selectedEdge, accessibility: e.target.checked }))} /> Accessible</label>
      <div className="button-row"><button onClick={() => command(g => g.splitEdge(selectedEdge.id, { ratio: .5 }))}>Split edge</button><button onClick={() => command(g => g.removeEdge(selectedEdge.id))}>Disconnect</button></div>
    </>}
    <h2>Route between POIs</h2>
    <label>From<select value={start} onChange={e => setStart(e.target.value)}><option value="">Choose POI</option>{pois.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>To<select value={end} onChange={e => setEnd(e.target.value)}><option value="">Choose POI</option>{pois.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>Algorithm<select value={algorithm} onChange={e => setAlgorithm(e.target.value)}><option value="astar">A*</option><option value="dijkstra">Dijkstra</option></select></label>
    {[[accessible,setAccessible,"Accessible only"],[stairs,setStairs,"Avoid stairs"],[lifts,setLifts,"Prefer lifts"]].map(([v,set,label]) => <label className="check-label" key={label}><input type="checkbox" checked={v} onChange={e => set(e.target.checked)} />{label}</label>)}
    <button className="secondary" onClick={route}>Find route</button>
    {result && <p role="status">{result.totalDistance.toFixed(2)} m · {(result.estimatedWalkingTime / 60).toFixed(1)} min · {result.elapsedMs.toFixed(2)} ms<br />{result.nodeIds.length} ordered nodes</p>}
    <small>POIs use the nearest node on their floor. Graph distance excludes the off-graph approach; verify the connection before deployment.</small>
    <h2>Graph validation</h2>
    {analysis.warnings.length ? <ul>{analysis.warnings.slice(0,15).map((w,i) => <li key={i}>{w.message}</li>)}</ul> : <p>No graph warnings.</p>}
    {message && <p role="alert">{message}</p>}
  </section>;
}
