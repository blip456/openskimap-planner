import { describe, expect, test } from 'vitest';
import {
  DEFAULT_DISPLAY,
  LEGACY_KEY,
  PLANNER_KEY,
  cleanPlannerData,
  loadPlannerData,
  savePlannerData,
} from '../src/lib/stores/planner-persist.ts';
import { DEFAULT_OPTIONS } from '../src/lib/route/options.ts';

function memory(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

/** What the old planner wrote to localStorage["ski-planner-v1"] (copied from a real browser). */
const legacyState = {
  resort: 'oberstdorf-kleinwalsertal',
  options: { ...DEFAULT_OPTIONS, difficulties: ['novice', 'easy', 'intermediate'], liftWait: 60, speeds: { ...DEFAULT_OPTIONS.speeds, easy: 16 } },
  display: { showArrows: false, showDistances: true, showSkiAreas: true, colorBy: 'slope', profileColor: 'steepness', basemap: 'online', terrain3d: true, layers: { downhill: true, lifts: false, nordic: true, other: true } },
  planMode: true,
  points: [[10.2788, 47.4047], [10.2912, 47.3871]],
  routeName: 'Gipfel to Seealpe',
  routeFolder: 'Oberstdorf',
  savedId: '0123456789ab',
  savedSnapshot: '{"points":[[10.2788,47.4047],[10.2912,47.3871]],"options":{}}',
  routeStorage: 'server',
  collapsedLegs: ['A-B'],
  sections: { Runs: true, Lifts: false },
  view: { resort: 'oberstdorf-kleinwalsertal', center: [10.28, 47.39], zoom: 13.2, bearing: 12, pitch: 40 },
  history: { past: ['{"points":[],"options":{}}'], future: [] },
};

describe('planner state in localStorage', () => {
  test('nothing stored: defaults', () => {
    const { data, source } = loadPlannerData(memory());
    expect(source).toBe('new');
    expect(data.points).toEqual([]);
    expect(data.options).toEqual(DEFAULT_OPTIONS);
    expect(data.display).toEqual(DEFAULT_DISPLAY);
    expect(data.planMode).toBe(false);
    expect(data.history).toBeNull();
  });

  test('migration: the old planner state is taken over when ours is missing', () => {
    const kv = memory({ [LEGACY_KEY]: JSON.stringify(legacyState) });
    const { data, source } = loadPlannerData(kv);
    expect(source).toBe('legacy');
    expect(data.resort).toBe('oberstdorf-kleinwalsertal');
    expect(data.points).toEqual(legacyState.points);
    expect(data.options.difficulties).toEqual(['novice', 'easy', 'intermediate']);
    expect(data.options.speeds.easy).toBe(16);
    expect(data.display).toEqual(legacyState.display);
    expect(data.routeStorage).toBe('server');
    expect(data.collapsedLegs).toEqual(['A-B']);
    expect(data.view).toEqual(legacyState.view);
    expect(data.history?.past).toHaveLength(1);
    expect(data.sections).toEqual({ Runs: true, Lifts: false });
    // our key wins once it exists
    savePlannerData(kv, { ...data, routeName: 'New name' });
    expect(loadPlannerData(kv)).toMatchObject({ source: 'stored', data: { routeName: 'New name', version: 1 } });
  });

  test('round trip', () => {
    const kv = memory();
    const data = cleanPlannerData(legacyState);
    expect(savePlannerData(kv, data)).toBe(true);
    expect(JSON.parse(kv.store.get(PLANNER_KEY)!)).toEqual(data);
    expect(loadPlannerData(kv).data).toEqual(data);
  });

  test('bad data never breaks the start-up', () => {
    const cases: unknown[] = ['{not json', 'null', '[]', '42', '"text"', JSON.stringify({ points: 'x', options: [], display: 7, view: { center: 'x' } })];
    for (const raw of cases) {
      const { data } = loadPlannerData(memory({ [PLANNER_KEY]: raw as string }));
      expect(data.points).toEqual([]);
      expect(data.options).toEqual(DEFAULT_OPTIONS);
      expect(data.view).toBeNull();
    }
    const messy = cleanPlannerData({
      points: [[10, 47], [10, 'x'], [999, 47], [NaN, 1], [10.1, 47.1, 1500], null, ...Array.from({ length: 40 }, (_, i) => [i / 10, 0])],
      planMode: 'yes',
      display: { showArrows: 'no', colorBy: 'rainbow', layers: { lifts: false } },
      collapsedLegs: ['A-B', 5, null],
      sections: { ok: true, bad: { nested: 1 }, n: 3 },
      history: { past: ['{"a":1}', 'oops'], future: 'x' },
      view: { resort: 'r', center: [10, 47], zoom: 99, pitch: 120 },
      savedSnapshot: 12,
      routeStorage: 'cloud',
    });
    expect(messy.points[0]).toEqual([10, 47]);
    expect(messy.points[1]).toEqual([10.1, 47.1]);
    expect(messy.points).toHaveLength(25);
    expect(messy.planMode).toBe(false);
    expect(messy.display.showArrows).toBe(true);
    expect(messy.display.colorBy).toBe('difficulty');
    expect(messy.display.layers).toEqual({ downhill: true, lifts: false, nordic: true, other: true });
    expect(messy.collapsedLegs).toEqual(['A-B']);
    expect(messy.sections).toEqual({ ok: true, n: 3 });
    expect(messy.history).toBeNull();
    expect(messy.view).toEqual({ resort: 'r', center: [10, 47], zoom: 22, bearing: 0, pitch: 85 });
    expect(messy.savedSnapshot).toBeNull();
    expect(messy.routeStorage).toBe('browser');
  });

  test('full storage: the history is dropped, then nothing is written; no storage at all is fine', () => {
    let calls = 0;
    const full = {
      getItem: () => null,
      setItem: (_k: string, v: string) => {
        calls++;
        if (JSON.parse(v).history) throw new Error('QuotaExceededError');
      },
    };
    expect(savePlannerData(full, cleanPlannerData(legacyState))).toBe(true);
    expect(calls).toBe(2);
    const broken = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
    expect(savePlannerData(broken, cleanPlannerData(legacyState))).toBe(false);
    expect(savePlannerData(null, cleanPlannerData(legacyState))).toBe(false);
    expect(loadPlannerData(null).source).toBe('new');
  });
});
