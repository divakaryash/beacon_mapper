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
# Milestone 7 verification

Verified on an isolated production preview at localhost:5190, without modifying the user's other preview/project origin:

- Open sample mall, generate 17 IW-ID beacons, choose Main entrance → Lift lobby and prepare simulation.
- Confirm 57 m, 42.22 s, 10 handovers, 100% graph-route coverage, no weak/dead sections, navigation score 100.
- Play at 10×: observe walker movement and IW001 → IW007 transition, previous/current/upcoming IDs and live proximity score. Pause, Stop and native timeline seek work; seek to 20 s shows (56,36) m, IW009 active, IW010 upcoming and five completed handovers.
- Expand the complete 15-event timeline (start, connections, landmarks, arrival).
- Download report/log JSON and parse both files: report score 100, 15 events. Download and parse comparison JSON.
- Save baseline A, disable IW010/IW011/IW012 and save B. Preparing B shows 86.84% route coverage, 7.5 m longest gap, two weak sections and score 66.93.
- Compare saved A/B on the same route: counts 17/14 enabled geometry-valid beacons, coverage 100/86.84, score 100/66.93, recommendation A. Restore A and leave its simulation paused at 20 s with comparison available.
- Export the actual canvas with the virtual user/visited route/current/upcoming beacon overlays; saved as screenshots/milestone-7-simulation.png.
- Rebuilding production assets during testing invalidated an old worker URL. Reloading the final build restored it; subsequent deployment-edit invalidation and worker reconstruction succeeded. Production source changes require preview reload.

Strict TypeScript check, 66 unit tests and production build passed. Tests cover playback, deterministic handovers, geometry clipping, gaps, disabled beacons, multi-floor unknown travel, invalid input, unmodelled POI approaches, and indexed large-graph simulation. The reproducible benchmark has 10,001 nodes, 2,501 beacons and a 1,100 m route: roughly 47 ms preparation and 10.5 ms for 1,000 seeks on this machine. These are engine timings, not whole-browser rendering or field guarantees.

Graph-route coverage and floor-area coverage are different denominators. Baseline graph route is fully covered even though only 38.16% of modelled walkable floor area is covered. Signal/quality are geometry planning assumptions; no RF, positioning, Bluetooth, calibration or fingerprinting was implemented. Milestone 8 has not started; approval is pending.
# Milestone 8 topology placement verification

Verified locally at `http://localhost:5191/` using the hand-modelled sample mall, not the supplied DLF survey drawing.

- Generate produced 37 beacons, 5 anchors, 89.36% walkable coverage, 100% sampled graph coverage and an explicit unmet 90% target warning.
- Inspector IW007 showed a 30 m open-area reference corridor and a 5.28 m mounting offset. IDs, not Anchor/Navigation text, remained the map labels.
- Moving IW007 from X=50.7173 m to X=51.2 m preserved the off-center coordinate, changed strategy metadata to Manual, and updated coverage to 89.38%. Incremental work: 476 cells, 1 edge, 1/4 regions, approximately 7.3 ms.
- Selected recalculation preserved X=51.2 m with no coverage resampling. Reload preserved the off-center generated layout and rebuilt topology context.
- Native canvas PNG and JSON downloads were invoked, but new files were not found in Downloads; do not count these browser downloads as verified. A similarly named PNG was an older centerline export and its accidental copy was removed. Unit checks cover JSON/CSV serialization data; the Milestone 8 diagrams are generated from real engine coordinates, not browser screenshots.
- All requested strategies and geometry/manual/radius cases are covered by automated tests. The narrow-corridor 10,001-node generation benchmark was approximately 0.8 seconds in an isolated run; engine-only, not a browser-rendering claim.
