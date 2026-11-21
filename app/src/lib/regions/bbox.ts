// Box helpers for the "Build region" page: draw, drag corners, move, type coordinates. A box is
// [west, south, east, north] in degrees, like everywhere in the data build.
import type { Feature, Polygon } from 'geojson';

export type Bbox = [number, number, number, number];
export type LngLat = [number, number];
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

export const CORNERS: Corner[] = ['nw', 'ne', 'se', 'sw'];

const round = (v: number) => Math.round(v * 1e5) / 1e5;
const clampLat = (v: number) => Math.max(-85, Math.min(85, v));
const clampLon = (v: number) => Math.max(-180, Math.min(180, v));

/** The box between two points, in any order (rounded to 5 decimals, about 1 m). */
export function bboxFromCorners(a: LngLat, b: LngLat): Bbox {
  return [
    round(clampLon(Math.min(a[0], b[0]))),
    round(clampLat(Math.min(a[1], b[1]))),
    round(clampLon(Math.max(a[0], b[0]))),
    round(clampLat(Math.max(a[1], b[1]))),
  ];
}

export function cornerOf(b: Bbox, c: Corner): LngLat {
  return [c.endsWith('w') ? b[0] : b[2], c.startsWith('s') ? b[1] : b[3]];
}

/** The corner opposite to `c`: it stays in place while `c` is dragged. */
export function opposite(c: Corner): Corner {
  return ((c[0] === 'n' ? 's' : 'n') + (c[1] === 'w' ? 'e' : 'w')) as Corner;
}

/** Drags one corner to `to` (the box flips when the corner crosses the opposite side). */
export function moveCorner(b: Bbox, c: Corner, to: LngLat): Bbox {
  return bboxFromCorners(cornerOf(b, opposite(c)), to);
}

export function center(b: Bbox): LngLat {
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

/** Moves the whole box so its centre is at `to`. */
export function moveTo(b: Bbox, to: LngLat): Bbox {
  const [cx, cy] = center(b);
  const dx = to[0] - cx;
  const dy = to[1] - cy;
  return bboxFromCorners([b[0] + dx, b[1] + dy], [b[2] + dx, b[3] + dy]);
}

/** A box in the middle of the current map view (half its width and height). */
export function boxInView(view: Bbox): Bbox {
  const w = (view[2] - view[0]) / 4;
  const h = (view[3] - view[1]) / 4;
  const [cx, cy] = center(view);
  return bboxFromCorners([cx - w, cy - h], [cx + w, cy + h]);
}

/** Width and height in km (at the middle latitude). */
export function sizeKm(b: Bbox): { width: number; height: number } {
  const lat = ((b[1] + b[3]) / 2) * (Math.PI / 180);
  return { width: (b[2] - b[0]) * 111.32 * Math.cos(lat), height: (b[3] - b[1]) * 110.57 };
}

export function polygon(b: Bbox): Feature<Polygon> {
  const [w, s, e, n] = b;
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
  };
}

export function formatBbox(b: Bbox): string {
  return b.map((v) => v.toFixed(5)).join(', ');
}

/** "10.1, 47.2, 10.3, 47.4" (also with spaces or semicolons) → a box, or null when it is not a valid box. */
export function parseBbox(text: string): Bbox | null {
  const parts = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [w, s, e, n] = parts;
  if (w >= e || s >= n || w < -180 || e > 180 || s < -85 || n > 85) return null;
  return bboxFromCorners([w, s], [e, n]);
}
