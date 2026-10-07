const radians = (degrees) => (degrees * Math.PI) / 180;

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function polylineLength(points = []) {
  return points.slice(1).reduce((total, point, index) => total + distance(points[index], point), 0);
}

export function polygonArea(points = []) {
  if (points.length < 3) return 0;
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

export function polygonPerimeter(points = []) {
  return points.length > 2 ? polylineLength([...points, points[0]]) : polylineLength(points);
}

export function objectPoints(object) {
  if (object.points) return object.points;
  if (object.type === "rectangle" || object.type === "room") {
    return [
      { x: object.x, y: object.y },
      { x: object.x + object.width, y: object.y },
      { x: object.x + object.width, y: object.y + object.height },
      { x: object.x, y: object.y + object.height },
    ];
  }
  return [{ x: object.x, y: object.y }];
}

export function boundsOf(object) {
  const points = objectPoints(object);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export function moveObject(object, dx, dy) {
  if (object.points) {
    return { ...object, points: object.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
  }
  return { ...object, x: object.x + dx, y: object.y + dy };
}

export function resizeObject(object, handle, point, minimum = 2) {
  const bounds = boundsOf(object);
  const opposite = {
    nw: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    ne: { x: bounds.x, y: bounds.y + bounds.height },
    se: { x: bounds.x, y: bounds.y },
    sw: { x: bounds.x + bounds.width, y: bounds.y },
  }[handle];
  const next = {
    x: Math.min(point.x, opposite.x),
    y: Math.min(point.y, opposite.y),
    width: Math.max(minimum, Math.abs(point.x - opposite.x)),
    height: Math.max(minimum, Math.abs(point.y - opposite.y)),
  };

  if (!object.points) return { ...object, ...next };
  const scaleX = bounds.width ? next.width / bounds.width : 1;
  const scaleY = bounds.height ? next.height / bounds.height : 1;
  return {
    ...object,
    points: object.points.map((item) => ({
      x: next.x + (item.x - bounds.x) * scaleX,
      y: next.y + (item.y - bounds.y) * scaleY,
    })),
  };
}

export function rotationFromCenter(object, point) {
  const bounds = boundsOf(object);
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  return Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI + 90;
}

export function rotatedPoint(point, center, degrees) {
  const angle = radians(degrees);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

export function measurements(object, metersPerPixel) {
  if (!object || !metersPerPixel) return { area: null, perimeter: null, length: null };
  const points = objectPoints(object);
  const closed = ["room", "polygon", "walkableArea", "restrictedArea", "rectangle","buildingBoundary","nonWalkableArea"].includes(object.type);
  const perimeterPixels = closed ? polygonPerimeter(points) : polylineLength(points);
  return {
    area: closed ? polygonArea(points) * metersPerPixel ** 2 : null,
    perimeter: closed ? perimeterPixels * metersPerPixel : null,
    length: closed ? null : perimeterPixels * metersPerPixel,
  };
}
