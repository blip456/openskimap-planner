// Steepness classes (approximate European piste guidelines) and slicing a run into slope segments.
import { haversine } from './geo.ts';
import type { Position } from './types.ts';

export interface SlopeClass {
  id: 'green' | 'blue' | 'red' | 'black';
  max: number;
  color: string;
  label: string;
}

export const SLOPE_CLASSES: readonly SlopeClass[] = [
  { id: 'green', max: 0.1, color: '#2e9d3a', label: '< 10%' },
  { id: 'blue', max: 0.25, color: '#1f6fd6', label: '10–25%' },
  { id: 'red', max: 0.4, color: '#d8251d', label: '25–40%' },
  { id: 'black', max: Infinity, color: '#111111', label: '> 40%' },
];

/** Class for a slope (rise over run, 0.25 = 25 %). NaN has no class. */
export const slopeClass = (s: number): SlopeClass | undefined => SLOPE_CLASSES.find((c) => s < c.max);

export interface SlopeSegment {
  coordinates: Position[];
  slope: number;
  cls: SlopeClass['id'];
  length: number;
}

// Cut a 3D line into pieces of ~pieceLength metres, each with its own slope, then join neighbouring pieces
// of the same class. Returns [{ coordinates, slope, cls }] or [] if the line has no elevation.
export function slopeSegments(coords: Position[], pieceLength = 50): SlopeSegment[] {
  if (coords.length < 2 || coords.some((c) => c[2] == null)) return [];
  const z = (c: Position): number => c[2] as number;
  const dist = [0];
  for (let i = 1; i < coords.length; i++) dist.push(dist[i - 1] + haversine(coords[i - 1], coords[i]));
  const total = dist[dist.length - 1];
  if (total < 1) return [];

  const at = (d: number): Position => {
    let i = 1;
    while (i < coords.length - 1 && dist[i] < d) i++;
    const t = (d - dist[i - 1]) / (dist[i] - dist[i - 1] || 1);
    const a = coords[i - 1];
    const b = coords[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z(a) + (z(b) - z(a)) * t];
  };

  const count = Math.max(1, Math.round(total / pieceLength));
  const step = total / count;
  const pieces: SlopeSegment[] = [];
  for (let k = 0; k < count; k++) {
    const d0 = k * step;
    const d1 = (k + 1) * step;
    const start = at(d0);
    const end = at(d1);
    const inner = coords.filter((_, i) => dist[i] > d0 && dist[i] < d1);
    const slope = Math.abs(z(end) - z(start)) / step;
    pieces.push({ coordinates: [start, ...inner, end], slope, cls: (slopeClass(slope) as SlopeClass).id, length: step });
  }

  const merged: SlopeSegment[] = [];
  for (const p of pieces) {
    const prev = merged[merged.length - 1];
    if (prev && prev.cls === p.cls) {
      prev.slope = (prev.slope * prev.length + p.slope * p.length) / (prev.length + p.length);
      prev.length += p.length;
      prev.coordinates.push(...p.coordinates.slice(1));
    } else {
      merged.push({ ...p, coordinates: [...p.coordinates] });
    }
  }
  return merged;
}
