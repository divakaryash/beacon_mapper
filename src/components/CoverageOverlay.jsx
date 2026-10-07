import React,{memo,useMemo} from "react";

export default memo(function CoverageOverlay({project,scale}) {
  const result=project.coverageAnalysis,settings={circles:true,heatmap:true,deadZones:true,overlap:true,gaps:true,...project.coverageSettings};
  const floorId=settings.floorId||project.graph.nodes[0]?.floorId;
  const report=result?.floorReports.find(f=>f.floorId===floorId);
  const raster=useMemo(()=>{
    if(!report)return null;
    const canvas=document.createElement("canvas");canvas.width=report.columns;canvas.height=report.rows;const ctx=canvas.getContext("2d");
    for(const cell of report.cells) {
      if(!cell.count&&!settings.deadZones)continue;
      if(cell.count===1&&!settings.heatmap)continue;
      if(cell.count>1&&!settings.overlap&&!settings.heatmap)continue;
      ctx.fillStyle=!cell.count?"rgba(239,68,68,.65)":cell.count>1&&settings.overlap?"rgba(139,92,246,.55)":"rgba(16,185,129,.42)";
      ctx.fillRect(cell.column,cell.row,1,1);
    }
    return canvas.toDataURL();
  },[report,settings.deadZones,settings.heatmap,settings.overlap]);
  if(!scale||!project.layers.coverage?.visible||project.placementNeedsReview)return null;
  return <g className="coverage-overlay" pointerEvents="none">
    {raster&&<image href={raster} x={report.minX/scale} y={report.minY/scale} width={report.columns*report.cellSize/scale} height={report.rows*report.cellSize/scale} style={{imageRendering:"pixelated"}}/>}
    {settings.circles&&(project.beaconPlan?.beacons||[]).filter(b=>b.enabled!==false&&b.floorId===floorId).map(b=><g key={b.id}><circle cx={b.x} cy={b.y} r={(b.reliableRadius??b.coverageRadius??6)/scale} fill="none" stroke="#0891b2" strokeOpacity=".45" strokeWidth="1"/><circle cx={b.x} cy={b.y} r={(b.marginalRadius??b.coverageRadius??6)/scale} fill="none" stroke="#d97706" strokeOpacity=".35" strokeWidth="1" strokeDasharray="5 4"/></g>)}
    {settings.gaps&&result?.gaps.filter(g=>g.floorId===floorId).map((g,i)=><line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#dc2626" strokeWidth="7"/>)}
  </g>;
});
