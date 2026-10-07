# Indoor Navigation Planning Studio (INPS)

A local-first engineering tool for modelling buildings and planning IW Beacon deployments. INPS runs entirely in the browser and deliberately has no backend, accounts, organizations, billing, or cloud services.

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
2. Calibrate the scale. Draw a **Boundary** and walkable areas or width-configured paths. Use Properties to assign geometry roles, floor IDs and wall thickness. Existing polygons/rooms/rectangles can be marked as boundaries, walkable, restricted or non-walkable.
3. Create/review the navigation graph, generate beacons, and review placement warnings.
4. Click **Analyze coverage**. Toggle circles, heatmap, dead zones, overlap and graph gaps independently. Select the coverage floor if multiple floors exist.
5. Review the quality report and download its JSON. Use saved deployment controls for comparisons.

Defaults: 0.5 m area cells, 0.25 m graph sampling. Analysis coarsens large rasters with a warning. Graph geometry boundaries are inserted into the samples so a thin wall cannot disappear between graph samples. The rendered heatmap is a cached raster, not thousands of React cell components. Reports explicitly disclose resolution and sampled area.

Run `npm run check` for all tests/build, `node scripts/beacon-demo.mjs` for placement, and `node scripts/coverage-demo.mjs` to regenerate the sample coverage diagrams and quality report. The sample is hand-modelled from the Milestone 2 drawing, not a surveyed mall: 17 beacons (5 anchors), 38.2% walkable-area coverage, 100% graph coverage, 5 dead zones (1493.5 m²), and 669 m² overlap. Disabling three adjacent beacons exposes an 11.5 m graph gap. This deliberately imperfect sample demonstrates warnings, not a deployment recommendation.

See ALGORITHMS.md for score formulas and geometry/coverage limits. Profile defaults remain editable assumptions requiring hardware/site confirmation. RSSI thresholds, TX power and advertisement intervals are metadata only. RF propagation, RF/RSSI heatmaps, survey analysis, CSV imports and AI floor analysis remain deferred.

## Deployment planning — Milestone 6 (implemented; awaiting approval)

Select a beacon on the canvas or from **Select beacon**. Drag or edit metre coordinates, enable/disable, convert Navigation/Anchor, choose its profile/mount, lock its position, duplicate or delete it. The inspector shows nearest edge/POI, nominal/reliable/marginal radii, sampled unique coverage contribution, installation metadata and related warnings. Blue circles indicate reliable radius; orange dashed circles indicate marginal radius. These are geometric assumptions, not RF classifications.

Every edit updates coverage, statistics, quality and warnings without regenerating IDs or positions. Analysis runs in a native browser worker; only affected corridor chains, old/new radius regions and intersecting graph edges are recomputed. Unaffected floors are reused. Drag previews do not write history/IndexedDB; release commits one undoable, autosaved edit. Graph SVG and unchanged drawing shapes are memoized. Long unbranched chains still require chain-wide spacing validation, and initial analysis/very large SVG scenes can take longer than an individual edit.

**Smart recalculation** revalidates selected, selected-floor or project positions without generating a new layout. Locked beacons remain fixed and show warnings if invalid. **Generate placement** is the explicit layout-changing action; hybrid mode preserves manually adjusted/inserted and locked records. Settings changes automatically reanalyze. Default spacing/profile/mode guide subsequent generation; reliable/marginal defaults apply globally when changed. Existing positions never move merely because a spacing setting changed.

Navigation, Anchor, Disabled and Warning layers can be toggled separately. Located warnings zoom to the affected position. Statistics include enabled/disabled counts, area coverage/dead-zone/overlap percentages, spacing, graph gaps, quality and configurable per-enabled-beacon installation cost/currency.

Export deployment JSON, beacon CSV, coverage report, quality report or a PNG of the current canvas viewport. JSON explicitly distinguishes world metres from drawing pixels; reports include warnings and geometric-analysis assumptions. CSV text is quoted and protected against spreadsheet formula execution. Save named versions, reload/duplicate/delete them, and compare counts, percentages, spacing, quality and cost. Snapshots include applied settings and analyzed summaries; mismatched geometry is flagged, and legacy snapshots can have unavailable metrics until resaved.

Run `node scripts/deployment-demo.mjs` for the live-edit demonstration, exported JSON/CSV, version comparison and a 10,201-node / 20,200-edge engine benchmark. Outputs are in `reports/milestone-6-*`. Browser checks use the hand-modelled sample, not automatic analysis of the imported DLF PDF. No RF simulation, Bluetooth or Flutter integration is implemented. Await approval before the next milestone.
# Beacon identification

New planner beacons use sequential IDs (`IW001`, `IW002`, …). Configure **Beacon ID prefix** in the deployment panel; changes apply only to future IDs. The project saves its next number, deletion never renumbers survivors, and version reload retains the numbering high-water mark. Existing saved IDs are preserved. **Show beacon IDs** toggles map text independently of beacon icons; map tooltips contain IDs, while beacon types remain in the inspector and reports.
# beacon_mapper
