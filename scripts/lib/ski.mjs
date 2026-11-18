import { RUN_COLORS } from './styles.mjs';

export const DRAG_LIFTS = new Set(['t-bar', 'j-bar', 'platter', 'rope_tow', 'drag_lift', 'magic_carpet']);
export const RAIL_LIFTS = new Set(['funicular', 'railway', 'rack_railway', 'cog_railway']);

export function runKind(uses = []) {
  if (uses.includes('downhill')) return 'downhill';
  if (uses.includes('connection')) return 'connection';
  if (uses.includes('nordic')) return 'nordic';
  if (uses.includes('skitour')) return 'skitour';
  if (uses.includes('sled')) return 'sled';
  if (uses.includes('hike')) return 'hike';
  return 'other';
}

export function runColor(difficulty) {
  return RUN_COLORS[difficulty] ?? RUN_COLORS.unknown;
}

export function liftClass(liftType) {
  if (DRAG_LIFTS.has(liftType)) return 'drag';
  if (RAIL_LIFTS.has(liftType)) return 'rail';
  return 'aerial';
}

// Shuttle systems: the same cabins/trains run up and down, so you can normally ride both ways.
export const SHUTTLE_LIFTS = new Set(['cable_car', 'funicular', 'railway', 'rack_railway', 'cog_railway']);

// 'up'      : one direction (towards the top station)
// 'both'    : passengers can ride both ways
// 'unknown' : goes up; whether riding down is allowed is not in the data
export function liftDirection(p) {
  if (p.oneway === true || DRAG_LIFTS.has(p.liftType)) return 'up';
  if (p.oneway === false || SHUTTLE_LIFTS.has(p.liftType)) return 'both';
  return 'unknown';
}

// Lifts are drawn bottom → top in OSM, but not always; use the elevation to be sure.
export function orientUphill(coords) {
  if (coords.length < 2) return coords;
  const z0 = coords[0][2];
  const z1 = coords.at(-1)[2];
  return z0 != null && z1 != null && z0 > z1 + 5 ? [...coords].reverse() : coords;
}

export function featureLabel(p) {
  const parts = [p.ref, p.name].filter((v) => v != null && String(v).trim() !== '');
  if (parts.length === 2 && String(parts[1]).startsWith(String(parts[0]))) return String(parts[1]);
  return parts.join(' ');
}
