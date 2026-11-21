import { describe, expect, test } from 'vitest';
import { History, MAX_HISTORY } from '../src/lib/route/history.ts';
import { DEFAULT_OPTIONS, SPEED_PRESETS, activePreset, cleanOptions, toggleIn } from '../src/lib/route/options.ts';
import {
  distanceTicks,
  elevationAxis,
  pointMarks,
  profileLegend,
  routeGradient,
  routeProfilePoints,
  routeProfileSegments,
  sampleAt,
  type ProfileRoute,
} from '../src/lib/route/profile.ts';
import { distanceMarkers, legMeta, markerLabel, stepIcon, stepKind, stepMeta, stepTitle } from '../src/lib/route/steps.ts';
import { shortcutFor } from '../src/lib/keyboard.ts';
import { chooseDetent } from '../src/ui/sheet-physics.ts';
import type { RouteStep } from '@core/routing/index.ts';

const M = 111195.08; // metres per degree of latitude (haversine, R = 6371008.8)

function step(partial: Partial<RouteStep> & Pick<RouteStep, 'type' | 'coordinates'>): RouteStep {
  return {
    featureId: null,
    label: 'Unnamed run',
    difficulty: null,
    runKind: null,
    color: null,
    liftType: null,
    down: false,
    distance: 0,
    duration: 60,
    eleStart: partial.coordinates[0][2] ?? 0,
    eleEnd: partial.coordinates[partial.coordinates.length - 1][2] ?? 0,
    leg: 0,
    ...partial,
  };
}

/** red run (2 pieces: 18 % then 36 %), a chairlift up, a short walk in the second leg */
const route: ProfileRoute & { steps: RouteStep[] } = {
  steps: [
    step({ type: 'run', runKind: 'downhill', difficulty: 'intermediate', color: '#d8251d', label: 'Gipfelabfahrt', coordinates: [[10, 47, 2000], [10, 47.001, 1980], [10, 47.002, 1940]] }),
    step({ type: 'lift', liftType: 'chair_lift', label: 'Koblat', coordinates: [[10, 47.002, 1940], [10, 47.003, 2040]] }),
    step({ type: 'walk', label: 'Walk', leg: 1, coordinates: [[10, 47.003, 2040], [10, 47.0031, 2040]] }),
  ],
  legs: [{ index: 0 }, { index: 1 }],
};

describe('gradient profile', () => {
  const points = routeProfilePoints(route);

  test('profile points: distance along the route, shared boundary points kept per step', () => {
    expect(points.map((p) => p.step)).toEqual([0, 0, 0, 1, 1, 2, 2]);
    expect(points[2].d).toBeCloseTo(0.002 * M, 1);
    expect(points[3].d).toBe(points[2].d);
    expect(points[6].d).toBeCloseTo(0.0031 * M, 1);
  });

  test('average and steepest gradient of the downhill runs only', () => {
    const g = routeGradient(route)!;
    expect(g.avg).toBeCloseTo(60 / (0.002 * M), 4);
    expect(g.max).toBeCloseTo(40 / (0.001 * M), 4);
    expect(routeGradient({ steps: [route.steps[1]], legs: [{ index: 0 }] })).toBeNull();
  });

  test('official colours: one piece per step', () => {
    const segs = routeProfileSegments(route, points, 'official');
    expect(segs.map((s) => [s.from, s.to, s.key, s.color])).toEqual([
      [0, 2, 'intermediate', '#d8251d'],
      [3, 4, 'lift', '#7b1fa2'],
      [5, 6, 'walk', '#5f6b75'],
    ]);
    expect(profileLegend(segs, 'official').map((l) => l.label)).toEqual(['Red', 'Lift', 'Path / walk']);
  });

  test('steepness colours: slices of the downhill runs by measured gradient', () => {
    const segs = routeProfileSegments(route, points, 'steepness');
    expect(segs.map((s) => s.key)).toEqual(['slope-blue', 'slope-red', 'lift', 'walk']);
    expect(segs[0].slope).toBeCloseTo(20 / (0.001 * M), 4);
    expect(profileLegend(segs, 'steepness').map((l) => l.label)).toEqual(['10–25%', '25–40%', 'Path / walk', 'Lift']);
  });

  test('sample under the cursor is interpolated and clamped', () => {
    const segs = routeProfileSegments(route, points, 'official');
    const s = sampleAt(points, segs, 0.0005 * M)!;
    expect(s.e).toBeCloseTo(1990, 5);
    expect(s.lat).toBeCloseTo(47.0005, 6);
    expect(s.step).toBe(0);
    expect(s.slope).toBeCloseTo(60 / (0.002 * M), 4);
    expect(sampleAt(points, segs, -50)!.d).toBe(0);
    expect(sampleAt(points, segs, 1e9)!.step).toBe(2);
    expect(sampleAt(points.slice(0, 1), segs, 0)).toBeNull();
  });

  test('route point marks and axes', () => {
    expect(pointMarks(route, points).map((d) => Math.round(d))).toEqual([0, Math.round(0.003 * M), Math.round(0.0031 * M)]);
    const axis = elevationAxis(points, 3);
    expect(axis.ticks[0]).toBeLessThanOrEqual(1940);
    expect(axis.ticks.at(-1)).toBeGreaterThanOrEqual(2040);
    expect(axis.ticks.length).toBeLessThanOrEqual(4);
    expect(distanceTicks(8412)).toEqual([0, 2500, 5000, 8412]);
    expect(distanceTicks(300)).toEqual([0, 100, 200, 300]);
    expect(distanceTicks(240)).toEqual([0, 100, 240]); // 200 is too close to the end label
  });
});

describe('step texts and distance markers', () => {
  test('titles, meta, kinds and icons as in the old planner', () => {
    const [run, lift, walk] = route.steps;
    expect(stepTitle(run)).toBe('Ski Gipfelabfahrt');
    expect(stepTitle(lift)).toBe('Take Koblat');
    expect(stepTitle({ ...lift, down: true })).toBe('Ride down Koblat');
    expect(stepTitle(walk)).toBe('Walk');
    expect(stepTitle({ ...run, runKind: 'connection' })).toBe('Follow Gipfelabfahrt');
    expect(stepTitle({ ...run, runKind: 'connection', label: 'Unnamed run' })).toBe('Follow the ski path');
    expect(stepTitle({ ...run, runKind: 'connector' })).toBe('Short connection');
    expect(stepMeta({ ...run, distance: 2900, duration: 660 })).toBe('Red (intermediate) · 2.9 km · ↓ 60 m · 2000 → 1940 m · ~11 min');
    expect(stepMeta({ ...lift, distance: 1100, duration: 420 })).toBe('chair lift · 1.1 km · ↑ 100 m · 1940 → 2040 m · ~7 min');
    expect(legMeta({ duration: 1080, distance: 3200, liftCount: 1, descent: 610 })).toBe('~18 min · 3.2 km · 1 lift · ↓ 610 m');
    expect(legMeta({ duration: 30, distance: 80, liftCount: 2, descent: 3 })).toBe('~1 min · 80 m · 2 lifts');
    expect(stepKind(run)).toBe('Red run');
    expect(stepKind(lift)).toBe('Lift');
    expect([run, lift, { ...lift, down: true }, walk].map(stepIcon)).toEqual(['number', 'lift-up', 'lift-down', 'walk']);
  });

  test('distance markers: at most ~12, round steps', () => {
    expect(markerLabel(500)).toBe('500 m');
    expect(markerLabel(2000)).toBe('2 km');
    expect(markerLabel(2500)).toBe('2.5 km');
    const line = Array.from({ length: 101 }, (_, i) => [10, 47 + i * 0.0005] as [number, number]); // ~5.56 km
    const marks = distanceMarkers(line);
    expect(marks.map((m) => m.label)).toEqual(['500 m', '1 km', '1.5 km', '2 km', '2.5 km', '3 km', '3.5 km', '4 km', '4.5 km', '5 km', '5.5 km']);
    expect(marks[1].coordinates[1]).toBeCloseTo(47 + 1000 / M, 6);
    expect(distanceMarkers([[10, 47]])).toEqual([]);
  });
});

describe('route settings', () => {
  test('clean options: defaults for missing or bad values, unknown keys dropped, clamped numbers', () => {
    expect(cleanOptions(null)).toEqual(DEFAULT_OPTIONS);
    expect(cleanOptions('x')).toEqual(DEFAULT_OPTIONS);
    const o = cleanOptions({
      difficulties: ['easy', 'bogus', 'novice'],
      harderRuns: 'maybe',
      preferEasier: 'yes',
      liftGroups: [],
      liftWait: 99999,
      linkDistance: -5,
      speeds: { easy: '30', walk: 'fast', rocket: 500 },
      extra: 1,
    });
    expect(o.difficulties).toEqual(['novice', 'easy']);
    expect(o.harderRuns).toBe('fallback');
    expect(o.preferEasier).toBe(true);
    expect(o.liftGroups).toEqual([]);
    expect(o.liftWait).toBe(30 * 60);
    expect(o.linkDistance).toBe(0);
    expect(o.speeds.easy).toBe(30);
    expect(o.speeds.walk).toBe(DEFAULT_OPTIONS.speeds.walk);
    expect(o.speeds).not.toHaveProperty('rocket');
    expect(o).not.toHaveProperty('extra');
  });

  test('active speed preset (old planner: updatePresetButtons)', () => {
    expect(activePreset(SPEED_PRESETS.beginner)).toBe('beginner');
    expect(activePreset({ ...SPEED_PRESETS.confident })).toBe('confident');
    expect(activePreset({ ...SPEED_PRESETS.confident, walk: 5 })).toBeNull();
    expect(activePreset(DEFAULT_OPTIONS.speeds)).toBe('beginner');
  });

  test('toggle in a list keeps the canonical order', () => {
    const all = ['a', 'b', 'c'];
    expect(toggleIn(['c'], 'a', true, all)).toEqual(['a', 'c']);
    expect(toggleIn(['a', 'c'], 'a', false, all)).toEqual(['c']);
  });
});

describe('undo history', () => {
  test('record, undo, redo, cap, stored data', () => {
    const h = new History('{"n":0}');
    for (let i = 1; i <= MAX_HISTORY + 5; i++) h.record(`{"n":${i}}`);
    expect(h.past).toHaveLength(MAX_HISTORY);
    expect(h.record(h.current)).toBe(false);
    expect(h.undo()).toBe(`{"n":${MAX_HISTORY + 4}}`);
    expect(h.redo()).toBe(`{"n":${MAX_HISTORY + 5}}`);
    expect(h.redo()).toBeNull();
    const again = new History('{"n":99}', { past: ['{"a":1}', 'garbage', 7], future: ['{"b":2}'] });
    expect(again.past).toEqual(['{"a":1}']);
    expect(again.canRedo).toBe(true);
    expect(new History('{}', { past: 'nope' }).canUndo).toBe(false);
  });
});

describe('keyboard and sheet physics', () => {
  const k = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  test('shortcuts', () => {
    expect(shortcutFor(k('z', { metaKey: true }), false)).toBe('undo');
    expect(shortcutFor(k('Z', { metaKey: true, shiftKey: true }), false)).toBe('redo');
    expect(shortcutFor(k('z', { ctrlKey: true }), false)).toBe('undo');
    expect(shortcutFor(k('y', { ctrlKey: true }), false)).toBe('redo');
    expect(shortcutFor(k('z', { ctrlKey: true }), true)).toBeNull(); // inside a text field
    expect(shortcutFor(k('p'), false)).toBe('plan');
    expect(shortcutFor(k('P'), false)).toBe('plan');
    expect(shortcutFor(k('p'), true)).toBeNull();
    expect(shortcutFor(k('Escape'), false)).toBe('escape');
    expect(shortcutFor(k('p', { altKey: true }), false)).toBeNull();
  });

  test('detent from position and velocity', () => {
    const medium = 380;
    expect(chooseDetent(100, 0, medium)).toBe('large');
    expect(chooseDetent(300, 0, medium)).toBe('medium');
    expect(chooseDetent(300, -1.5, medium)).toBe('large'); // quick flick up
    expect(chooseDetent(120, 1.5, medium)).toBe('medium'); // quick flick down from near the top
    expect(chooseDetent(400, 0.5, medium)).toBe('closed');
    expect(chooseDetent(440, 0, medium)).toBe('medium'); // less than 80 px below medium
  });
});
