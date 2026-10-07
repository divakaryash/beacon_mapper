# INPS TODO

## Approved Milestones 1–6

- Milestones 1–6 approved by the user.
- Perform hands-on planning with a surveyed project floor plan before field deployment.
- Confirm room metadata fields and layer terminology match the deployment workflow.
- Decide whether a minimap provides enough value to add; it remains optional.

## Milestone 3 review

- [x] Graph models, adjacency, spatial snapping, and editing commands
- [x] Walkable-path generation and editable graph visualization
- [x] Dijkstra/A*, multi-floor and accessibility constraints
- [x] Validation, unit tests, POI route demonstration, and engine benchmark
- [ ] Hands-on review with measured building geometry and explicit POI entrances
- [ ] Profile SVG rendering at deployment-sized datasets; engine benchmark does not cover UI rendering
- [ ] Dedicated floor-plan management if projects need separate drawings per floor
- [x] Milestone 3 approved

## Milestone 4 verification

- [x] Independent graph-following placement, profiles, manual adjustments, statistics and validation
- [x] Placement unit tests and large-graph benchmark
- [x] Verify interactive beacon selection, mounting metadata, disabling and recalculation in a browser
- [x] Validate wall/restricted-area/boundary/non-walkable conflicts and nearest valid graph relocation
- [ ] Demonstrate placement on the supplied mall floor (source not present in this workspace)
- [x] Milestone 4 approval received
- [x] Installation metadata, custom profiles, quality scores and deployment snapshot lifecycle

## Milestone 5 review

- [x] Independent geometry/graph Coverage Engine; no RF simulation
- [x] Circles, count heatmap, dead-zone/overlap detection and floor selection
- [x] Area percentage, graph coverage, gap analysis and quality report download
- [x] Bounded resolution with explicit warnings; cached raster visualization
- [x] Baseline sample mall demo and controlled three-disabled-beacon gap comparison
- [x] Unit tests, production build and browser persistence checks
- [x] User approval received for Milestone 5
- [ ] Field review with accurate wall thickness, walkable polygons, mounting constraints and manufacturer-confirmed profiles

## Milestone 6 review

- [x] Live edits without regeneration; lock, profile, mount, duplicate and inspector
- [x] Incremental/full coverage equivalence and metadata-only cache reuse
- [x] Selected/floor/project recalculation and hybrid preservation
- [x] Engineering warning locations and zoom, deployment sublayers
- [x] Cost/settings/quality/statistics updates
- [x] JSON/CSV/report/PNG exports and browser download verification
- [x] Version save/reload and A/B metrics comparison
- [x] Worker analysis and corridor-chain cache benchmark
- [x] Milestone 6 user approval received
- [ ] Field review of the DLF PDF after manual geometry tracing/calibration

## Milestone 7 review

- [x] Milestone 7 independent TypeScript simulation/playback/validation engine
- [x] Route handovers, timeline and report/comparison export
- [x] Geometry-blocked and multi-floor conservative coverage checks
- [x] Sample mall demonstration and 10,001-node / 2,501-beacon benchmark
- [ ] Milestone 7 explicit approval (user subsequently requested Milestone 8 redesign)

## Milestone 8 review

- [x] Independent topology engine and all ten strategy selections
- [x] Per-edge width, explicit entrance/POI context and polygon references
- [x] Off-center mounting, bounded area optimization and sampled route protection
- [x] Valid manual positions preserved; reference-aware recalculation and anchor checks
- [x] Configurable settings, inspector, export metadata and same-count comparison
- [x] Regression checks and before/after geometric diagrams
- [ ] User approval before the next milestone
- [ ] Site-specific threshold/profile calibration and survey validation

## Explicitly deferred

- RF propagation and RSSI simulation (later milestone; geometry-based count heatmap is implemented)
- Installed Beacon CSV import
- BLE Survey Log analysis
- AI floor analysis
- Authentication, user management, teams, billing, multi-tenancy, cloud sync, notifications, roles, and audit logs
