import React,{memo} from "react";

export default memo(function CoverageOverlay({project,scale}) {
  const result=project.coverageAnalysis,settings={circles:true,heatmap:true,deadZones:true,overlap:true,gaps:true,...project.coverageSettings};
  const floorId=settings.floorId||project.graph.nodes[0]?.floorId;
  if(!scale||!project.layers.coverage?.visible||project.placementNeedsReview)return null;
  return <g className="coverage-overlay" pointerEvents="none">
    {result?.graphEdges.filter(e=>!e.floorId||e.floorId===floorId).flatMap(e=>(e.segments||[]).filter(s=>s.count===0?settings.deadZones:s.count>1?settings.overlap||settings.heatmap:settings.heatmap).map((s,i)=><line key={`${e.edgeId}-${i}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={!s.count?"#ef4444":s.count>1?"#8b5cf6":"#10b981"} strokeWidth="6" vectorEffect="non-scaling-stroke"/>))}
    {settings.circles&&(project.beaconPlan?.beacons||[]).filter(b=>b.enabled!==false&&b.floorId===floorId).map(b=><g key={b.id}><circle cx={b.x} cy={b.y} r={(b.reliableRadius??b.coverageRadius??6)/scale} fill="none" stroke="#0891b2" strokeOpacity=".45" strokeWidth="1"/><circle cx={b.x} cy={b.y} r={(b.marginalRadius??b.coverageRadius??6)/scale} fill="none" stroke="#d97706" strokeOpacity=".35" strokeWidth="1" strokeDasharray="5 4"/></g>)}
    {settings.gaps&&result?.gaps.filter(g=>g.floorId===floorId).map((g,i)=><line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#dc2626" strokeWidth="7"/>)}
  </g>;
});
