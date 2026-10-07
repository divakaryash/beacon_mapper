import React from 'react';
export default function SimulationOverlay({simulation,beacons}){
  if(!simulation?.route||!simulation.state)return null;
  const {route,state}=simulation,index=route.nodeIds.indexOf(state.nodeId),visited=[...route.nodes.slice(0,index+1),state],remaining=[state,...route.nodes.slice(index+1)],active=beacons.find(b=>b.id===state.activeBeacon),upcoming=beacons.find(b=>b.id===state.upcomingBeacon);
  const points=list=>list.filter(n=>n.floorId===state.floorId).map(n=>`${n.x},${n.y}`).join(' '),edgeNodes=route.nodes.slice(index,index+2);
  return <g className="simulation-overlay" pointerEvents="none" aria-label="Navigation simulation overlay">
    <polyline points={points(remaining)} fill="none" stroke="#64748b" strokeWidth="5" strokeDasharray="8 5"/>
    <polyline points={points(visited)} fill="none" stroke="#16a34a" strokeWidth="6"/>
    {!state.transition&&<polyline points={points(edgeNodes)} fill="none" stroke="#2563eb" strokeWidth="3"/>}
    {active&&active.floorId===state.floorId&&<circle cx={active.x} cy={active.y} r="20" fill="none" stroke="#16a34a" strokeWidth="4"><title>Active {active.id}</title></circle>}
    {upcoming&&upcoming.floorId===state.floorId&&<circle cx={upcoming.x} cy={upcoming.y} r="23" fill="none" stroke="#a855f7" strokeDasharray="4 3" strokeWidth="3"><title>Upcoming {upcoming.id}</title></circle>}
    <circle cx={state.x} cy={state.y} r="9" fill="#2563eb" stroke="white" strokeWidth="3"><title>Virtual user · {state.floorId} · {state.coverageState}</title></circle>
  </g>;
}
