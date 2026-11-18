const EARTH_RADIUS = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(s));
}

export function emptyBbox() {
  return [Infinity, Infinity, -Infinity, -Infinity];
}

export function extendBbox(bbox, coords) {
  if (typeof coords[0] === 'number') {
    if (coords[0] < bbox[0]) bbox[0] = coords[0];
    if (coords[1] < bbox[1]) bbox[1] = coords[1];
    if (coords[0] > bbox[2]) bbox[2] = coords[0];
    if (coords[1] > bbox[3]) bbox[3] = coords[1];
    return bbox;
  }
  for (const c of coords) extendBbox(bbox, c);
  return bbox;
}

export function geometryBbox(geometry) {
  return extendBbox(emptyBbox(), geometry.coordinates);
}

export function bboxValid(bbox) {
  return Number.isFinite(bbox[0]) && bbox[2] >= bbox[0] && bbox[3] >= bbox[1];
}

export function bboxIntersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function bboxUnion(a, b) {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function bufferBbox(bbox, km) {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos(toRad(midLat)));
  return [bbox[0] - dLon, bbox[1] - dLat, bbox[2] + dLon, bbox[3] + dLat];
}

export function bboxToPolygon(b) {
  return [
    [
      [b[0], b[1]],
      [b[2], b[1]],
      [b[2], b[3]],
      [b[0], b[3]],
      [b[0], b[1]],
    ],
  ];
}

export function roundBbox(b, digits = 5) {
  const f = 10 ** digits;
  return [
    Math.floor(b[0] * f) / f,
    Math.floor(b[1] * f) / f,
    Math.ceil(b[2] * f) / f,
    Math.ceil(b[3] * f) / f,
  ];
}

// Web Mercator tile math
export function lonToTileX(lon, z) {
  return ((lon + 180) / 360) * 2 ** z;
}

export function latToTileY(lat, z) {
  const r = toRad(lat);
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

export function tileRange(bbox, z) {
  return {
    x0: Math.floor(lonToTileX(bbox[0], z)),
    x1: Math.floor(lonToTileX(bbox[2], z)),
    y0: Math.floor(latToTileY(bbox[3], z)),
    y1: Math.floor(latToTileY(bbox[1], z)),
  };
}

export const MERC_HALF = Math.PI * 6378137;
