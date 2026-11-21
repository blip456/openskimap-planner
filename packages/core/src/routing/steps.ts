// Route steps ("take lift X, ski run Y"), their tidying and summaries.
import type { Position } from '../types.ts';
import { DIFFICULTY_LEVEL } from './options.ts';

export type StepType = 'run' | 'lift' | 'walk';

export interface RouteStep {
  type: StepType;
  featureId: string | null;
  label: string;
  difficulty: string | null;
  runKind: string | null;
  color: string | null;
  liftType: string | null;
  down: boolean;
  /** m */
  distance: number;
  /** s */
  duration: number;
  eleStart: number;
  eleEnd: number;
  coordinates: Position[];
  /** index of the leg (A → B is 0) */
  leg: number;
}

/** A step while it is being built: with the merge key and the piste names. */
export interface RawStep extends Omit<RouteStep, 'leg'> {
  key: string;
  names: string[];
}

export interface RouteSummary {
  distance: number;
  runDistance: number;
  liftCount: number;
  duration: number;
  descent: number;
  ascent: number;
}

// OpenStreetMap often splits one signed piste into several sections (sometimes shared with another piste,
// e.g. "15, 17 Talabfahrt Kanzelwand, Schwandlift-Piste"). Turn the raw per-section steps into what you
// would follow on the mountain. A harder piece or a change in difficulty always stays its own step.
const TINY_RUN = 80; // m, unnamed piece that can be folded into its neighbour if it is not harder
const TINY_LINK = 60; // m, connector / walk that can be folded into the neighbouring run

export function tidySteps(raw: RawStep[]): RawStep[] {
  const level = (d: string | null): number => DIFFICULTY_LEVEL[d as string] ?? 2;
  const isRun = (s: RawStep | undefined): s is RawStep =>
    s?.type === 'run' && (s.runKind === 'downhill' || s.runKind === 'connection');
  const isPiste = (s: RawStep | undefined): s is RawStep => s?.type === 'run' && s.runKind === 'downhill';
  const isTinyLink = (s: RawStep): boolean => (s.runKind === 'connector' || s.type === 'walk') && s.distance < TINY_LINK;
  const isTinyUnnamed = (s: RawStep): boolean => isPiste(s) && s.names.length === 0 && s.distance < TINY_RUN;
  const sharesName = (a: RawStep, b: RawStep): boolean => a.names.some((n) => b.names.includes(n));

  const append = (into: RawStep, s: RawStep): void => {
    into.distance += s.distance;
    into.duration += s.duration;
    into.eleEnd = s.eleEnd;
    into.coordinates.push(...s.coordinates.slice(1));
  };
  const prepend = (into: RawStep, s: RawStep): void => {
    into.distance += s.distance;
    into.duration += s.duration;
    into.eleStart = s.eleStart;
    into.coordinates = [...s.coordinates, ...into.coordinates.slice(1)];
  };

  const steps = raw.filter((s) => !(s.type === 'walk' && s.distance < 3));
  for (const s of steps) if (s.runKind === 'connector') s.label = 'Short connection';

  // 1. merge forward into the previous step
  const out: RawStep[] = [];
  for (const s of steps) {
    const prev = out[out.length - 1] as RawStep | undefined;
    const samePiste =
      isRun(prev) &&
      isRun(s) &&
      prev.runKind === s.runKind &&
      prev.difficulty === s.difficulty &&
      (prev.label === s.label || sharesName(prev, s));
    if (samePiste) {
      // prefer the plain piste name over a combined "A, B" section name
      if (prev.names.length > 1 && s.names.length === 1) {
        prev.label = s.label;
        prev.names = s.names;
      }
      append(prev, s);
    } else if (isPiste(prev) && isTinyUnnamed(s) && level(s.difficulty) <= level(prev.difficulty)) {
      append(prev, s);
    } else if (isPiste(prev) && isPiste(s) && s.distance < 30 && level(s.difficulty) <= level(prev.difficulty)) {
      append(prev, s); // tiny section of another piste
    } else if (isRun(prev) && isTinyLink(s)) {
      append(prev, s);
    } else if (prev && (prev.runKind === 'connector' || prev.type === 'walk') && (s.runKind === 'connector' || s.type === 'walk')) {
      prev.label = 'Short connection';
      append(prev, s);
    } else {
      out.push(s);
    }
  }

  // 1b. an unnamed piece between two sections of the same piste belongs to that piste
  for (let i = out.length - 2; i >= 1; i--) {
    const [a, mid, b] = [out[i - 1], out[i], out[i + 1]];
    const sandwiched =
      isPiste(a) &&
      isPiste(b) &&
      isPiste(mid) &&
      mid.names.length === 0 &&
      a.difficulty === b.difficulty &&
      (a.label === b.label || sharesName(a, b)) &&
      level(mid.difficulty) <= level(a.difficulty) &&
      mid.distance < 600;
    if (sandwiched) {
      append(a, mid);
      append(a, b);
      out.splice(i, 2);
    }
  }

  // 2. fold leftover tiny connectors / unnamed pieces into the run that follows (e.g. after a lift)
  for (let i = out.length - 2; i >= 0; i--) {
    const s = out[i];
    const next = out[i + 1];
    const fold = isRun(next) && (isTinyLink(s) || (isTinyUnnamed(s) && level(s.difficulty) <= level(next.difficulty)));
    if (fold) {
      prepend(next, s);
      out.splice(i, 1);
    }
  }
  return out;
}

// Route points are lettered A, B, C… like the markers in the UI.
export function pointLetter(i: number): string {
  return i < 26
    ? String.fromCharCode(65 + i)
    : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
}
export const legName = (i: number): string => `the leg ${pointLetter(i)} → ${pointLetter(i + 1)}`;

export function summarize(steps: readonly RouteStep[]): RouteSummary {
  return {
    distance: steps.reduce((s, x) => s + x.distance, 0),
    runDistance: steps.filter((s) => s.type === 'run').reduce((s, x) => s + x.distance, 0),
    liftCount: steps.filter((s) => s.type === 'lift').length,
    duration: steps.reduce((s, x) => s + x.duration, 0),
    descent: steps.filter((s) => s.type === 'run').reduce((s, x) => s + Math.max(0, x.eleStart - x.eleEnd), 0),
    ascent: steps
      .filter((s) => s.type === 'lift' && !s.down)
      .reduce((s, x) => s + Math.max(0, x.eleEnd - x.eleStart), 0),
  };
}
