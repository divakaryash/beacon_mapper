export function snapPoint(point, gridSize, enabled = true) {
  if (!enabled || !gridSize) return point;
  return { x: Math.round(point.x / gridSize) * gridSize, y: Math.round(point.y / gridSize) * gridSize };
}

export function clientToWorld(event, svg) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

export function zoomView(view, factor, anchor) {
  const width = view.width / factor;
  const height = view.height / factor;
  const ratioX = (anchor.x - view.x) / view.width;
  const ratioY = (anchor.y - view.y) / view.height;
  return { x: anchor.x - width * ratioX, y: anchor.y - height * ratioY, width, height };
}

export function fitView(contentWidth, contentHeight, viewportWidth, viewportHeight, padding = 48) {
  const ratio = Math.max(contentWidth / Math.max(1, viewportWidth - padding * 2), contentHeight / Math.max(1, viewportHeight - padding * 2));
  const width = viewportWidth * ratio;
  const height = viewportHeight * ratio;
  return { x: (contentWidth - width) / 2, y: (contentHeight - height) / 2, width, height };
}

export const pixelsToMeters = (pixels, metersPerPixel) => pixels * metersPerPixel;
export const metersToPixels = (meters, metersPerPixel) => meters / metersPerPixel;
