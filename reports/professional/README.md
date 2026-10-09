# Professional annotation export

Run `python3 -m venv .venv-annotation`, then `.venv-annotation/bin/pip install -r requirements-annotation.txt`. Start `npm run dev`. Professional export lives in the deployment panel alongside the compatible existing export. Vite development and preview serve the Python validation endpoint; a static-only production host needs an equivalent backend endpoint. It fails closed when the backend is unavailable.

Choose venue type, actual integer floor, and optional JSON profile overrides. For geographic output supply at least three surveyed controls:

```json
[{"pixel":[100,200],"latitude":28.0,"longitude":77.0}]
```

The example shows the shape only, not real control points. Coordinates use the imported drawing frame. Geographic export rejects collinear controls or any residual over the profile threshold. The local diagnostic option explicitly reports unverified registration and scale.

CLI: `.venv-annotation/bin/python scripts/export_annotation.py input-local.geojson --config config.json --output annotation.geojson`. Input is the existing export in local metres, not an already-geographic export. Config includes `floor`, `metersPerPixel`, `scaleSource`, `controlPoints`, optional `profile`, `labels`, `graph`, `routing`, and `localDiagnostic`. `--legacy-output` copies the compatible input without professional conversion. Every professional export invokes `validate_annotation.py` and writes a Markdown report. Routing remains a separate local-metre artifact.

Validation: `.venv-annotation/bin/python scripts/validate_annotation.py annotation.geojson --report report.md`. For explicitly local diagnostic drafts add `--local-diagnostic`. Optional comparison: `.venv-annotation/bin/python scripts/compare_to_reference.py mine.geojson reference.json`; without a reference it reports skipped. Compare files in the same coordinate system; geographic area statistics are coordinate-square units, not metres, in the comparison tool.

The real mall audit uses SECOND FLOOR PLAN (L03) Model (1).pdf. Its assumed 100 m width is diagnostic, not verified. No surveyed mall controls are available. Campus is a synthetic fixture with simulated dimensions and controls. Reports do not establish professional detection accuracy without ground truth.

Remaining review requirements: inferred door edges/hinges, unknown names and circulation direction, shared fragments without partition evidence, and source segmentation errors. Adjacent-floor counterpart warnings are available through `validate_annotation.py --adjacent-floor other-floor.geojson`. Cleanup operates on detected outlines; it cannot reconstruct missing walls from text alone. Door reachability in routing is reported independently from annotation validity. It is not a measurement of all corridor area coverage.
