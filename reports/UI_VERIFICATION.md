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

## Automatic upload-to-deployment workflow — 2026-10-08

Tested in an isolated preview origin (port 5188) so the previously saved sample was preserved. Uploaded a synthetic SVG with an enclosing building wall, an interior divider and door gap, and a positioned Lift label. Upload automatically created editable boundary/walkable/wall-mask geometry, a connected navigation graph, a lift landmark and an initial IW deployment with area coverage/dead-zone overlays. Positioned text masking reduced spurious text-driven route branches.

Confirmed a 32 m full drawing width: graph world coordinates and edge distances were rescaled, the deployment regenerated automatically with IW001–IW011, 11 total beacons, 93.03% sampled walkable coverage and 100% sampled graph coverage. Warnings remain visible for short branches/spacing and uncovered walkable samples. Confirmed exports become available after scale confirmation. Screenshot: `screenshots/automatic-floor-draft.png`.

`npm run check`: 80 tests passed, TypeScript check and production build passed. Additional final text masking/calibration changes passed a production build and browser smoke verification.

This verifies the synthetic upload path only. It does not establish arbitrary-plan semantic recognition, raster OCR, unlabeled lift/escalator/stair symbols, private/public room classification, accurate atrium void interpretation, or surveyed installation suitability. These remain the active project priority.

## DLF API reference correction — 2026-10-08

Fetched the user-provided floor-0 venue API and compared its geographic outlines to the supplied ground-floor PDF. Saved a sanitized reference snapshot without the API key or outlet account/descriptive data. PDF fingerprint matching selects this reference automatically on upload and when correcting a previously saved inferred DLF map; the previous map remains in undo history. Reference Point coordinates are preserved; 219 centroid labels and stale local coordinates are excluded. Matched 73 shop polygons, 49 wall polygons and 131 access landmarks. Shop/shaft/restricted/green footprints block corridor placement.

Direct engine validation: 131 API access points preserved and attached to a single connected graph, every route interval walkable, every beacon outside blocked footprints, and Zara's interior excluded. The bounded draft has 457 beacons, 90.05% sampled walkable coverage and 100% sampled route coverage; 303 engineering warnings remain, including short/long spacing. The count is not a minimum or approved installation plan. See `reports/dlf-reference-validation.json`, `screenshots/dlf-api-reference-alignment.png` and `screenshots/dlf-reference-deployment.png`.

`npm run check`: 83 tests, TypeScript check and production build passed. Browser file upload to the isolated preview was declined; it was not retried or worked around, and the real-PDF browser integration is not claimed as verified. The API Boundary is empty, so facade tracing and geographic scale remain review items. No underlying model weights were retrained.


## Reference-style upload result (2026-10-08)

- The matched DLF PDF now defaults to opaque source imagery, category-coloured API polygons and small red access points with hover/selection labels. The broad facade/public-floor fill and dense graph, beacon, warning and coverage overlays no longer obscure the initial result.
- Automatic deployment preserves this initial layer visibility; beacon totals remain available. Saved layer choices are retained on reload; the older-reference correction applies the same defaults.
- Validation: the existing full check passed 83 tests, TypeScript and production build. Two additional model tests passed for annotation defaults, immutable input, deployment preservation and saved/manual layer choices. Diff whitespace check passed.
- No browser upload re-test: the previous real-file upload was declined. The reference screenshot predates this UI styling change; it demonstrates alignment rather than verifying the current browser rendering.


## Basement/L00 empty-report correction (2026-10-08)

- The user confirmed the failing upload was the basement/L00 PDF. The prior calibrated reference covered ground floor only, so that file used generic detection and could leave empty geometry.
- Retrieved floor -1 from the same authorized venue API. Saved only sanitized features and calibration; no API key or account fields. L00 now selects its separate reference by exact PDF fingerprint, including on restoration of older failed imports.
- Actual local L00 PDF fingerprint matches the basement fixture. Its PDF page has the same 595.22 × 842 pt dimensions, rendered analysis coordinates 1191 × 1684. Fifteen manually matched shaft centres fit an independent affine calibration; median preview residual 2.3 px. The alignment PNG was visually inspected.
- Full checks: 90 tests passed, TypeScript passed, production build passed. Regression checks cover L00 reference selection, nonempty geometry-safe deployment with unique IW IDs, route exclusion geometry, explicit empty-input failures and diagnostic reports.
- Initial engine result: 59 shops, 25 walls, 110 attached access points, 634 beacons, 17,026.8 m² inferred walkable area, 92.4% sampled coverage. Three navigation components and spacing warnings remain; the draft is not a proven optimal or approved installation layout.
- Browser file upload was not repeated after the previously declined upload. Engine results and the alignment image are not browser-upload verification.


## Real L00 browser upload and visible deployment (2026-10-08)

- The user explicitly requested a demonstration with the attached L00 PDF. Uploaded that file through the browser file chooser to the locally running planner at `http://127.0.0.1:5190/`.
- This exposed a real browser failure: dynamic JSON imports declared `type: json` while Vite served transformed `text/javascript` modules. Converted the two sanitized references to ordinary JavaScript data modules, removing import attributes. Fingerprint matching and data are unchanged.
- The failed saved upload recovered on reload. Then performed a fresh upload of the same L00 PDF; automatic analysis and placement completed without drawing or clicking Generate.
- Verified visible source plan, coloured geometry, graph lines, blue navigation beacons, orange anchors, IW IDs and total count. Header and beacon panel showed 634 IW beacons; floor panel showed 59 shops, 25 walls and 110 landmarks. Coverage panel showed 92.4% walkable and 100% sampled graph coverage. Three components and spacing warnings remain.
- Selected IW001 through the beacon selector; inspector showed Medium Corridor strategy, X/Y position and a 3 m ceiling mounting height. No manual coordinates were changed.
- Saved actual browser screenshots `screenshots/l00-upload-browser-demo.png` (overview) and `screenshots/l00-upload-browser-detail.png` (zoomed IDs). The planner tab was retained for user review; server remains running.
- Reference uploads now show navigation/beacon layers by default; coverage/warnings remain available as layer toggles. Labels on graph nodes show only when selected, keeping the floor readable. The pane layout fits the observed 855px browser width, which previously clipped the entire deployment panel.
- Validation after all changes: 90 tests, TypeScript and production build passed; whitespace diff check passed. This verifies the exact L00 reference workflow, not semantic detection on arbitrary maps or a globally optimized installation count.

## Navigation-only beacon update — 2026-10-08
Reloaded the local L00 browser deployment at http://127.0.0.1:5190/: 634 IW beacons retained, one blue Navigation style, no Anchor layer or type selector. Screenshot: screenshots/l00-navigation-beacons-only.png. Legacy current and saved deployments migrate types without changing IDs or coordinates. Ordinary room/polygon/rectangle geometry and automatically proposed room polygons now exclude beacon placement, including polygon edges. Building boundaries and public walkable polygons remain allowed. Generation refuses to retain an enabled locked/manual beacon inside blocked geometry; its existing data remains available for correction.

## Automatic polygon measurements — 2026-10-08
Every visible closed polygon now renders calibrated area (m²), bounding extent (width × height in metres), and perimeter (P, metres). Labels update with polygon edits and scale changes, rotate with the shape, and ignore pointer input. Missing, nonfinite or nonpositive scales hide measurements; heuristic assumed-scale areas use ≈. Irregular polygon area and perimeter use actual vertices, not the bounding rectangle. Verified the live L00 deployment in the local browser at readable zoom; screenshot: screenshots/l00-polygon-measurements.png. Beacon IDs were hidden for this preview; all 634 Navigation beacon markers remain present. Full check: 93 tests, TypeScript and production build pass.

## Automatic beacon cluster prevention — 2026-10-08
The default automatic topology generator merges route candidates closer than 3 m in the same visible space before area optimization. Added area candidates obey the same separation, and final post-relocation validation repeats it. Landmark references are transferred to the retained beacon; coverage is recalculated after merging. Walls and different floors prevent merging. Existing locked/manual beacons are preserved, while new automatic candidates avoid them. Regenerated L00 in the local browser: 470 beacons (previous original draft 634). Screenshot: screenshots/l00-beacon-clusters-fixed.png. Full check: 95 tests, TypeScript and build pass; both DLF ground and L00 reference regressions additionally assert no generated same-space pair closer than 3 m. Coverage radius overlap remains intentional and is distinct from stacked installation positions.

## Generic automatic floor mapping — 2026-10-08
PDF analysis now uses a separate structural rendering, with text and small CAD glyph strokes filtered before detection. Closed cell contours become editable boundary, walkable, room and void polygons; rooms and voids exclude beacon placement. Tiny wall segments do not display measurement labels by default. Open areas receive a valid initial route when skeleton thinning otherwise produces no edges. Geometry lookup uses bounded spatial indexing for dense CAD drawings.

Verified fresh FIRST FLOOR PLAN (L02) upload in the local browser without API reference data: 106 room candidates, 2 walkable regions, 5197 wall segments and 158 Navigation beacons generated automatically. Overview: screenshots/first-floor-generic-auto-mapping.png; detail: screenshots/first-floor-generic-auto-mapping-detail.png. All five upper DLF floors additionally passed native PDF rasterization and deployment checks for valid inferred geometry, beacons outside detected blocked polygons, and no visible beacon clusters within 3 m. Results: reports/generic-floor-validation.json. Native/browser counts differ with rasterization. Scale remains provisional; checks do not certify physical coverage or semantic accuracy. Unlabeled symbols and ambiguous/scanned drawings still require review. Full check: 100 tests, TypeScript and production build pass.
