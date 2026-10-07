export function calculateScale(widthMeters, drawingWidthPixels) {
  const meters = Number(widthMeters);
  const pixels = Number(drawingWidthPixels);

  if (!Number.isFinite(meters) || meters <= 0 || !Number.isFinite(pixels) || pixels <= 0) {
    return null;
  }

  return meters / pixels;
}

export function formatScale(metersPerPixel) {
  return metersPerPixel ? `1 px = ${metersPerPixel.toFixed(4)} m` : "Scale not calibrated";
}
