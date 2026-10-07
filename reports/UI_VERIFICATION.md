# Milestone 5 verification

Verified in the Codex in-app browser against the isolated local development preview:

- Open sample mall, generate 17 beacons (5 anchors), and run coverage.
- Confirm rendered circles/count heatmap and metrics: 38.2% walkable coverage, 100% graph coverage, 5 dead zones, 669 m² overlap.
- Save a named baseline, duplicate it, and reload the browser; layout, report and snapshot options survive IndexedDB reload.
- Create a custom ceiling profile; coverage is invalidated until placement recalculation, then analysis works again.
- Verify selected beacon installation fields, notes/status edits and disabled-beacon recalculation.
- Verify manual insertion through overlapping drawing/graph layers, drag snapping back to a valid edge, undo restoration, and keyboard spaces in mounting notes without triggering canvas panning.
- Controlled sample disabling exposes an 11.5 m graph gap, 86.5% graph coverage, and lower quality; executable `coverage-demo.mjs` reproduces this comparison.
- Delete only the generated duplicate snapshot; working layout remains intact and normal Undo is available before reload.

`npm run check`: 48 unit tests and production build passed. Tests cover thin-wall graph gaps and dead-zone separation, geometry relocation/rejection, calibration and edge-distance mismatch, mounting defaults, spacing optimisation, coverage union/overlap, missing geometry, disabled/cross-floor beacons, duplicate quality penalties/graph ID rejection, and immutable/legacy snapshot lifecycle. The 10,001-node placement test generated 1,819 beacons in approximately 100–130 ms across local verification runs; timing is machine/load dependent. Sample coverage analysis took approximately 50–70 ms. These are engine timings, not large-scene rendering or field-accuracy guarantees.

Sample sources are hand-modelled. No RF simulation, field survey or real mall deployment certification was performed.

## Milestone 6 verification

Verified on the isolated production preview at localhost:5189:

- Drag beacon 7: world position snaps to (56, 16.099); coverage updates from 38.16% to 38.07% and quality from 65.79 to 64.21 without generating a new layout.
- Disable that beacon: 16 enabled beacons, 37.78% coverage, quality 64.45. Quality is a weighted heuristic, not necessarily monotonic when removing a beacon; spacing/connectivity terms also change.
- Save Version A baseline and Version B moved/disabled, compare deltas, then reload A and recalculate to restore baseline.
- Change profile/mount, lock/unlock, duplicate/delete and convert to anchor; duplicate warnings are visible and locks prevent dragging/deletion.
- Set installation cost to INR 250: total INR 4,250 for 17 enabled beacons. Marginal threshold produces 48.92% geometric coverage.
- Download all five export formats; parse JSON reports and inspect the exported PNG. The real exported canvas is saved as screenshots/milestone-6-canvas.png.
- Browser console contained no errors or warnings during verification. Engine regression tests compare incremental edits with full analysis, including cross-floor cache reuse.
- Final regression run: 57 tests and production build passed. Numeric inspector edits commit on blur/Enter; changing mounting height reused every coverage cell and edge. Baseline A and the A/B comparison are left open for review.

Run scripts/deployment-demo.mjs for current engine timings and deterministic version/export results. Large graph timings measure engine work, not whole-browser rendering. Approval is pending; no next milestone started.
