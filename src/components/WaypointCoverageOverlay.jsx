import { compileFloorGeometry } from '../engines/floorGeometry.js';
import { geometryForProject } from '../models/deployments.js';
import React, { useMemo } from 'react';
import { routePlacementWarnings } from '../engines/routePlacementWarnings.js';
export default function WaypointCoverageOverlay({ project }) {
  const coverage = project.coverageAnalysis;
  const warnings = useMemo(() => {
    if (!project.beaconPlan || project.placementNeedsReview) return [];
    return routePlacementWarnings({
    floors: compileFloorGeometry(geometryForProject(project)),
    graph: project.graph, beacons: project.beaconPlan?.beacons || [],
    maximumSpacing: project.planningSettings?.maximumSpacing ?? 10,
    junctionRadius: project.planningSettings?.maximumSpacing ?? 10,
  });
  }, [project.placementNeedsReview, project.graph, project.objects, project.widthMeters, project.heightMeters, project.drawingWidthPixels, project.drawingHeightPixels, project.beaconPlan, project.planningSettings]);
  if (!project.beaconPlan || project.placementNeedsReview)
    return null;
  return <g pointerEvents="none" aria-label="Missed junctions and excessive beacon spacing">

    {warnings.map((g, i) => <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#dc2626" strokeWidth="5" strokeDasharray="7 3" vectorEffect="non-scaling-stroke">
      <title>{g.floorId} · {g.reason}</title>
    </line>)}

    {coverage?.waypointSuggestions?.suggestions.map(s => <g key={s.id}>
      <circle cx={s.x} cy={s.y} r="11" fill="#fff7ed" stroke="#ea580c" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      <text x={s.x + 15} y={s.y - 12} fill="#9a3412" fontSize="15" fontWeight="bold">
        {s.id}
      </text>
      <title>Suggested beacon {s.id} · {s.floorId}</title>
    </g>)}


  </g>;
}
