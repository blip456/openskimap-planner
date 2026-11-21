// Route gradient profile: elevation along the whole route, coloured by the official difficulty of each run or by
// the measured gradient of ~30–50 m slices. Lifts and walking parts keep their own colour.
// Port of the old planner's routeProfilePoints / routeGradient / officialStyle / routeProfileSegments.
import { haversine } from '@core/geo.ts';
import { CONNECTION_COLOR, LIFT_COLOR, RUN_COLORS } from '@core/ski.ts';
import { SLOPE_CLASSES, slopeClass } from '@core/slope.ts';
import type { RouteStep } from '@core/routing/index.ts';

export type ProfileStep = Pick<RouteStep, 'type' | 'runKind' | 'difficulty' | 'color' | 'coordinates' | 'eleStart' | 'eleEnd' | 'leg' | 'label' | 'liftType' | 'down'>;
export interface ProfileRoute {
  steps: readonly ProfileStep[];
  legs: readonly { index: number }[];
}

export interface ProfilePoint {
  /** m from the start */
  d: number;
  /** elevation, m */
  e: number;
  lon: number;
  lat: number;
  /** index of the route step */
  step: number;
}

export type ProfileMode = 'official' | 'steepness';

export interface ProfileSegment {
  from: number;
  to: number;
  slope: number;
  step: number;
  color: string;
  key: string;
  label: string;
}

/** Short difficulty names (spec §6 legend). */
export const DIFFICULTY_SHORT: Record<string, string> = {
  novice: 'Green',
  easy: 'Blue',
  intermediate: 'Red',
  advanced: 'Black',
  expert: 'Black ◆◆',
  freeride: 'Freeride',
  extreme: 'Freeride',
  unknown: 'Unknown',
};
const DIFFICULTY_ORDER = ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'freeride', 'unknown'];

export function routeProfilePoints(r: ProfileRoute): ProfilePoint[] {
  const points: ProfilePoint[] = [];
  let d = 0;
  // consecutive steps share their boundary point; it is kept in both so every step has its own piece
  r.steps.forEach((st, stepIndex) => {
    st.coordinates.forEach((c, i) => {
      const prev = points.at(-1);
      if (prev) d += haversine([prev.lon, prev.lat], c);
      const e = c[2] ?? (i === 0 ? st.eleStart : st.eleEnd);
      points.push({ d, e, lon: c[0], lat: c[1], step: stepIndex });
    });
  });
  return points;
}

const isDownhill = (st: Pick<ProfileStep, 'type' | 'runKind'>): boolean => st.type === 'run' && st.runKind === 'downhill';

/** Average and steepest gradient of the downhill runs (lifts, paths and walking left out). Steepest = 30 m window. */
export function routeGradient(r: ProfileRoute, points = routeProfilePoints(r)): { avg: number; max: number | null } | null {
  let horizontal = 0;
  let descent = 0;
  let max: number | null = null;
  r.steps.forEach((st, stepIndex) => {
    if (!isDownhill(st)) return;
    const pts = points.filter((p) => p.step === stepIndex);
    if (pts.length < 2) return;
    horizontal += pts[pts.length - 1].d - pts[0].d;
    for (let i = 1; i < pts.length; i++) descent += Math.max(0, pts[i - 1].e - pts[i].e);
    let j = 0;
    for (let i = 0; i < pts.length; i++) {
      while (j < pts.length && pts[j].d - pts[i].d < 30) j++;
      if (j >= pts.length) break;
      max = Math.max(max ?? 0, Math.abs(pts[j].e - pts[i].e) / (pts[j].d - pts[i].d));
    }
  });
  return horizontal > 0 ? { avg: descent / horizontal, max } : null;
}

/** Colour + legend entry of one route step in "official" mode. */
export function officialStyle(st: Pick<ProfileStep, 'type' | 'runKind' | 'difficulty' | 'color'>): { color: string; key: string; label: string } {
  if (st.type === 'lift') return { color: LIFT_COLOR, key: 'lift', label: 'Lift' };
  if (st.type === 'walk' || st.runKind !== 'downhill') return { color: CONNECTION_COLOR, key: 'walk', label: 'Path / walk' };
  const key = st.difficulty && DIFFICULTY_SHORT[st.difficulty] ? st.difficulty : 'unknown';
  return { color: st.color ?? RUN_COLORS[key] ?? RUN_COLORS.unknown, key, label: DIFFICULTY_SHORT[key] };
}

/** Coloured pieces of the profile: one per step (official) or slices of roughly equal length (steepness). */
export function routeProfileSegments(r: ProfileRoute, points: readonly ProfilePoint[], mode: ProfileMode): ProfileSegment[] {
  const segments: ProfileSegment[] = [];
  if (!points.length) return segments;
  const total = points[points.length - 1].d || 1;
  const sliceLength = Math.max(30, total / 80);
  const push = (from: number, to: number) => {
    if (to <= from) return;
    const st = r.steps[points[from].step];
    const horizontal = points[to].d - points[from].d;
    const slope = horizontal > 0 ? Math.abs(points[to].e - points[from].e) / horizontal : 0;
    let style = officialStyle(st);
    if (mode === 'steepness' && isDownhill(st)) {
      const cls = slopeClass(slope) ?? SLOPE_CLASSES[SLOPE_CLASSES.length - 1];
      style = { color: cls.color, key: `slope-${cls.id}`, label: cls.label };
    }
    segments.push({ from, to, slope, step: points[from].step, ...style });
  };
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    const a = points[start];
    const b = points[i];
    if (!b || b.step !== a.step) {
      push(start, i - 1);
      start = i;
      continue;
    }
    const st = r.steps[a.step];
    if (mode === 'steepness' && isDownhill(st) && b.d - a.d >= sliceLength) {
      push(start, i);
      start = i;
    }
  }
  return segments;
}

/** Legend entries in a fixed order, only for colours that are used. */
export function profileLegend(segments: readonly ProfileSegment[], mode: ProfileMode): { key: string; label: string; color: string }[] {
  const order =
    mode === 'steepness'
      ? [...SLOPE_CLASSES.map((c) => `slope-${c.id}`), ...DIFFICULTY_ORDER, 'walk', 'lift']
      : [...DIFFICULTY_ORDER, 'lift', 'walk'];
  const used = new Map(segments.map((s) => [s.key, s]));
  return order.flatMap((key) => {
    const s = used.get(key);
    return s ? [{ key, label: s.label, color: s.color }] : [];
  });
}

/** Gridline step for an elevation range (old planner: niceStep). */
export function niceStep(range: number, maxTicks = 5): number {
  for (const step of [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (range / step <= maxTicks) return step;
  return 2000;
}

/** Elevation axis: rounded min/max and the gridlines (at most `maxLines`). */
export function elevationAxis(points: readonly ProfilePoint[], maxLines = 3): { min: number; max: number; ticks: number[] } {
  const eles = points.map((p) => p.e);
  const rawMin = Math.min(...eles);
  const rawMax = Math.max(...eles);
  const step = niceStep(Math.max(rawMax - rawMin, 10), maxLines - 1);
  const min = Math.floor(rawMin / step) * step;
  const max = Math.max(Math.ceil(rawMax / step) * step, min + step);
  const ticks: number[] = [];
  for (let e = min; e <= max + 0.01; e += step) ticks.push(e);
  return { min, max, ticks };
}

/** Distance axis: nice ticks plus the total at the end; ticks too close to the total are dropped. */
export function distanceTicks(total: number, maxTicks = 4): number[] {
  const steps = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
  const step = steps.find((s) => total / s <= maxTicks) ?? 100000;
  const ticks: number[] = [];
  for (let d = 0; d < total - step * 0.45; d += step) ticks.push(d);
  ticks.push(total);
  return ticks;
}

/** Label of the total at the end of the distance axis: whole metres below 1 km, else km with one decimal
 * (no decimal for whole km), like the route's distance markers. */
export function endLabel(total: number): string {
  if (total < 1000) return `${Math.round(total)} m`;
  const km = Math.round(total / 100) / 10;
  return `${Number.isInteger(km) ? km.toFixed(0) : km.toFixed(1)} km`;
}

/** Rough width of an 11 px axis label in px (tabular digits, about 6.2 px per character). */
export const labelWidth = (text: string, charWidth = 6.2): number => text.length * charWidth;

/**
 * Distance ticks that fit on a plot `plotW` px wide: a middle tick (centred label) is dropped when its label
 * would touch the end label (right-aligned at the end). `label` turns a distance into the label text.
 */
export function visibleDistanceTicks(total: number, plotW: number, label: (d: number) => string, gap = 8): number[] {
  const ticks = distanceTicks(total);
  const endWidth = labelWidth(label(total));
  return ticks.filter((d, i) => {
    if (i === ticks.length - 1) return true;
    const space = ((total - d) / total) * plotW;
    // the first label is left-aligned at 0, the others are centred on their tick
    const own = i === 0 ? labelWidth(label(d)) : labelWidth(label(d)) / 2;
    return space >= own + endWidth + gap;
  });
}

export interface ProfileSample {
  d: number;
  e: number;
  lon: number;
  lat: number;
  /** gradient of the segment under the cursor (0.25 = 25 %) */
  slope: number;
  segment: ProfileSegment;
  step: number;
}

/** The point at distance d along the profile (interpolated), with its segment. */
export function sampleAt(points: readonly ProfilePoint[], segments: readonly ProfileSegment[], dIn: number): ProfileSample | null {
  if (points.length < 2 || !segments.length) return null;
  const total = points[points.length - 1].d;
  const d = Math.min(total, Math.max(0, dIn));
  let i = 1;
  while (i < points.length - 1 && points[i].d < d) i++;
  const a = points[i - 1];
  const b = points[i];
  const t = (d - a.d) / (b.d - a.d || 1);
  const segment = segments.find((s) => d >= points[s.from].d && d <= points[s.to].d) ?? segments[segments.length - 1];
  return {
    d,
    e: a.e + (b.e - a.e) * t,
    lon: a.lon + (b.lon - a.lon) * t,
    lat: a.lat + (b.lat - a.lat) * t,
    slope: segment.slope,
    segment,
    step: segment.step,
  };
}

/** Where the route points A, B, C… are along the profile: one distance per point. */
export function pointMarks(r: ProfileRoute, points: readonly ProfilePoint[]): number[] {
  if (!points.length) return [];
  const total = points[points.length - 1].d;
  const marks = [0];
  for (const leg of r.legs.slice(1)) {
    const p = points.find((q) => r.steps[q.step].leg === leg.index);
    marks.push(p ? p.d : marks[marks.length - 1]);
  }
  marks.push(total);
  return marks;
}
