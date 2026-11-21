// Route settings: labels, defaults and cleaning of stored options. Keys and defaults are the core's
// (`DEFAULT_OPTIONS`, `SPEED_PRESETS`), the same as in the old planner.
import { DEFAULT_OPTIONS, SPEED_PRESETS, type RouteOptions, type SpeedPreset, type Speeds } from '@core/routing/index.ts';
import { RUN_COLORS, CONNECTION_COLOR } from '@core/ski.ts';

export { DEFAULT_OPTIONS, SPEED_PRESETS };
export type { RouteOptions, SpeedPreset, Speeds };

/** Run difficulties with the short labels of the old planner (the colour swatch says the rest). */
export const DIFFICULTY_CHOICES: { key: string; label: string; color: string }[] = [
  { key: 'novice', label: 'Green', color: RUN_COLORS.novice },
  { key: 'easy', label: 'Blue', color: RUN_COLORS.easy },
  { key: 'intermediate', label: 'Red', color: RUN_COLORS.intermediate },
  { key: 'advanced', label: 'Black', color: RUN_COLORS.advanced },
  { key: 'expert', label: 'Black ◆◆', color: RUN_COLORS.expert },
  { key: 'freeride', label: 'Freeride', color: RUN_COLORS.freeride },
  { key: 'unknown', label: 'Unknown', color: RUN_COLORS.unknown },
];

export const LIFT_CHOICES: { key: string; label: string }[] = [
  { key: 'gondola', label: 'Gondola' },
  { key: 'chair_lift', label: 'Chairlift' },
  { key: 'rail', label: 'Train' },
  { key: 'tbar', label: 'T-bar' },
  { key: 'platter', label: 'Button lift' },
  { key: 'rope_tow', label: 'Rope tow' },
  { key: 'magic_carpet', label: 'Magic carpet' },
];

/** Lift types that can be ridden down (old planner: LIFT_DOWN_GROUPS). */
export const LIFT_DOWN_CHOICES = LIFT_CHOICES.filter((l) => ['gondola', 'chair_lift', 'rail'].includes(l.key));

export const SPEED_FIELDS: { key: string; label: string; color: string }[] = [
  ...DIFFICULTY_CHOICES,
  { key: 'connection', label: 'Ski paths', color: CONNECTION_COLOR },
  { key: 'walk', label: 'Walking', color: CONNECTION_COLOR },
];

export const PRESETS: { key: SpeedPreset; label: string }[] = [
  { key: 'beginner', label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'confident', label: 'Confident' },
];

export const LIFT_WAIT_MAX_MIN = 30;
export const LINK_DISTANCE_MAX = 150;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown, allowed: readonly string[], fallback: string[]): string[] =>
  Array.isArray(v) ? allowed.filter((k) => v.includes(k)) : [...fallback];
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function defaultOptions(): RouteOptions {
  return structuredClone(DEFAULT_OPTIONS);
}

/** Stored or imported options → complete, valid options (unknown keys dropped, bad values → defaults). */
export function cleanOptions(raw: unknown): RouteOptions {
  const d = DEFAULT_OPTIONS;
  if (!isObject(raw)) return defaultOptions();
  const num = (v: unknown, fallback: number, lo: number, hi: number): number => {
    const n = Number(v);
    return v === null || v === '' || typeof v === 'boolean' || !Number.isFinite(n) ? fallback : clamp(n, lo, hi);
  };
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const speeds: Speeds = { ...d.speeds };
  if (isObject(raw.speeds)) {
    for (const k of Object.keys(speeds)) {
      const n = Number(raw.speeds[k]);
      if (raw.speeds[k] != null && Number.isFinite(n)) speeds[k] = clamp(n, 1, 100);
    }
  }
  return {
    difficulties: strings(raw.difficulties, DIFFICULTY_CHOICES.map((c) => c.key), d.difficulties),
    harderRuns: raw.harderRuns === 'never' || raw.harderRuns === 'fallback' ? raw.harderRuns : d.harderRuns,
    preferEasier: bool(raw.preferEasier, d.preferEasier),
    liftGroups: strings(raw.liftGroups, LIFT_CHOICES.map((c) => c.key), d.liftGroups),
    avoidDragLifts: bool(raw.avoidDragLifts, d.avoidDragLifts),
    liftDown: bool(raw.liftDown, d.liftDown),
    liftDownGroups: strings(raw.liftDownGroups, LIFT_DOWN_CHOICES.map((c) => c.key), d.liftDownGroups),
    includeConnections: bool(raw.includeConnections, d.includeConnections),
    linkDistance: Math.round(num(raw.linkDistance, d.linkDistance, 0, LINK_DISTANCE_MAX)),
    liftWait: Math.round(num(raw.liftWait, d.liftWait, 0, LIFT_WAIT_MAX_MIN * 60)),
    speeds,
  };
}

/** The preset whose speeds are all equal to `speeds`, or null ("custom"). Old planner: updatePresetButtons. */
export function activePreset(speeds: Speeds): SpeedPreset | null {
  for (const p of PRESETS) {
    const preset = SPEED_PRESETS[p.key];
    if (Object.keys(preset).every((k) => Number(speeds[k]) === preset[k])) return p.key;
  }
  return null;
}

/** Adds or removes one key of a list option, keeping the order of `all`. */
export function toggleIn(list: readonly string[], key: string, on: boolean, all: readonly string[]): string[] {
  return all.filter((k) => (k === key ? on : list.includes(k)));
}
