// Run and lift classes, colours and labels.
import type { LiftClass, LiftDirection, Position, RunKind } from './types.ts';

export const RUN_COLORS: Record<string, string> = {
  novice: '#2e9d3a',
  easy: '#1f6fd6',
  intermediate: '#d8251d',
  advanced: '#111111',
  expert: '#111111',
  freeride: '#ef7d00',
  extreme: '#ef7d00',
  unknown: '#7d7d7d',
};

export const LIFT_COLOR = '#7b1fa2';
export const NORDIC_COLOR = '#2a8c8c';
export const CONNECTION_COLOR = '#5f6b75';

export const DRAG_LIFTS: ReadonlySet<string> = new Set(['t-bar', 'j-bar', 'platter', 'rope_tow', 'drag_lift', 'magic_carpet']);
export const RAIL_LIFTS: ReadonlySet<string> = new Set(['funicular', 'railway', 'rack_railway', 'cog_railway']);

export function runKind(uses: readonly string[] = []): RunKind {
  if (uses.includes('downhill')) return 'downhill';
  if (uses.includes('connection')) return 'connection';
  if (uses.includes('nordic')) return 'nordic';
  if (uses.includes('skitour')) return 'skitour';
  if (uses.includes('sled')) return 'sled';
  if (uses.includes('hike')) return 'hike';
  return 'other';
}

export function runColor(difficulty: string | null | undefined): string {
  return RUN_COLORS[difficulty ?? 'unknown'] ?? RUN_COLORS.unknown;
}

export function liftClass(liftType: string | null | undefined): LiftClass {
  if (DRAG_LIFTS.has(liftType as string)) return 'drag';
  if (RAIL_LIFTS.has(liftType as string)) return 'rail';
  return 'aerial';
}

// Shuttle systems: the same cabins/trains run up and down, so you can normally ride both ways.
export const SHUTTLE_LIFTS: ReadonlySet<string> = new Set(['cable_car', 'funicular', 'railway', 'rack_railway', 'cog_railway']);

// 'up'      : one direction (towards the top station)
// 'both'    : passengers can ride both ways
// 'unknown' : goes up; whether riding down is allowed is not in the data
export function liftDirection(p: { oneway?: boolean | null; liftType?: string | null }): LiftDirection {
  if (p.oneway === true || DRAG_LIFTS.has(p.liftType as string)) return 'up';
  if (p.oneway === false || SHUTTLE_LIFTS.has(p.liftType as string)) return 'both';
  return 'unknown';
}

// Lifts are drawn bottom → top in OSM, but not always; use the elevation to be sure.
export function orientUphill<T extends Position>(coords: T[]): T[] {
  if (coords.length < 2) return coords;
  const z0 = coords[0][2];
  const z1 = coords[coords.length - 1][2];
  return z0 != null && z1 != null && z0 > z1 + 5 ? [...coords].reverse() : coords;
}

export function featureLabel(p: { ref?: unknown; name?: unknown }): string {
  const parts = [p.ref, p.name].filter((v) => v != null && String(v).trim() !== '');
  if (parts.length === 2 && String(parts[1]).startsWith(String(parts[0]))) return String(parts[1]);
  return parts.join(' ');
}
