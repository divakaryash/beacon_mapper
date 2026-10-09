# INPS Project Plan

## Product direction

INPS is a personal, local-first engineering tool for accurate indoor-navigation planning. Simplicity, correctness, and maintainability take priority over collaboration or enterprise features.

## Current priority — automatic floor-plan analysis

The primary workflow is upload PDF/PNG/JPG/SVG → detect building geometry and landmarks → generate an editable graph → plan IW Beacon locations from real walkable geometry → display count, IDs, installation positions, navigation paths, coverage and dead zones → review minor corrections. Non-essential UI, simulation extensions and unrelated features are paused until this workflow is reliable.

An initial local heuristic implementation now connects upload to geometry segmentation, skeleton graph generation and the existing topology/coverage engines. PDF/SVG labels identify landmark candidates. Arbitrary raster symbol recognition and semantic corridor/room/atrium separation remain required work; the workflow is not yet reliably review-only for all plans. Drawing scale is explicitly provisional until confirmed by the user.

## Milestone 1 — Project foundation ✅

- Floor-plan import and preview
- Manual scale calibration
- IndexedDB project persistence
- Engine/UI module boundaries

## Milestone 2 — Floor planning and editing ✅

- Infinite SVG canvas with pan, zoom, fit, grid, and snapping
- Complete layer model with visibility and locking
- Vector drawing tools for building geometry and labels
- Room/outlet metadata and calibrated measurements
- Supported POI catalogue
- Move, resize, rotate, duplicate, delete, undo, and redo
- IndexedDB autosave for every committed edit
- Object-level SVG rendering and imperative gesture previews

## Milestone 3 — Navigation graph ✅ Approved

Independent graph engine, editing panel, automatic generation, routing, and validation implemented. Engine tests and executable POI demonstration included. Review the coordinate and performance limits in ARCHITECTURE.md before deployment use.

- Derive navigable nodes and edges from stable walkable geometry
- Allow manual graph correction
- Validate disconnected areas and unreachable POIs
- Route simulation with distance and turn information

## Milestone 4 — Beacon placement ✅ Approved

Independent graph-following placement, profiles, anchors, manual/hybrid editing, validation, statistics and benchmarks are approved. Additional hardening now includes geometry-aware relocation/rejection, mounting metadata, custom profiles, quality scores and saved deployment snapshots.

- Configurable automatic IW Beacon placement, default 5.5 m spacing
- Geometry and placement validation, never grid-based placement
- Named layout save/reload/duplicate/delete in IndexedDB

## Milestone 5 — Geometry- and graph-based coverage ✅ Approved

- Independent Coverage Engine and floor-specific rendering
- Nominal radius circles and cached coverage-count heatmap
- Dead-zone and overlap detection, sampled area percentage
- Geometry-aware graph coverage and gap analysis
- Deployment quality report and JSON report download
- Reproducible sample mall demonstration, baseline and disabled-beacon comparison
- No RF propagation, wall attenuation, RSSI simulation or antenna model

## Milestone 6 — Deployment planning and interactive editing ✅ Approved

- Live select/drag/move, delete, disable/enable, convert, profile/mount, lock and duplicate
- Independent planning session with corridor-region caches and native worker
- Selected/floor/project recalculation; no implicit layout regeneration
- Beacon inspector, coverage contribution, clickable located warnings and deployment sublayers
- Automatic settings analysis, cost/quality/gap/coverage statistics
- JSON/CSV/coverage/quality/PNG exports
- Named version snapshots with applied settings, analyzed metrics and comparison
- Sample UI demonstration and reproducible large-graph benchmark
- No RF simulation, Bluetooth communication or Flutter integration

## Milestone 7 — Indoor navigation simulation; awaiting approval

- Independent TypeScript engine, native worker and validated POI/graph input
- Shortest route, multi-floor routing, conservative connector coverage and accessibility constraints
- Deterministic geometric beacon selection, handovers, coverage validation and navigation statistics
- Playback controls, timeline seeking and map overlays
- Event log/report export and same-geometry deployment comparisons
- Sample mall demo plus large graph/beacon benchmark and automated regression checks
- No RF, Bluetooth, live positioning or mobile integration

## Milestone 8 — Topology-aware placement; awaiting review

- Independent geometry cross-sections, polygon/entrance/POI context and all ten strategy selections
- Off-center side/corner/perimeter candidates, marginal coverage and sampled route safeguards
- Bounded area optimization, configurable rules/budget, inspector and export metadata
- Valid manual positions, stable IDs, locks and existing incremental coverage preserved
- Automated strategy/geometry/persistence checks and same-count sample comparison
- No RF, Bluetooth or mobile integration

Future backlog: Installed Beacon CSV import and BLE Survey Log analysis/optimization only. RF simulation will be a later, explicitly approved milestone after the planner is stable. Automatic analysis is now explicitly requested and takes precedence over the previous milestone sequence.

Automatic floor analysis is the highest priority; manual drawing is a correction fallback.
