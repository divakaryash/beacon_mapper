# Indoor Navigation Planning Studio (INPS)

A local-first engineering tool for modelling buildings and planning IW Beacon deployments. INPS runs entirely in the browser and deliberately has no backend, accounts, organizations, billing, or cloud services.

## Automatic initial deployment — current priority

Upload PDF/PNG/JPG/SVG to automatically infer enclosed walkable geometry and wall masks, trace building contours, generate an editable skeleton navigation graph, and run geometry-aware beacon placement plus coverage analysis. IW001, IW002… appear directly on the floor plan alongside paths, beacon counts, coverage and dead zones. Replacing the source starts a fresh draft. No additional UI features are planned until this core workflow is reliable.

This first pass is a bounded monochrome raster heuristic (128 pixels on the longest side), not a trained semantic detector. It can miss thin/coloured walls and open building boundaries, confuse text with walls, and include private rooms or atrium voids as walkable. Room candidates are disconnected rectangular regions; lift/escalator/stair/entrance/exit candidates come from positioned PDF/SVG text labels. Raster OCR and unlabeled symbol recognition are not implemented. Ambiguous/disconnected results need review; a plan without enclosed geometry fails explicitly and keeps its source available for correction.

Physical size cannot be recovered from an arbitrary image alone. The draft explicitly assumes a **100 m full drawing width**; enter the true drawing width to rescale the graph and automatically regenerate count and coverage. Exports remain blocked while scale is provisional. Geometry/radius coverage and bounded greedy placement do not guarantee RF performance or a global optimum. PDF import currently uses page 1 only.

## DLF ground-floor reference correction

The supplied `GROUND FLOOR (L-01) Model (1).pdf` is recognized by SHA-256 on upload or when restoring an older inferred map, and uses a saved, sanitized snapshot of the user-provided floor-0 venue API. Its geographic polygon outlines are aligned to this exact PDF. Unrelated files retain the generic detection path; no DLF coordinates are applied by filename alone. The API key, account data and outlet descriptions are not stored in the app.

The upload opens with the reference-style annotation view: full-opacity source, translucent category colours and small red access-point markers. Marker names appear on hover or selection. Navigation paths and IW beacons appear automatically. Coverage, warnings and the broad inferred public-floor fill start hidden to keep the source readable; use the existing Layers controls to show them. The generated beacon count appears in the header and at the top of the beacon panel. Layer choices survive reload. Red API markers are access points, not IW beacons.

The reference preserves 73 shop footprints, 49 wall footprints and 131 explicit API access points. Centroid label features are excluded. API geographic Point coordinates are used for shop entrances, lifts, escalators, stairs, entries and exits; inconsistent `coordinnatesLocal` coordinates are ignored. POI markers stay at their source position; a separate geometry-valid access link in the Navigation Graph layer joins the nearest corridor edge. Shops, shafts, walls, greenery and restricted footprints are excluded from public placement. The extracted graph is validated against exact polygons, and sampling fragments are joined only across unobstructed walkable segments.

The API has an empty Boundary and no public walkable polygons or corridor graph. The outer facade was therefore traced from the PDF and public floor inferred by exclusion; physical scale is estimated from geographic distances. These need review. This is a stored calibration/regression example, not machine-learning retraining. The current draft count is not a proven minimum or approved installation recommendation. See `reports/dlf-reference-validation.json` and `screenshots/dlf-api-reference-alignment.png`.

## L00 basement upload correction

`L00 FLOOR PLAN (REVISED) Model (1).pdf` selects a separate sanitized floor -1 API reference by exact SHA-256; the ground-floor calibration is never reused. Alignment uses 15 corresponding lift-shaft centres on the L00 PDF (median residual about 2.3 pixels in the 1800-pixel preview). The outer facade is traced from this PDF because the API boundary is empty. Physical scale remains an estimate from geographic distances. Review the geometry and connections before installation.

The basement reference includes 59 shop footprints, 25 wall footprints and 110 access points, including directional escalators. Existing saved L00 imports are corrected when reopened. The tested initial draft has 634 beacons, 92.4% sampled walkable coverage and three disconnected navigation components requiring review; this count is not an optimized installation recommendation. See `reports/dlf-basement-reference-validation.json` and `screenshots/dlf-basement-api-reference-alignment.png`.

Empty graphs or missing walkable geometry now fail explicitly instead of returning a zero-score deployment. Planning settings can be saved before generation without creating an empty deployment. Quality reports include source identity, selected reference floor, detection warnings, geometry/graph counts, beacon count and deployment errors. A failed upload can export analysis diagnostics even when coverage is unavailable.

The real L00 upload was demonstrated at `http://127.0.0.1:5190/`: choose the PDF, wait for analysis, then review the automatically visible paths/beacons. No drawing or Generate click was needed. `screenshots/l00-upload-browser-demo.png` and `screenshots/l00-upload-browser-detail.png` show the actual browser result. This verifies the calibrated L00 workflow; arbitrary uploads still use the limited raster heuristic.

The saved references are ordinary lazy-loaded JavaScript modules exporting GeoJSON objects. Native JSON import attributes caused a browser failure against Vite's transformed JavaScript response; avoiding those attributes fixes both dev and build imports without changing the reference data.

## Topology-aware placement — Milestone 8

Navigation edges now guide route stations rather than constrain installation coordinates. Every edge records perpendicular cross-section widths, walkable polygons, nearby POIs, explicit room entrances and corridor/open-area classification. Narrow/Medium/Wide Corridor, Junction, Atrium, Food Court, Store Entrance, Lift, Escalator and Stair strategies select side, alternating-side, lobby/corner and perimeter candidates. Doors are never inferred from room centroids.

Geometric marginal coverage chooses valid mounting positions while protecting sampled route coverage. Additional perimeter candidates are selected greedily until the area target or configurable budget is reached; redundant area candidates are removed. This bounded heuristic does not guarantee a global minimum count. Width thresholds, mounting inset, POI search radius and additional-beacon budget are editable in Project planning settings.

Valid off-center manual positions survive movement, reload and recalculation. Invalid positions still use the existing nearest-valid-graph repair fallback. Anchor validation uses actual reliable-radius visibility. The inspector and JSON/CSV expose strategy and graph-reference metadata. Route-station spacing is not physical mounting distance; actual area/graph coverage is authoritative.

Run `node scripts/topology-demo.mjs`. On the hand-modelled sample, the same **17 beacons** improve from **38.2% to 52.4%** walkable coverage, retaining 100% sampled graph coverage. The default 20-addition budget yields **37 beacons and 89.4% area coverage**; the unmet 90% target remains warned. Results: `reports/milestone-8-topology.json`; before/after diagrams: `screenshots/milestone-8-*.svg`. No RF model or surveyed DLF deployment claim is made.

## Floor planning — Milestones 1–2 (approved)

- Import PNG, JPG, SVG, and PDF floor plans and calibrate physical dimensions.

PDF import renders page 1 locally with PDF.js as a canvas background (rather than an embedded browser PDF viewer). The original PDF and PNG preview persist in IndexedDB. The preview preserves page proportions and is capped at 4096 pixels on its longest side; multi-page files currently import only page 1. Previously saved PDFs are repaired on reload without changing existing object coordinates. Calibrate the scale from a known drawing dimension before planning. Invalid or password-protected files show an import error without replacing the current project.
- Navigate an infinite SVG workspace with smooth pan, wheel zoom, fit-to-screen, grid, and snap-to-grid.
- Organize content into Floor Plan, Walls, Rooms, Walkable Areas, Restricted Areas, Navigation Graph, POIs, Beacons, and Coverage layers.
- Draw rectangles, rooms, polygons, polylines, walls, walkable paths/areas, restricted areas, labels, and POIs.
- Create room/outlet records with stable IDs, names, categories, floors, polygon coordinates, calibrated areas, and perimeters.
- Place Store, Outlet, Lift, Stairs, Escalator, Entrance, Exit, ATM, Washroom, Food Court, Reception, and Custom POIs.
- Select, move, resize, rotate, duplicate, delete, undo, and redo objects.
- Autosave the floor plan file, calibration, layer settings, and every object to IndexedDB.

The Geometry and Coordinate engines, Drawing Models, persistence, and React UI are separate modules. Pan, zoom, and drag previews update the SVG directly during pointer movement, then commit one model change when the gesture ends.

## Run locally

```sh
npm install
npm run dev
```

Run the scale checks and production build with `npm run check`.

## Navigation graph — Milestone 3

The independent `NavigationGraph` engine supports calibrated nodes, directed/accessibility-aware edges, snapping and node merging, splitting/merging edges, editable graph generation from walkable paths, Dijkstra/A*, multi-floor connectors, and validation. The graph panel provides creation, connection, node movement, metadata editing, edge editing, route selection between POIs, and warnings. Graph changes use the existing undo history and IndexedDB persistence.

Run `node scripts/graph-demo.mjs` for the manually defined Main Entrance → West Retail route, validation demonstration, and a 10,201-node / 20,200-edge benchmark. Run `npm run benchmark` for the performance regression check. See ARCHITECTURE.md for coordinate conventions and deployment-relevant limitations.

## Beacon deployments — Milestone 4 (approved) + geometry hardening

The independent graph-following planner supports IW Ceiling/Wall/Outdoor profiles, custom profiles, Navigation/Anchor types, automatic/manual/hybrid modes, insertion/dragging, disabling, conversion, deletion and recalculation. Every active beacon is validated against explicit geometry; conflicts move to the nearest valid same-floor graph position. If none exists, the beacon is omitted and the deployment fails its geometry quality check. No grid placement is used.

Mounting metadata includes installation type, height, optional orientation, notes and status. Named deployment snapshots support Save, Save as new, Reload, Duplicate and Delete, and persist alongside custom profiles and the working layout in IndexedDB. Undo can recover snapshot deletion until the page closes. Changed graph/geometry/calibration invalidates coverage and requires placement review. Legacy layouts without geometry validation also require recalculation before coverage. Inconsistent calibration or same-floor edge distance is rejected rather than silently fabricating physical spacing.

## Coverage — Milestone 5 (approved)

Coverage circles, count heatmap, dead zones, overlaps, graph gaps, area/graph percentages and deployment quality reports are available. The Coverage engine is independent from React. Its model is geometric radius plus line-of-sight, not RF propagation. Walls, restricted regions, non-walkable regions and building boundaries block visibility. Disabled and invalid beacons contribute no coverage. Coverage is floor-specific.

1. Import a floor, or choose **Open sample mall** on the welcome screen.
2. Confirm the scale and review the automatically detected geometry. If detection fails, draw a **Boundary** and walkable areas or width-configured paths. Use Properties to assign geometry roles, floor IDs and wall thickness. Existing polygons/rooms/rectangles can be marked as boundaries, walkable, restricted or non-walkable.
3. Create/review the navigation graph, generate beacons, and review placement warnings.
4. Click **Analyze coverage**. Toggle circles, heatmap, dead zones, overlap and graph gaps independently. Select the coverage floor if multiple floors exist.
5. Review the quality report and download its JSON. Use saved deployment controls for comparisons.

Defaults: 0.5 m area cells, 0.25 m graph sampling. Analysis coarsens large rasters with a warning. Graph geometry boundaries are inserted into the samples so a thin wall cannot disappear between graph samples. The rendered heatmap is a cached raster, not thousands of React cell components. Reports explicitly disclose resolution and sampled area.

Run `npm run check` for all tests/build, `node scripts/beacon-demo.mjs` for placement, and `node scripts/coverage-demo.mjs` to regenerate the sample coverage diagrams and quality report. The sample is hand-modelled from the Milestone 2 drawing, not a surveyed mall: 17 beacons (5 anchors), 38.2% walkable-area coverage, 100% graph coverage, 5 dead zones (1493.5 m²), and 669 m² overlap. Disabling three adjacent beacons exposes an 11.5 m graph gap. This deliberately imperfect sample demonstrates warnings, not a deployment recommendation.

See ALGORITHMS.md for score formulas and geometry/coverage limits. Profile defaults remain editable assumptions requiring hardware/site confirmation. RSSI thresholds, TX power and advertisement intervals are metadata only. RF propagation, RF/RSSI heatmaps, survey analysis and CSV imports remain deferred. Semantic floor analysis remains the active priority.

## Deployment planning — Milestone 6 (approved)

Select a beacon on the canvas or from **Select beacon**. Drag or edit metre coordinates, enable/disable, convert Navigation/Anchor, choose its profile/mount, lock its position, duplicate or delete it. The inspector shows nearest edge/POI, nominal/reliable/marginal radii, sampled unique coverage contribution, installation metadata and related warnings. Blue circles indicate reliable radius; orange dashed circles indicate marginal radius. These are geometric assumptions, not RF classifications.

Every edit updates coverage, statistics, quality and warnings without regenerating IDs or positions. Analysis runs in a native browser worker; only affected corridor chains, old/new radius regions and intersecting graph edges are recomputed. Unaffected floors are reused. Drag previews do not write history/IndexedDB; release commits one undoable, autosaved edit. Graph SVG and unchanged drawing shapes are memoized. Long unbranched chains still require chain-wide spacing validation, and initial analysis/very large SVG scenes can take longer than an individual edit.

**Smart recalculation** revalidates selected, selected-floor or project positions without generating a new layout. Locked beacons remain fixed and show warnings if invalid. **Generate placement** is the explicit layout-changing action; hybrid mode preserves manually adjusted/inserted and locked records. Settings changes automatically reanalyze. Default spacing/profile/mode guide subsequent generation; reliable/marginal defaults apply globally when changed. Existing positions never move merely because a spacing setting changed.

Navigation, Anchor, Disabled and Warning layers can be toggled separately. Located warnings zoom to the affected position. Statistics include enabled/disabled counts, area coverage/dead-zone/overlap percentages, spacing, graph gaps, quality and configurable per-enabled-beacon installation cost/currency.

Export deployment JSON, beacon CSV, coverage report, quality report or a PNG of the current canvas viewport. JSON explicitly distinguishes world metres from drawing pixels; reports include warnings and geometric-analysis assumptions. CSV text is quoted and protected against spreadsheet formula execution. Save named versions, reload/duplicate/delete them, and compare counts, percentages, spacing, quality and cost. Snapshots include applied settings and analyzed summaries; mismatched geometry is flagged, and legacy snapshots can have unavailable metrics until resaved.

Run `node scripts/deployment-demo.mjs` for the live-edit demonstration, exported JSON/CSV, version comparison and a 10,201-node / 20,200-edge engine benchmark. Outputs are in `reports/milestone-6-*`. Milestone 6 browser checks used the hand-modelled sample; the L00 upload workflow has since been verified in the browser. No RF simulation, Bluetooth or Flutter integration is implemented.

## Navigation simulation — Milestone 7 (awaiting approval)

Select Start POI and Destination POI, then Prepare simulation. The independent TypeScript engine finds an A* route (Dijkstra is also available through engine configuration), validates sampled route coverage, produces deterministic handovers/events and owns playback state. Play/Pause/Resume/Stop/Replay, 1×/2×/5×/10× speed and timeline seeking visualize the virtual walker, current edge, active/upcoming beacons and visited/remaining route.

Reports include distance, walking time, floors/nodes, handovers, weak sections, dead zones, coverage, reliability/navigation scores and beacon separation. Export the navigation report, event log or saved-version route comparison as JSON. Comparisons require both versions to match the current geometry/calibration/graph and evaluate the same route.

Signal is a dimensionless geometry-proximity score, not RSSI/dBm. Cross-floor connector interiors are conservatively unverified. Off-graph POI approaches are excluded and warned. Validation samples at 0.25 m with exact graph/geometry clipping; narrow RF gaps cannot be certified. The engine runs in a worker; graph and beacon JSX are cached during playback.

Run `npm run check` (TypeScript check, unit tests, production build; Node 22.18+ or 24+ required for native TypeScript test execution) and `node scripts/simulation-demo.mjs`. Sample Main entrance → Lift lobby: 57 m, 42.22 s, 10 handovers, 100% sampled route coverage, score 100. This does not contradict 38.16% floor-area coverage: the chosen corridor is covered while large floor regions are not. Disabling three route beacons exposes a 7.5 m gap and lowers navigation score to 66.93. No Bluetooth scanning, Flutter, live positioning, RSSI calibration, RF propagation or fingerprinting.
# Beacon identification

New planner beacons use sequential IDs (`IW001`, `IW002`, …). Configure **Beacon ID prefix** in the deployment panel; changes apply only to future IDs. The project saves its next number, deletion never renumbers survivors, and version reload retains the numbering high-water mark. Existing saved IDs are preserved. **Show beacon IDs** toggles map text independently of beacon icons; map tooltips contain IDs, while beacon types remain in the inspector and reports.
# beacon_mapper
