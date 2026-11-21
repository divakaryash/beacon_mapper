import React, {useMemo, useRef} from "react";
import {annotatedBeaconPositions} from "../models/beaconRules.js";
import {analyzeCoverage} from "../engines/coverage.js";
import {geometryForProject} from "../models/deployments.js";
import {BEACON_PROFILES} from "../engines/beaconPlacement.js";
import {DEFAULT_PLANNING_SETTINGS} from "../engines/deploymentPlanner.js";

export default function CoverageSummary({project, busy}) {
  const coverageDialog = useRef(null);
  const result = project.beaconPlan;
  const coverage = project.coverageAnalysis;
  const annotatedCoverage = useMemo(() => {
    if (!project.annotationData || !project.annotationAlignment)
      return null;
    try {
      const profile = project.beaconProfile || BEACON_PROFILES[0];
      const beacons = annotatedBeaconPositions(project).map(b => ({
        ...b,
        coverageRadius: profile.coverageRadius,
        reliableRadius: project.planningSettings?.reliableRadius ?? DEFAULT_PLANNING_SETTINGS.reliableRadius,
        marginalRadius: project.planningSettings?.marginalRadius ?? DEFAULT_PLANNING_SETTINGS.marginalRadius
      }));
      return {
        count: beacons.length, result: analyzeCoverage({
          graph: project.graph,
          floorGeometry: geometryForProject(project), beacons, profile,
          configuration: { ...DEFAULT_PLANNING_SETTINGS, ...project.planningSettings, graphOnly: true }
        })
      };
    }
    catch (error) {
      return { error: error.message };
    }
  }, [project.annotationData, project.annotationAlignment, project.annotationFloor, project.graph,
  project.objects, project.widthMeters, project.heightMeters, project.drawingWidthPixels,
  project.drawingHeightPixels, project.planningSettings, project.beaconProfile]);
  return <>
    <div className="beacon-top-actions">
      <button className="generate-placement-button" type="submit" form="beacon-placement-form" disabled={busy}>
        Generate placement
      </button>
    <div className="beacon-summary-toolbar" aria-label="Beacon totals and coverage">
      <span className="model-beacon-total">Generated: <strong>{result?.beacons.length || 0}</strong></span>
      {annotatedCoverage?.count !== undefined && <span className="annotated-beacon-total">Annotated: <strong>{annotatedCoverage.count}</strong></span>}
      <button
        type="button"
        className="coverage-summary-button"
        title="View waypoint coverage"
        aria-label="View waypoint coverage"
        aria-haspopup="dialog"
        onClick={() => coverageDialog.current?.showModal()}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="3" y="14" width="3" height="7" rx="1" />
          <rect x="8" y="10" width="3" height="11" rx="1" />
          <rect x="13" y="6" width="3" height="15" rx="1" />
          <rect x="18" y="2" width="3" height="19" rx="1" />
        </svg>
      </button>
    </div>
    </div>
    <dialog
      ref={coverageDialog}
      className="coverage-summary-dialog"
      aria-labelledby="coverage-summary-title"
      onKeyDown={event => event.stopPropagation()}
      onClick={event => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
            coverageDialog.current.close();
          }
        }
      }}
    >
      <div className="coverage-summary-heading">
        <h2 id="coverage-summary-title">Waypoint coverage</h2>
        <button type="button" autoFocus aria-label="Close coverage summary" onClick={() => coverageDialog.current.close()}>×</button>
      </div>
    <section className="panel-section" aria-label="Waypoint path coverage">

      <h3>Waypoint paths covered by model beacons</h3>

      {busy ? <p role="status">Updating coverage…</p> : project.placementNeedsReview ? <p role="status">Recalculate placement to update coverage.</p> : coverage?.totalGraphLength > 0 ? <>

        <p><strong>{coverage.graphCoveragePercentage.toFixed(1)}%</strong> covered</p>

        <progress className="coverage-model" aria-label="Waypoint paths covered by model beacons" max="100" value={coverage.graphCoveragePercentage} style={{ width: "100%" }} />

        <small>{coverage.graphCoveredLength.toFixed(1)} m covered of {coverage.totalGraphLength.toFixed(1)} m waypoint paths · all modelled floors.</small>

      </> : <p>

        {result ? "No measurable waypoint paths available." : "Generate placement to calculate coverage."}

      </p>}

    </section>

    <section className="panel-section" aria-label="Annotated beacon waypoint path coverage">

      <h3>Waypoint paths covered by annotated beacons</h3>

      {project.placementNeedsReview ? <p role="status">Review the drawing scale before calculating annotated coverage.</p>
        : annotatedCoverage?.error ? <p role="status">

          {annotatedCoverage.error}

        </p>
          : annotatedCoverage?.result.totalGraphLength > 0 ? <>

            <p><strong>{annotatedCoverage.result.graphCoveragePercentage.toFixed(1)}%</strong> covered</p>

            <progress className="coverage-annotated" aria-label="Waypoint paths covered by annotated beacons" max="100" value={annotatedCoverage.result.graphCoveragePercentage} style={{ width: "100%" }} />

            <small>{annotatedCoverage.result.graphCoveredLength.toFixed(1)} m covered of {annotatedCoverage.result.totalGraphLength.toFixed(1)} m waypoint paths · {annotatedCoverage.count} annotated beacons · imported floor {project.annotationFloor}.</small>

          </> : <p>

            {annotatedCoverage ? "No measurable waypoint paths available." : "Import annotated beacon data to calculate coverage."}

          </p>}

    </section>

    </dialog>
  </>;
}
