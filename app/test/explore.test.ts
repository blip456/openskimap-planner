// Phase 4b logic: info cards, pin actions, explore state, layer filter, base maps (online gating + fallback),
// search rows and the search state, settings persistence, gpx.studio links.
import { describe, expect, test, vi } from 'vitest';
import { featureDetails } from '@core/feature-info.ts';
import { buildSearchIndex, prepareSearchIndex, searchLocal } from '@core/search.ts';
import { LIFT_COLOR } from '@core/ski.ts';
import type { ResortData } from '@core/types.ts';
import miniResort from '../../packages/core/test/fixtures/mini-resort.json';
import {
  applyPinAction,
  featureProfile,
  pinActions,
  pinCardModel,
  placeCardModel,
  skiCardModel,
  steepnessNote,
  tileCardModel,
} from '../src/lib/explore/info-card.ts';
import { DIFFICULTY_LINE_LAYERS, LAYER_GROUPS, layerVisibility, runLabelFilter, skiAreaHaloFilter, visibleRunKinds } from '../src/lib/map/layer-filter.ts';
import {
  BASEMAPS,
  NO_NETWORK,
  basemapChoices,
  demSource,
  effectiveBasemap,
  hasSkiLayers,
  isOnlineUrl,
  labelFont,
  openFreeMapStyle,
  openSnowMapStyle,
  styleFor,
} from '../src/lib/map/basemaps.ts';
import {
  NO_MATCHES,
  OFFLINE_HINT,
  classifyQuery,
  entryItem,
  googleItem,
  moveActive,
  textItems,
  type SearchItem,
} from '../src/lib/search/items.ts';
import { SearchState, type SearchDeps } from '../src/lib/stores/search.svelte.ts';
import { ExploreState } from '../src/lib/stores/explore.svelte.ts';
import { RouteState } from '../src/lib/stores/route.svelte.ts';
import { Settings } from '../src/lib/stores/settings.svelte.ts';
import { DEFAULT_DISPLAY } from '../src/lib/stores/planner-persist.ts';
import { gpxStudioLinks } from '../src/lib/gpx-studio.ts';
import { routeProfilePoints, routeProfileSegments } from '../src/lib/route/profile.ts';
import { buildOverlayStyle, type Style } from '@core/styles/index.ts';
import { shortcutFor } from '../src/lib/keyboard.ts';

const data = miniResort as unknown as ResortData;
const at: [number, number] = [10.001, 47.005];

describe('info cards', () => {
  test('run card: key numbers, details, steepness profile, actions spot', () => {
    const d = featureDetails(data, 'run-red')!;
    const card = skiCardModel(d, at);
    expect(card.kind).toBe('run');
    expect(card.title).toBe('Red Direct');
    expect(card.subtitle).toBe('Red run');
    expect(card.stats.map((s) => s.label)).toEqual(['Length', 'Descent', 'Steepest']);
    expect(card.rows.find((r) => r.label === 'Difficulty')?.value).toBe('Red (intermediate)');
    expect(card.rows.some((r) => r.label === 'Vertical')).toBe(true);
    expect(card.profile?.steps).toHaveLength(1);
    expect(card.profileMode).toBe('steepness');
    expect(card.position).toEqual(at);
    // the chart can draw it: points along the run and slope-coloured slices
    const pts = routeProfilePoints(card.profile!);
    expect(pts.length).toBe(d.geometry.type === 'LineString' ? d.geometry.coordinates.length : 0);
    expect(routeProfileSegments(card.profile!, pts, 'steepness').every((s) => s.key.startsWith('slope-'))).toBe(true);
  });

  test('lift card: subtitle with type, Length · Rise · Ride time, lift rows, profile bottom → top', () => {
    const d = featureDetails(data, 'lift-gondola')!;
    const card = skiCardModel(d, at);
    expect(card.kind).toBe('lift');
    expect(card.title).toBe('Valley Gondola');
    expect(card.subtitle).toMatch(/^Gondola/);
    expect(card.dot).toBe(LIFT_COLOR);
    expect(card.stats.map((s) => s.label).slice(0, 2)).toEqual(['Length', 'Rise']);
    // the fixture lift has no `direction` (only built data has it), so no Direction row; duration 480 s → 8 min
    expect(card.rows.find((r) => r.label === 'Direction')).toBeUndefined();
    expect(card.rows.find((r) => r.label === 'Ride time')?.value).toBe('8 min');
    expect(card.stats.find((s) => s.label === 'Ride time')?.value).toBe('8 min');
    const step = card.profile!.steps[0];
    expect(step.type).toBe('lift');
    expect(step.eleEnd).toBeGreaterThanOrEqual(step.eleStart);
  });

  test('tile fallback and place cards', () => {
    expect(tileCardModel({ liftType: 'chair_lift', name: 'X', occupancy: 6 }, at).subtitle).toBe('Chairlift · 6 seats');
    expect(tileCardModel({ name: '', difficulty: 'easy' }, at).title).toBe('Unnamed run');
    const place = placeCardModel({ name: 'Gipfel', kind: 'peak', elevation: 2224.4 }, at);
    expect(place.subtitle).toBe('Peak · 2224 m');
    expect(place.stats).toEqual([{ label: 'Elevation', value: '2224 m' }]);
  });

  test('pin card shows coordinates and the approximate note', () => {
    const c = pinCardModel({ lat: 47.123456, lon: 10.654321, title: 'Hut', sub: 'Google Maps link', approximate: 'Approximate: …' });
    expect(c.coords).toBe('47.12346, 10.65432');
    expect(c.position).toEqual([10.654321, 47.123456]);
    expect(c.approximate).toBe('Approximate: …');
  });

  test('steepness note compares the official colour with the steepest 30 m', () => {
    // rules: green < 10 %, blue < 25 %, red < 40 %, black above
    expect(steepnessNote('easy', 0.2)).toBeNull();
    expect(steepnessNote('easy', 0.3)?.tone).toBe('steeper');
    expect(steepnessNote('intermediate', 0.08)?.text).toBe('Marked red, but the steepest section is only 8%: by gradient this is a green run.');
    expect(steepnessNote('freeride', 0.9)).toBeNull();
  });

  test('no profile without elevation', () => {
    expect(featureProfile({ type: 'run', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } })).toBeNull();
  });
});

describe('pin actions (old planner pinActions)', () => {
  const a: [number, number] = [1, 1];
  const b: [number, number] = [2, 2];
  const c: [number, number] = [3, 3];
  const p: [number, number] = [9, 9];
  test('labels depend on the number of points; the first is the main one', () => {
    expect(pinActions(0).map((x) => x.label)).toEqual(['Start here']);
    expect(pinActions(1).map((x) => x.label)).toEqual(['Go here (destination)', 'Replace start']);
    expect(pinActions(3).map((x) => x.label)).toEqual(['Set as destination', 'Add as stop', 'Add after destination', 'Replace start']);
    expect(pinActions(2).filter((x) => x.primary)).toHaveLength(1);
  });
  test('what each action does', () => {
    expect(applyPinAction([], 'start', p)).toEqual([p]);
    expect(applyPinAction([a], 'destination', p)).toEqual([a, p]);
    expect(applyPinAction([a], 'replace-start', p)).toEqual([p]);
    expect(applyPinAction([a, b, c], 'set-destination', p)).toEqual([a, b, p]);
    expect(applyPinAction([a, b, c], 'add-stop', p)).toEqual([a, b, p, c]);
    expect(applyPinAction([a, b, c], 'add-after', p)).toEqual([a, b, c, p]);
    expect(applyPinAction([a, b], 'replace-start', p)).toEqual([p, b]);
  });
});

describe('explore state', () => {
  test('a tap on a ski feature shows the tile card at once, then the details; "use" sets a route point', async () => {
    const route = new RouteState({ delay: 0 });
    let resolve!: (v: ReturnType<typeof featureDetails>) => void;
    const onused = vi.fn();
    const ex = new ExploreState({ feature: () => new Promise((r) => (resolve = r)), route, onused });
    const geometry = { type: 'LineString' as const, coordinates: [[10, 47.01], [10.005, 47.0075]] as [number, number][] };
    const p = ex.openFeature({ source: 'ski', layerId: 'ski-runs-downhill', properties: { id: 'run-red', name: 'Red Direct', difficulty: 'intermediate' }, geometry }, at);
    expect(ex.loading).toBe(true);
    expect(ex.card?.title).toBe('Red Direct');
    expect(ex.highlight?.section).toEqual(geometry);
    resolve(featureDetails(data, 'run-red'));
    await p;
    expect(ex.loading).toBe(false);
    expect(ex.card?.stats.length).toBe(3);
    ex.use('start');
    expect(route.points).toEqual([at]);
    expect(ex.card).toBeNull();
    expect(onused).toHaveBeenCalledOnce();
    expect(route.canUndo).toBe(true); // an info card action is undoable
  });

  test('an older answer does not replace a newer card; places need no worker', async () => {
    const route = new RouteState({ delay: 0 });
    let resolve!: (v: ReturnType<typeof featureDetails>) => void;
    const ex = new ExploreState({ feature: () => new Promise((r) => (resolve = r)), route });
    const g = { type: 'Point' as const, coordinates: [10, 47] as [number, number] };
    const first = ex.openFeature({ source: 'ski', layerId: 'ski-lifts', properties: { id: 'lift-gondola', liftType: 'gondola', name: 'Valley Gondola' }, geometry: g }, at);
    await ex.openFeature({ source: 'protomaps', layerId: 'pois', properties: { name: 'Hut', kind: 'alpine_hut' }, geometry: g }, at);
    resolve(featureDetails(data, 'lift-gondola'));
    await first;
    expect(ex.card?.kind).toBe('place');
    expect(ex.card?.subtitle).toBe('Mountain hut');
  });

  test('pins: orange pin + card; close removes both; too many points is refused', () => {
    const route = new RouteState({ delay: 0 });
    const notices: string[] = [];
    route.onNotice = (t) => notices.push(t);
    const onpin = vi.fn();
    const ex = new ExploreState({ feature: async () => null, route, onpin });
    ex.openPin({ lat: 47, lon: 10, title: 'X' });
    expect(ex.pin).toEqual({ lat: 47, lon: 10, title: 'X' });
    expect(onpin).toHaveBeenCalledOnce();
    ex.close();
    expect(ex.pin).toBeNull();
    route.setPoints(Array.from({ length: 25 }, (_, i) => [10 + i / 1000, 47] as [number, number]));
    ex.openPin({ lat: 47, lon: 10.5 });
    ex.use('add-after');
    expect(route.points).toHaveLength(25);
    expect(notices[0]).toMatch(/at most 25/);
    expect(ex.card).not.toBeNull(); // still open: nothing happened
  });
});

describe('layer filter (Map sheet → Show, Run colours)', () => {
  const layers = { downhill: true, lifts: true, nordic: true, other: true };
  test('everything visible by default; steepness swaps the difficulty lines for the slope layer', () => {
    const v = layerVisibility({ layers, colorBy: 'difficulty' });
    expect(Object.values(LAYER_GROUPS).flat().every((id) => v[id])).toBe(true);
    expect(v['ski-runs-slope']).toBe(false);
    const s = layerVisibility({ layers, colorBy: 'slope' });
    for (const id of DIFFICULTY_LINE_LAYERS) expect(s[id]).toBe(false);
    expect(s['ski-runs-slope']).toBe(true);
    expect(s['ski-runs-casing']).toBe(true);
  });
  test('hiding lifts hides every lift layer; hiding runs also hides the slope layer', () => {
    const v = layerVisibility({ layers: { ...layers, lifts: false }, colorBy: 'difficulty' });
    for (const id of LAYER_GROUPS.lifts) expect(v[id]).toBe(false);
    expect(v['ski-runs-downhill']).toBe(true);
    expect(layerVisibility({ layers: { ...layers, downhill: false }, colorBy: 'slope' })['ski-runs-slope']).toBe(false);
  });
  test('run labels and ski-area halos follow the switches', () => {
    expect(visibleRunKinds({ ...layers, nordic: false })).toEqual(['downhill', 'connection', 'skitour', 'sled', 'hike', 'other']);
    expect(runLabelFilter(['==', 'a', 1], { ...layers, downhill: false, other: false })).toEqual(['all', ['==', 'a', 1], ['in', ['get', 'kind'], ['literal', ['nordic']]]]);
    expect(runLabelFilter(undefined, layers)[1]).toBe(true);
    expect(skiAreaHaloFilter(layers)).toBeNull();
    expect(skiAreaHaloFilter({ ...layers, lifts: false })).toEqual(['==', ['get', 'type'], 'run']);
    expect(skiAreaHaloFilter({ ...layers, lifts: false, downhill: false })).toEqual(['==', ['get', 'type'], 'none']);
  });
});

describe('base maps and online mode', () => {
  test('online maps only in online mode (the choice is kept)', () => {
    expect(effectiveBasemap('openfreemap', false)).toBe('local');
    expect(effectiveBasemap('online', true)).toBe('online');
    expect(basemapChoices(false).map((b) => b.id)).toEqual(['local']);
    expect(basemapChoices(true)).toEqual(BASEMAPS);
    expect(hasSkiLayers('online')).toBe(false);
    expect(labelFont('openfreemap')).toEqual(['Noto Sans Bold']);
    expect(isOnlineUrl('https://tiles.opensnowmap.org/pistes/1/2/3.png')).toBe(true);
    expect(isOnlineUrl('pmtiles://ski')).toBe(false);
  });

  test('elevation: local terrain first, Mapterhorn only online', () => {
    expect(demSource(true, false)).toMatchObject({ url: 'pmtiles://terrain' });
    expect(demSource(false, false)).toBeNull();
    expect((demSource(false, true) as { tiles: string[] }).tiles[0]).toMatch(/mapterhorn/);
    expect(openSnowMapStyle(true).sources.dem).toMatchObject({ url: 'pmtiles://terrain' });
  });

  test('OpenFreeMap: ski layers from the local ski tiles, OpenFreeMap fonts, hillshade after water', () => {
    const base: Style = {
      version: 8,
      name: 'liberty',
      center: [0, 0],
      zoom: 1,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
      layers: [{ id: 'background' }, { id: 'water' }, { id: 'waterway_line_label' }, { id: 'place' }],
    };
    const overlay = buildOverlayStyle({ bounds: [10, 47, 10.1, 47.1], urls: { tiles: { ski: 'pmtiles://ski' } } });
    const s = openFreeMapStyle(base, overlay, false);
    expect(s.sources.ski).toMatchObject({ url: 'pmtiles://ski' });
    expect(s.layers[2].id).toBe('hillshade');
    expect(s.layers.findIndex((l) => l.id === 'ski-runs-downhill')).toBeLessThan(s.layers.findIndex((l) => l.id === 'waterway_line_label'));
    const label = s.layers.find((l) => l.id === 'ski-runs-label') as unknown as { layout: Record<string, unknown> };
    expect(label.layout['text-font']).toEqual(['Noto Sans Bold']);
    expect(base.layers).toHaveLength(4); // the cached base style is not changed
  });

  test('styleFor: OpenFreeMap falls back to the offline map when it cannot load', async () => {
    const local = { name: 'local' } as unknown as Style;
    const deps = { local: () => local, overlay: () => buildOverlayStyle({ bounds: [0, 0, 1, 1] }), hasLocalTerrain: true };
    const failed = await styleFor('openfreemap', { ...deps, fetch: async () => Promise.reject(new TypeError('Failed to fetch')) });
    expect(failed.used).toBe('local');
    expect(failed.style).toBe(local);
    expect(failed.warning).toMatch(/OpenFreeMap/);
    expect((await styleFor('local', deps)).used).toBe('local');
    expect((await styleFor('online', deps)).style.name).toBe('OpenStreetMap + OpenSnowMap');
    expect(NO_NETWORK).toBe('No internet. Using the offline map.');
  });
});

describe('search rows', () => {
  const index = prepareSearchIndex(buildSearchIndex(data));
  test('what a query is', () => {
    expect(classifyQuery('  ')).toEqual({ kind: 'empty' });
    expect(classifyQuery('47.3481, 10.2160')).toMatchObject({ kind: 'coords', lat: 47.3481, lon: 10.216 });
    expect(classifyQuery('https://www.google.com/maps?q=47.3,10.2')).toMatchObject({ kind: 'google', precise: true, short: false });
    expect(classifyQuery('https://maps.app.goo.gl/abc')).toMatchObject({ kind: 'google', precise: false, short: true, local: null });
    expect(classifyQuery('Blue')).toEqual({ kind: 'text', text: 'Blue' });
  });
  test('runs pin at the top, lifts at the bottom station; icons per type', () => {
    const items = searchLocal(index, 'valley').map(entryItem);
    const lift = items.find((i) => i.icon === 'cableCar')!;
    expect(lift.sub).toMatch(/pin at the bottom station/);
    expect(lift.pin?.sub).not.toMatch(/pin at/);
    const run = items.find((i) => i.icon === 'mountainSnow')!;
    expect(run.sub).toMatch(/run · pin at the top/);
  });
  test('"Search online" only in online mode; offline adds a hint when nothing is found', () => {
    const hits = searchLocal(index, 'blue');
    expect(textItems('blue', hits, true).items.at(-1)?.online).toBe('blue');
    expect(textItems('blue', hits, false).items.some((i) => i.online)).toBe(false);
    expect(textItems('bl', [], true).items).toEqual([NO_MATCHES]); // online row needs 3 letters
    expect(textItems('zzzz', [], false)).toEqual({ items: [NO_MATCHES], footnote: OFFLINE_HINT });
  });
  test('Google items: approximate notes', () => {
    expect(googleItem({ lat: 47, lon: 10, source: 'nominatim', label: 'Hotel' }).pin?.approximate).toMatch(/looked up in OpenStreetMap/);
    expect(googleItem({ lat: 47, lon: 10, precise: true, label: 'X' }).pin?.approximate).toBeNull();
  });
  test('↑/↓ skip rows that cannot be picked and wrap around', () => {
    const items = [{ disabled: true }, {}, { disabled: true }, {}] as SearchItem[];
    expect(moveActive(items, 1, 1)).toBe(3);
    expect(moveActive(items, 3, 1)).toBe(1);
    expect(moveActive(items, 1, -1)).toBe(3);
    expect(moveActive([{ disabled: true }] as SearchItem[], -1, 1)).toBe(-1);
  });
});

describe('search state', () => {
  const index = prepareSearchIndex(buildSearchIndex(data));
  const make = (over: Partial<SearchDeps> = {}) => {
    const picked: unknown[] = [];
    const deps: SearchDeps = {
      local: async (q) => searchLocal(index, q),
      online: () => false,
      shortLinks: () => false,
      resolve: vi.fn(async () => ({ lat: 47.1, lon: 10.1, label: 'Resolved', precise: true })),
      geocode: vi.fn(async () => [{ name: 'Online hit', sub: 'Somewhere', kind: 'x', lat: 47.2, lon: 10.2 }]),
      pick: (p) => picked.push(p),
      ...over,
    };
    return { s: new SearchState(deps, 0), deps, picked };
  };

  test('name search → pick → pin', async () => {
    const { s, picked } = make();
    s.query = 'gondola';
    await s.run();
    expect(s.items[0].title).toBe('Valley Gondola');
    expect(s.active).toBe(0);
    s.enter();
    await vi.waitFor(() => expect(picked).toHaveLength(1));
    expect(s.items).toEqual([]);
  });

  test('coordinates need no worker', async () => {
    const { s } = make({ local: async () => Promise.reject(new Error('no worker')) });
    s.query = '47.4, 10.25';
    await s.run();
    expect(s.items[0].pin).toMatchObject({ lat: 47.4, lon: 10.25 });
  });

  test('short links: resolved by the desktop server only with the capability, else a clear hint', async () => {
    const pwa = make();
    pwa.s.query = 'https://maps.app.goo.gl/xyz';
    await pwa.s.run();
    expect(pwa.deps.resolve).not.toHaveBeenCalled();
    expect(pwa.s.items[0].error).toBe(true);
    expect(pwa.s.items[0].sub).toMatch(/desktop app/);

    const desk = make({ shortLinks: () => true, online: () => true });
    desk.s.query = 'https://maps.app.goo.gl/xyz';
    await desk.s.run(true); // pasted: picks the result right away
    expect(desk.deps.resolve).toHaveBeenCalledWith('https://maps.app.goo.gl/xyz');
    expect(desk.picked).toEqual([expect.objectContaining({ lat: 47.1, lon: 10.1 })]);
  });

  test('online search only in online mode', async () => {
    const off = make();
    await off.s.activate({ key: 'o', title: '', sub: '', icon: 'globe', color: '', online: 'hut' });
    expect(off.deps.geocode).not.toHaveBeenCalled();
    const on = make({ online: () => true });
    await on.s.activate({ key: 'o', title: '', sub: '', icon: 'globe', color: '', online: 'hut' });
    expect(on.s.items[0].title).toBe('Online hit');
  });

  test('a stale answer is ignored', async () => {
    let release!: () => void;
    const { s } = make({ local: (q) => new Promise((r) => (release = () => r(searchLocal(index, q)))) });
    s.query = 'blue';
    const slow = s.run();
    s.query = '47.4, 10.25';
    await s.run();
    release();
    await slow;
    expect(s.items[0].icon).toBe('crosshair');
  });
});

describe('settings, keyboard, gpx.studio', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  test('online mode and solid interface are saved; defaults per build', () => {
    const kv = memory();
    const a = new Settings({ online: false }, kv);
    expect(a.online).toBe(false);
    expect(a.solid).toBe(false);
    a.setOnline(true);
    a.setSolid(true);
    const b = new Settings({ online: false }, kv);
    expect(b.online).toBe(true);
    expect(b.solid).toBe(true);
    expect(new Settings({ online: true }, memory()).online).toBe(true); // desktop default
  });
  test('the basemap choice and map options are part of the stored display data', () => {
    expect(DEFAULT_DISPLAY.basemap).toBe('local');
    expect(DEFAULT_DISPLAY.layers).toEqual({ downhill: true, lifts: true, nordic: true, other: true });
  });
  test('⌘K / Ctrl+K jumps to the search, also while typing', () => {
    const k = (key: string, o: Partial<KeyboardEvent> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o });
    expect(shortcutFor(k('k', { metaKey: true }), false)).toBe('search');
    expect(shortcutFor(k('k', { ctrlKey: true }), true)).toBe('search');
    expect(shortcutFor(k('k'), false)).toBeNull();
  });
  test('gpx.studio links use the tile server from the capabilities', () => {
    const links = gpxStudioLinks('http://localhost:9000/');
    expect(links).toHaveLength(4);
    expect(links[0].url).toBe('http://localhost:9000/styles/ski-basemap/{z}/{x}/{y}@2x.jpg');
    expect(gpxStudioLinks(null)[3].url).toBe('http://localhost:8080/styles/ski-overlay-steepness/{z}/{x}/{y}@2x.png');
  });
});

describe('profile axis labels and backup counting', async () => {
  const { visibleDistanceTicks, endLabel, distanceTicks, labelWidth } = await import('../src/lib/route/profile.ts');
  const { countBackupRoutes } = await import('../src/lib/saved/stores.ts');
  test('a middle tick label never touches the end label', () => {
    const label = (d: number) => (d === 3600 ? endLabel(3600) : `${d / 1000} km`);
    // 3.6 km on a 280 px plot: "3 km" (centred) would end 46.7 − 12.4 px before "3.6 km" (37.2 px wide) starts
    expect(distanceTicks(3600)).toEqual([0, 1000, 2000, 3000, 3600]);
    expect(visibleDistanceTicks(3600, 280, label)).toEqual([0, 1000, 2000, 3600]);
    // on a wide plot it fits
    expect(visibleDistanceTicks(3600, 600, label)).toEqual([0, 1000, 2000, 3000, 3600]);
    expect(labelWidth('3.6 km')).toBeCloseTo(37.2);
  });
  test('the end label is the real total', () => {
    expect(endLabel(68.4)).toBe('68 m');
    expect(endLabel(3600)).toBe('3.6 km');
    expect(endLabel(4000)).toBe('4 km');
  });
  test('backup files: count usable routes, reject other files', () => {
    const r = { id: 'a', points: [[1, 2]], gpx: '<gpx/>', resort: 'x' };
    expect(countBackupRoutes(JSON.stringify({ routes: [r, { ...r, gpx: null }, r] }))).toBe(2);
    expect(() => countBackupRoutes('not json')).toThrow('not a valid backup');
    expect(() => countBackupRoutes('{"x":1}')).toThrow('not a valid backup');
  });
});
