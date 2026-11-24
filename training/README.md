# Local annotation training

This is a supervised segmentation baseline, separate from the application's rule-based detector. It uses PDF pixels as input and human polygon masks as targets. It makes no network requests during preparation, training or inference.

Prepare matching PDF/GeoJSON pairs explicitly. DLF ground and L03 are candidate training floors, and L04 can serve as a separate validation floor for a prototype. Use a different annotated building to evaluate cross-building accuracy. The CLI accepts DLF, AGI and Pune reference data.

```powershell
python training/prepare.py --pair dlf 0 train "path/to/GROUND FLOOR (L-01) Model (1).pdf" --pair dlf 2 train "path/to/SECOND FLOOR PLAN (L03) Model (1).pdf" --pair dlf 3 validation "path/to/THIRD FLOOR PLAN (L04) Model (1).pdf"
```

Inspect every `training/generated/*-alignment.png`. Confirm the PDF/floor pairing and polygon alignment before setting `alignmentReviewed` to `true` for each corresponding item in `training/generated/dataset.json`. The trainer refuses unreviewed pairs.

```sh
python training/train.py --steps 5000
python training/train.py --predict '/path/to/floor-plan.pdf'
```

The model is saved to `training/models/annotation-baseline.pt`; losses and validation metrics are in `training/models/training-report.json`. Inference produces review-required polygons in rendered-image pixels, not geographic coordinates. The preview is `training/generated/validation-prediction.png`.

Classes: background, spaces, structures, vertical circulation, restricted areas and space boundaries. Names, door associations, geographic registration, paths and beacons are not predicted. Space boundary pixels help separate touching spaces, but this is semantic segmentation rather than a validated instance-annotation system.

Registration is approximate. These few annotated plans cannot establish accuracy on unfamiliar buildings. Validation scores are used for checkpoint selection. A separate building is needed for an independent test. The trained model is not wired into the application's annotation workflow.
