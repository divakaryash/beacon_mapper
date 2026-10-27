import React from 'react';
export default function WaypointCoverageOverlay({project}){
  const coverage=project.coverageAnalysis;
  if(!coverage||project.placementNeedsReview)return null;
  return <g pointerEvents="none" aria-label="Waypoint coverage gaps and suggested beacons">
    {coverage.gaps.map((g,i)=><line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#dc2626" strokeWidth="5" strokeDasharray="7 3" vectorEffect="non-scaling-stroke"><title>{g.floorId} · {g.length.toFixed(2)} m uncovered</title></line>)}
    {coverage.waypointSuggestions?.suggestions.map(s=><g key={s.id}><circle cx={s.x} cy={s.y} r="11" fill="#fff7ed" stroke="#ea580c" strokeWidth="3" vectorEffect="non-scaling-stroke"/><text x={s.x+15} y={s.y-12} fill="#9a3412" fontSize="15" fontWeight="bold">{s.id}</text><title>Suggested beacon {s.id} · {s.floorId}</title></g>)}
  </g>;
}
