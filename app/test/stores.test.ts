import { describe, expect, test, vi } from 'vitest';
import { RouteState, pointLetter, pointRole, MAX_POINTS, type Router } from '../src/lib/stores/route.svelte.ts';
import { Settings } from '../src/lib/stores/settings.svelte.ts';
import { UiState } from '../src/lib/stores/ui.svelte.ts';
import { DevState } from '../src/lib/stores/dev.svelte.ts';
import type { RouteResponse } from '../src/lib/worker/engine.ts';

const fakeResult = (n: number) => ({ summary: { distance: n }, steps: [], warnings: [] }) as unknown as RouteResponse;

describe('route state', () => {
  test('letters and roles', () => {
    expect([0, 1, 25, 26, 27].map(pointLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
    expect([pointRole(0, 1), pointRole(0, 3), pointRole(1, 3), pointRole(2, 3)]).toEqual(['start', 'start', 'stop', 'end']);
  });

  test('a map tap adds a point only in plan mode', () => {
    const r = new RouteState();
    expect(r.tap([10, 47])).toBe(false);
    expect(r.points).toEqual([]);
    r.togglePlanMode();
    expect(r.tap([10, 47])).toBe(true);
    expect(r.tap([10.1, 47.1])).toBe(true);
    expect(r.points).toEqual([[10, 47], [10.1, 47.1]]);
    r.togglePlanMode(false);
    expect(r.tap([10.2, 47.2])).toBe(false);
  });

  test('routes after two points, with the newest answer only', async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const resolvers: ((v: RouteResponse) => void)[] = [];
    const router: Router = (points) => {
      calls.push(points.length);
      return new Promise((r) => resolvers.push(r));
    };
    const r = new RouteState({ delay: 10 });
    r.setRouter(router);
    r.addPoint([10, 47]);
    await vi.advanceTimersByTimeAsync(20);
    expect(calls).toEqual([]); // one point: nothing to route
    r.addPoint([10.1, 47.1]);
    r.addPoint([10.2, 47.2]); // debounced: one request for both
    expect(r.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(calls).toEqual([3]);
    r.removePoint(2);
    await vi.advanceTimersByTimeAsync(20);
    expect(calls).toEqual([3, 2]);
    resolvers[1](fakeResult(2));
    resolvers[0](fakeResult(3)); // stale answer arrives last: ignored
    await vi.advanceTimersByTimeAsync(0);
    expect(r.result?.summary.distance).toBe(2);
    expect(r.busy).toBe(false);
    r.clear();
    expect(r.result).toBeNull();
    vi.useRealTimers();
  });

  test('router errors become a message; the next good route clears it', async () => {
    let fail = true;
    const r = new RouteState({ delay: 0 });
    r.setRouter(async () => {
      if (fail) throw new Error('No route for the leg A → B');
      return fakeResult(1);
    });
    r.addPoint([10, 47]);
    r.addPoint([10.1, 47.1]);
    await r.compute();
    expect(r.error).toBe('No route for the leg A → B');
    fail = false;
    r.reverse();
    await r.compute();
    expect(r.error).toBeNull();
    expect(r.result).not.toBeNull();
    expect(r.points).toEqual([[10.1, 47.1], [10, 47]]);
  });

  test('at most MAX_POINTS points; the message goes to the toast (old planner: showError), not to the route', () => {
    const r = new RouteState();
    const notices: string[] = [];
    r.onNotice = (t) => notices.push(t);
    for (let i = 0; i < MAX_POINTS + 2; i++) r.addPoint([i / 100, i / 100]);
    expect(r.points.length).toBe(MAX_POINTS);
    expect(notices).toEqual(['A route can have at most 25 points.', 'A route can have at most 25 points.']);
    expect(r.error).toBeNull();
  });

  test('undo / redo of points and settings, a new change clears redo', () => {
    const r = new RouteState();
    expect(r.canUndo).toBe(false);
    r.addPoint([10, 47]);
    r.addPoint([10.1, 47.1]);
    r.setOptions({ difficulties: ['novice'] });
    expect(r.canUndo).toBe(true);
    expect(r.undo()).toBe(true);
    expect(r.options.difficulties).toEqual(['novice', 'easy']);
    expect(r.canRedo).toBe(true);
    expect(r.undo()).toBe(true);
    expect(r.points).toEqual([[10, 47]]);
    expect(r.redo()).toBe(true);
    expect(r.points).toHaveLength(2);
    r.reverse(); // new change: redo list is gone
    expect(r.canRedo).toBe(false);
    expect(r.redo()).toBe(false);
    expect(r.points).toEqual([[10.1, 47.1], [10, 47]]);
    // undo all the way back to the empty start
    while (r.undo());
    expect(r.points).toEqual([]);
    expect(r.canUndo).toBe(false);
  });

  test('the same state twice is one history step; movePoint and removePoint are undoable', () => {
    const r = new RouteState();
    r.addPoint([10, 47]);
    r.setOptions({ preferEasier: true }); // already the default: no step
    expect(r.history.past).toHaveLength(1);
    r.movePoint(0, [10.5, 47.5]);
    r.removePoint(0);
    r.undo();
    expect(r.points).toEqual([[10.5, 47.5]]);
    r.undo();
    expect(r.points).toEqual([[10, 47]]);
  });

  test('history survives a reload through the stored data, capped at 50 steps', () => {
    const r = new RouteState();
    for (let i = 0; i < 60; i++) r.addPoint([i / 100, 0]) || r.clear();
    const data = r.toData();
    expect(data.history!.past.length).toBeLessThanOrEqual(50);
    const again = new RouteState({ stored: { ...data } });
    expect(again.points).toEqual(r.points);
    expect(again.canUndo).toBe(true);
    again.undo();
    expect(again.points.length).toBe(r.points.length - 1);
  });

  test('saved-route link: changed since saved, clear unlinks, open restores points and settings', () => {
    const r = new RouteState();
    r.openSaved({ id: 'abc', name: 'Gipfel', folder: 'Oberstdorf', points: [[10, 47], [10.1, 47.1]], options: { difficulties: ['novice'], liftWait: 0 } });
    expect(r.savedId).toBe('abc');
    expect(r.routeName).toBe('Gipfel');
    expect(r.options.difficulties).toEqual(['novice']);
    expect(r.options.liftWait).toBe(0);
    expect(r.options.speeds.walk).toBe(3); // missing keys come from the defaults
    expect(r.changedSinceSaved).toBe(false);
    r.addPoint([10.2, 47.2]);
    expect(r.changedSinceSaved).toBe(true);
    r.undo();
    expect(r.changedSinceSaved).toBe(false);
    r.clear();
    expect(r.savedId).toBeNull();
    expect(r.changedSinceSaved).toBe(false);
  });

  test('collapsed legs are remembered by key', () => {
    const r = new RouteState();
    r.toggleLeg('A-B');
    expect(r.isLegCollapsed('A-B')).toBe(true);
    r.toggleLeg('B-C', true);
    r.toggleLeg('A-B');
    expect(r.collapsedLegs).toEqual(['B-C']);
  });

  test('point names are looked up once per position', async () => {
    const r = new RouteState();
    const asked: string[] = [];
    r.setNamer(async (p) => {
      asked.push(p.join(','));
      return p[0] === 10 ? 'Nebelhorn' : null;
    });
    r.addPoint([10, 47]);
    r.addPoint([11, 47]);
    r.reverse();
    await Promise.resolve();
    await Promise.resolve();
    expect(asked).toEqual(['10,47', '11,47']);
    expect(r.nameOf([10, 47])).toBe('Nebelhorn');
    expect(r.nameOf([11, 47])).toBe('');
  });
});

describe('settings', () => {
  test('defaults per build and persistence', () => {
    const store = new Map<string, string>();
    const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const s = new Settings({ online: false }, kv);
    expect(s.online).toBe(false);
    s.setOnline(true);
    s.setResort('mini');
    const again = new Settings({ online: false }, kv);
    expect(again.online).toBe(true);
    expect(again.resortId).toBe('mini');
    expect(new Settings({ online: true }, null).online).toBe(true);
  });

  test('broken stored JSON falls back to defaults', () => {
    const kv = { getItem: () => '{not json', setItem: () => {} };
    expect(new Settings({ online: true }, kv).online).toBe(true);
  });
});

describe('ui state', () => {
  test('tab tap opens, the same tab closes, another tab swaps and keeps the detent', () => {
    const ui = new UiState();
    ui.toggleSheet('route');
    expect(ui.sheet).toBe('route');
    ui.detent = 'large';
    ui.toggleSheet('map');
    expect(ui.sheet).toBe('map');
    expect(ui.detent).toBe('large');
    ui.toggleSheet('map');
    expect(ui.sheet).toBeNull();
    expect(ui.detent).toBe('medium');
  });

  test('toasts with an action stay longer; highlights can time out', () => {
    vi.useFakeTimers();
    const ui = new UiState();
    ui.showToast('Route deleted', { action: { label: 'Undo', run: () => {} } });
    vi.advanceTimersByTime(3500);
    expect(ui.toast?.text).toBe('Route deleted');
    vi.advanceTimersByTime(3000);
    expect(ui.toast).toBeNull();
    ui.setHighlight([[[10, 47], [10.1, 47.1]]], 2000);
    expect(ui.highlight).toHaveLength(1);
    vi.advanceTimersByTime(2001);
    expect(ui.highlight).toBeNull();
    vi.useRealTimers();
  });
});

describe('dev overlay state', () => {
  test('simulated safe areas set the --safe-* properties', () => {
    const d = new DevState();
    expect(d.safeAreaStyle()).toEqual({});
    d.safeArea = true;
    expect(d.safeAreaStyle()).toMatchObject({ '--safe-top': '59px', '--safe-bottom': '34px' });
  });

  test('fake position input', () => {
    const d = new DevState();
    expect(d.setFakePosition('47.4044, 10.2777', '90')).toBeNull();
    expect(d.fakePosition).toEqual({ lat: 47.4044, lon: 10.2777, heading: 90 });
    expect(d.setFakePosition('47.4 10.2', '')).toBeNull();
    expect(d.fakePosition?.heading).toBeNull();
    expect(d.setFakePosition('north', '')).toMatch(/lat, lon/);
    expect(d.setFakePosition('95, 10', '')).toBe('Out of range');
    expect(d.setFakePosition('47, 10', '400')).toMatch(/Heading/);
  });
});
