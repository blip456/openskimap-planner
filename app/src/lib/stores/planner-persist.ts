// The planner state that survives a reload (localStorage), like the old planner's "ski-planner-v1": resort, route
// points, route name/folder, link to a saved route, route settings, display options, plan mode, open sections,
// collapsed legs, map view and the undo/redo history.
// Versioned key; everything read back is checked, so bad or old data never breaks the start-up.
import type { RouteOptions } from '@core/routing/index.ts';
import { cleanOptions } from '../route/options.ts';
import { MAX_HISTORY, type HistoryData } from '../route/history.ts';
import type { KeyValue } from './persist.ts';

export const PLANNER_KEY = 'openskimap-planner-v1';
/** The old planner's key (same origin on the desktop: http://localhost:8081). Read once when ours is missing. */
export const LEGACY_KEY = 'ski-planner-v1';
export const STATE_VERSION = 1;
export const MAX_POINTS = 25;

export type LngLat = [number, number];

export interface DisplayData {
  showArrows: boolean;
  showDistances: boolean;
  showSkiAreas: boolean;
  /** run colours on the map: official difficulty or steepness */
  colorBy: 'difficulty' | 'slope';
  /** route gradient chart: official difficulty or steepness */
  profileColor: 'official' | 'steepness';
  basemap: 'local' | 'online' | 'openfreemap';
  terrain3d: boolean;
  layers: { downhill: boolean; lifts: boolean; nordic: boolean; other: boolean };
}

export const DEFAULT_DISPLAY: DisplayData = {
  showArrows: true,
  showDistances: true,
  showSkiAreas: false,
  colorBy: 'difficulty',
  profileColor: 'official',
  basemap: 'local',
  terrain3d: false,
  layers: { downhill: true, lifts: true, nordic: true, other: true },
};

export interface MapView {
  resort: string;
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface PlannerData {
  version: number;
  resort: string | null;
  points: LngLat[];
  routeName: string;
  routeFolder: string;
  savedId: string | null;
  savedSnapshot: string | null;
  routeStorage: 'browser' | 'server';
  options: RouteOptions;
  display: DisplayData;
  planMode: boolean;
  /** open sheet, its detent, open sub-pages … (key → value) */
  sections: Record<string, string | boolean | number>;
  collapsedLegs: string[];
  view: MapView | null;
  history: HistoryData | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '');
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validPoint(p: unknown): p is LngLat {
  return Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}

export function cleanPoints(v: unknown): LngLat[] {
  return Array.isArray(v) ? v.filter(validPoint).slice(0, MAX_POINTS).map((p) => [p[0], p[1]]) : [];
}

export function cleanDisplay(v: unknown): DisplayData {
  const d = DEFAULT_DISPLAY;
  const x = isObject(v) ? v : {};
  const bool = (val: unknown, fallback: boolean) => (typeof val === 'boolean' ? val : fallback);
  const pick = <T extends string>(val: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(val as T) ? (val as T) : fallback);
  const layers = isObject(x.layers) ? x.layers : {};
  return {
    showArrows: bool(x.showArrows, d.showArrows),
    showDistances: bool(x.showDistances, d.showDistances),
    showSkiAreas: bool(x.showSkiAreas, d.showSkiAreas),
    colorBy: pick(x.colorBy, ['difficulty', 'slope'], d.colorBy),
    profileColor: pick(x.profileColor, ['official', 'steepness'], d.profileColor),
    basemap: pick(x.basemap, ['local', 'online', 'openfreemap'], d.basemap),
    terrain3d: bool(x.terrain3d, d.terrain3d),
    layers: {
      downhill: bool(layers.downhill, true),
      lifts: bool(layers.lifts, true),
      nordic: bool(layers.nordic, true),
      other: bool(layers.other, true),
    },
  };
}

function cleanView(v: unknown): MapView | null {
  if (!isObject(v) || typeof v.resort !== 'string' || !validPoint(v.center) || !finite(v.zoom)) return null;
  return {
    resort: v.resort,
    center: [v.center[0], v.center[1]],
    zoom: Math.min(22, Math.max(0, v.zoom)),
    bearing: finite(v.bearing) ? v.bearing : 0,
    pitch: finite(v.pitch) ? Math.min(85, Math.max(0, v.pitch)) : 0,
  };
}

function cleanHistory(v: unknown): HistoryData | null {
  if (!isObject(v) || !Array.isArray(v.past) || !Array.isArray(v.future)) return null;
  const snaps = (a: unknown[]) => a.filter((s): s is string => typeof s === 'string' && s.startsWith('{')).slice(-MAX_HISTORY);
  return { past: snaps(v.past), future: snaps(v.future) };
}

function cleanSections(v: unknown): PlannerData['sections'] {
  if (!isObject(v)) return {};
  const out: PlannerData['sections'] = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string' || typeof val === 'boolean' || finite(val)) out[k.slice(0, 60)] = typeof val === 'string' ? val.slice(0, 60) : val;
  }
  return out;
}

/** Any stored value (ours or the old planner's) → a complete, valid state. */
export function cleanPlannerData(raw: unknown): PlannerData {
  const x = isObject(raw) ? raw : {};
  return {
    version: STATE_VERSION,
    resort: typeof x.resort === 'string' && x.resort ? x.resort : null,
    points: cleanPoints(x.points),
    routeName: str(x.routeName, 120),
    routeFolder: str(x.routeFolder, 60),
    savedId: typeof x.savedId === 'string' && x.savedId ? x.savedId : null,
    savedSnapshot: typeof x.savedSnapshot === 'string' ? x.savedSnapshot : null,
    routeStorage: x.routeStorage === 'server' ? 'server' : 'browser',
    options: cleanOptions(x.options),
    display: cleanDisplay(x.display),
    planMode: typeof x.planMode === 'boolean' ? x.planMode : false,
    sections: cleanSections(x.sections),
    collapsedLegs: Array.isArray(x.collapsedLegs) ? x.collapsedLegs.filter((k): k is string => typeof k === 'string').slice(0, 100) : [],
    view: cleanView(x.view),
    history: cleanHistory(x.history),
  };
}

function readJson(kv: KeyValue | null, key: string): unknown {
  try {
    const text = kv?.getItem(key);
    return text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/** Reads our key; when it is missing, takes over the old planner's state (migration). */
export function loadPlannerData(kv: KeyValue | null): { data: PlannerData; source: 'stored' | 'legacy' | 'new' } {
  const ours = readJson(kv, PLANNER_KEY);
  if (isObject(ours)) {
    // a newer version written by a newer app: read what we understand
    return { data: cleanPlannerData(ours), source: 'stored' };
  }
  const legacy = readJson(kv, LEGACY_KEY);
  if (isObject(legacy)) return { data: cleanPlannerData(legacy), source: 'legacy' };
  return { data: cleanPlannerData(undefined), source: 'new' };
}

/** Writes the state; when storage is full, drops the history and tries again. Returns false if it failed. */
export function savePlannerData(kv: KeyValue | null, data: PlannerData): boolean {
  if (!kv) return false;
  try {
    kv.setItem(PLANNER_KEY, JSON.stringify(data));
    return true;
  } catch {
    try {
      kv.setItem(PLANNER_KEY, JSON.stringify({ ...data, history: null }));
      return true;
    } catch {
      return false;
    }
  }
}
