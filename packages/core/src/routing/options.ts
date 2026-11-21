// Route options, speeds and travel times.
import type { Position } from '../types.ts';

export const DIFFICULTIES = ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'freeride', 'unknown'];
export const DIFFICULTY_LEVEL: Record<string, number> = {
  novice: 0,
  easy: 1,
  intermediate: 2,
  advanced: 3,
  expert: 4,
  freeride: 5,
  extreme: 5,
  unknown: 2,
};

/** Speeds in km/h per run difficulty, plus `connection` and `walk`. */
export type Speeds = Record<string, number>;
export type SpeedPreset = 'beginner' | 'intermediate' | 'confident';

// Average skiing speeds in km/h (including short stops). Used for the time estimates and the route choice.
export const SPEED_PRESETS: Record<SpeedPreset, Speeds> = {
  beginner: { novice: 12, easy: 14, intermediate: 10, advanced: 7, expert: 5, freeride: 5, unknown: 12, connection: 8, walk: 3 },
  intermediate: { novice: 18, easy: 22, intermediate: 20, advanced: 14, expert: 10, freeride: 10, unknown: 18, connection: 12, walk: 3.5 },
  confident: { novice: 25, easy: 32, intermediate: 35, advanced: 28, expert: 22, freeride: 18, unknown: 28, connection: 15, walk: 4 },
};
export const kmh = (v: number): number => v / 3.6;

/** Lift speed in m/s when the data has no ride duration. */
export const LIFT_SPEED: Record<string, number> = {
  gondola: 5,
  cable_car: 8,
  mixed_lift: 4.5,
  chair_lift: 2.5,
  funicular: 6,
  railway: 6,
  rack_railway: 4,
  't-bar': 3,
  'j-bar': 3,
  platter: 3,
  drag_lift: 3,
  rope_tow: 2,
  magic_carpet: 0.8,
};

export type LiftGroup = 'gondola' | 'chair_lift' | 'rail' | 'tbar' | 'platter' | 'rope_tow' | 'magic_carpet';

export const LIFT_GROUPS: Record<LiftGroup, string[]> = {
  gondola: ['gondola', 'cable_car', 'mixed_lift'],
  chair_lift: ['chair_lift'],
  rail: ['funicular', 'railway', 'rack_railway', 'cog_railway'],
  tbar: ['t-bar', 'j-bar', 'drag_lift'],
  platter: ['platter'],
  rope_tow: ['rope_tow'],
  magic_carpet: ['magic_carpet'],
};
export const LIFT_TYPE_GROUP: Record<string, string> = Object.fromEntries(
  Object.entries(LIFT_GROUPS).flatMap(([group, types]) => types.map((t) => [t, group])),
);

export interface RouteOptions {
  /** Run difficulties you want to ski. */
  difficulties: string[];
  /** What to do when there is no route with only these runs. */
  harderRuns: 'never' | 'fallback';
  preferEasier: boolean;
  liftGroups: string[];
  avoidDragLifts: boolean;
  /** Allow riding lifts down (only lifts in `liftDownGroups`). */
  liftDown: boolean;
  liftDownGroups: string[];
  includeConnections: boolean;
  /** m, longest walk between two features that do not touch */
  linkDistance: number;
  /** s, waiting time at every lift */
  liftWait: number;
  speeds: Speeds;
}

/** Options as sent by a client: every field is optional, speeds may be strings. */
export type RouteOptionsInput = Partial<Omit<RouteOptions, 'speeds'>> & { speeds?: Record<string, unknown> };

export const DEFAULT_OPTIONS: RouteOptions = {
  difficulties: ['novice', 'easy'],
  harderRuns: 'fallback', // 'never' | 'fallback'
  preferEasier: true,
  liftGroups: ['gondola', 'chair_lift', 'rail', 'tbar', 'platter', 'rope_tow', 'magic_carpet'],
  avoidDragLifts: false,
  liftDown: false,
  liftDownGroups: ['gondola', 'rail'],
  includeConnections: true,
  linkDistance: 40,
  liftWait: 120,
  speeds: SPEED_PRESETS.beginner,
};

// Merge user options with the defaults and keep the speeds within sane limits.
export function normalizeOptions(options: RouteOptionsInput = {}): RouteOptions {
  const o = { ...DEFAULT_OPTIONS, ...options } as RouteOptions;
  const speeds = { ...DEFAULT_OPTIONS.speeds };
  for (const [k, v] of Object.entries(options.speeds ?? {})) {
    const n = Number(v);
    if (k in speeds && Number.isFinite(n)) speeds[k] = Math.min(100, Math.max(0.5, n));
  }
  o.speeds = speeds;
  return o;
}

export const CLIMB_SPEED = 0.12; // m/s vertical when walking uphill

/** One directed edge of the routing network. */
export interface Edge {
  index: number;
  kind: 'run' | 'lift' | 'link';
  from: number;
  to: number;
  /** m, horizontal */
  length: number;
  /** m, elevation change along the edge */
  dz: number;
  coords: Position[];
  featureId?: string;
  // runs
  difficulty?: string;
  runKind?: 'downhill' | 'connection' | 'connector';
  // lifts
  liftType?: string | null;
  liftGroup?: string;
  /** s, ride time */
  ride?: number;
  stationCount?: number;
  down?: boolean;
  bidirectional?: boolean;
}

// Time in seconds to travel one edge with the user's speeds.
export function edgeTime(e: Edge, o: RouteOptions): number {
  const sp = o.speeds;
  if (e.kind === 'lift') return o.liftWait + (e.ride as number);
  if (e.kind === 'link') return e.length / kmh(sp.walk) + Math.max(0, e.dz) / CLIMB_SPEED;
  if (e.runKind === 'connection' || e.runKind === 'connector') {
    return e.dz > 1 ? e.length / kmh(sp.walk) + e.dz / CLIMB_SPEED : e.length / kmh(sp.connection);
  }
  const speed = sp[e.difficulty === 'extreme' ? 'freeride' : (e.difficulty as string)] ?? sp.unknown;
  return e.length / kmh(speed) + (e.dz > 2 ? e.dz / CLIMB_SPEED : 0); // dz > 0: walking up a two-way run
}
