# Local annotation training

This is a supervised segmentation baseline, separate from the application's rule-based detector. It uses PDF pixels as input and human polygon masks as targets. It makes no network requests during preparation, training or inference.

The current run trains on DLF floors 0, 2 and 3 and validates on Apollo B1. DLF floor 1 was excluded after visible inconsistencies between its reference polygons and PDF. AGI and Pune cannot supply supervised examples without their drawings.

```sh
python3.12 -m venv .venv-training
.venv-training/bin/python -m pip install -r training/requirements.txt
.venv-training/bin/python training/prepare.py
```

Inspect every `training/generated/*-alignment.png`. Confirm the PDF/floor pairing and polygon alignment before setting `alignmentReviewed` to `true` for each corresponding item in `training/generated/dataset.json`. The trainer refuses unreviewed pairs. PDF paths are listed at the bottom of `prepare.py`.

```sh
.venv-training/bin/python training/train.py --steps 5000
.venv-training/bin/python training/train.py --predict '/path/to/floor-plan.pdf'
```

The model is saved to `training/models/annotation-baseline.pt`; losses and validation metrics are in `training/models/training-report.json`. Inference produces review-required polygons in rendered-image pixels, not geographic coordinates. The preview is `training/generated/apollo-prediction.png`.

Classes: background, spaces, structures, vertical circulation, restricted areas and space boundaries. Names, door associations, geographic registration, paths and beacons are not predicted. Space boundary pixels help separate touching spaces, but this is semantic segmentation rather than a validated instance-annotation system.

Registration is approximate. These few annotated plans cannot establish accuracy on unfamiliar buildings. Apollo is used for checkpoint selection, so its scores are validation scores, not an untouched test. The trained model is not wired into the application's annotation workflow.
