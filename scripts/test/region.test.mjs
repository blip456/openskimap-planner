import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBuildArgs, ArgError } from '../lib/build-args.mjs';
import { zipFileName } from '../lib/pwa-package.mjs';
import {
  MAX_SPAN_DEG,
  RegionError,
  checkBbox,
  estimateRegion,
  regionBbox,
  regionBuildArgs,
  regionToResort,
  searchSkiAreas,
  slugify,
  validateRegion,
} from '../lib/region.mjs';

const area = (id, name, coords, extra = {}) => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [coords] },
  properties: { id, name, activities: ['downhill'], places: [{ localized: { en: { country: 'Austria', region: 'Tyrol', locality: null } } }], ...extra },
});
const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];

test('slugify', () => {
  assert.equal(slugify('Lech – Zürs am Arlberg'), 'lech-zurs-am-arlberg');
  assert.equal(slugify('  Söll!! '), 'soll');
  assert.equal(slugify(''), '');
  assert.ok(slugify('x'.repeat(200)).length <= 63);
});

test('a box region is kept as drawn (rounded to about 1 m)', () => {
  const r = validateRegion({ name: 'Lech', bbox: [10.123456789, 47.1, 10.3, 47.25] });
  assert.equal(r.id, 'lech');
  assert.deepEqual(r.bbox, [10.12346, 47.1, 10.3, 47.25]);
  assert.equal(r.marginKm, undefined, 'a box has no margin');
  assert.deepEqual(regionToResort({ ...r, zoom: { terrain: 14 } }), { id: 'lech', name: 'Lech', bbox: [10.12346, 47.1, 10.3, 47.25] });
});

test('a ski area region gets the default margin', () => {
  const r = validateRegion({ id: 'ifen', name: 'Ifen', skiAreas: [{ id: 'abc123', name: 'Skigebiet Ifen' }, 'Some Name'] });
  assert.deepEqual(r.skiAreas, [{ id: 'abc123', name: 'Skigebiet Ifen' }, 'Some Name']);
  assert.equal(r.marginKm, 2);
});

test('zoom is checked and optional', () => {
  assert.deepEqual(validateRegion({ name: 'A', bbox: [1, 1, 2, 2], zoom: { terrain: 15 } }).zoom, { terrain: 15 });
  assert.equal(validateRegion({ name: 'A', bbox: [1, 1, 2, 2], zoom: {} }).zoom, undefined);
  assert.throws(() => validateRegion({ name: 'A', bbox: [1, 1, 2, 2], zoom: { basemap: 16 } }), /Basemap zoom/);
  assert.throws(() => validateRegion({ name: 'A', bbox: [1, 1, 2, 2], zoom: { terrain: 1.5 } }), /Terrain zoom/);
});

test('invalid regions give clear errors', () => {
  const bad = (input, re) => assert.throws(() => validateRegion(input), (e) => e instanceof RegionError && re.test(e.message), JSON.stringify(input));
  bad(null, /Invalid region/);
  bad({ bbox: [1, 1, 2, 2] }, /name/);
  bad({ name: 'A' }, /either a box or a list/);
  bad({ name: 'A', bbox: [1, 1, 2, 2], skiAreas: ['x'] }, /not both/);
  bad({ name: 'A', id: 'Bad Id', bbox: [1, 1, 2, 2] }, /lowercase/);
  bad({ name: 'A', id: '../x', bbox: [1, 1, 2, 2] }, /lowercase/);
  bad({ name: '!!!', bbox: [1, 1, 2, 2] }, /lowercase/); // the name gives no id
  bad({ name: 'A', bbox: [2, 1, 1, 2] }, /empty/);
  bad({ name: 'A', bbox: [1, 1, 2] }, /four numbers/);
  bad({ name: 'A', bbox: [1, 1, 2, 'x'] }, /four numbers/);
  bad({ name: 'A', bbox: [1, 80, 2, 89] }, /outside/);
  bad({ name: 'A', bbox: [1, 1, 1 + MAX_SPAN_DEG + 0.1, 2] }, /too big/);
  bad({ name: 'A', skiAreas: [{ id: '../x' }] }, /Invalid ski area/);
  bad({ name: 'A', skiAreas: ['x'], marginKm: 50 }, /margin/);
});

test('checkBbox accepts the largest allowed box', () => {
  assert.deepEqual(checkBbox([10, 46, 10 + MAX_SPAN_DEG, 46 + MAX_SPAN_DEG]), [10, 46, 12, 48]);
});

test('command line for a region build', () => {
  const r = validateRegion({ name: 'Lech', bbox: [10, 47, 10.2, 47.2], zoom: { terrain: 15, ski: 17 } });
  assert.deepEqual(regionBuildArgs(r, { regionFile: '/b/regions/lech/region.json', outDir: '/b/regions/lech' }), [
    '--region=/b/regions/lech/region.json',
    '--out=/b/regions/lech',
    '--yes',
    '--terrain-zoom=15',
    '--ski-zoom=17',
  ]);
  // and the build scripts understand it
  const parsed = parseBuildArgs(regionBuildArgs(r, { regionFile: 'r.json', outDir: 'out' }));
  assert.equal(parsed.region, 'r.json');
  assert.equal(parsed.out, 'out');
  assert.equal(parsed.yes, true);
  assert.deepEqual(parsed.zoom, { terrain: 15, basemap: null, ski: 17 });
  assert.throws(() => parseBuildArgs(['--region']), (e) => e instanceof ArgError && /needs a path/.test(e.message));
  assert.throws(() => parseBuildArgs(['--out=']), (e) => e instanceof ArgError && /needs a path/.test(e.message));
});

test('a region ZIP is named after the region', () => {
  assert.equal(zipFileName('2026-11-21', 14, 'lech'), 'lech-2026-11-21-z14.zip');
  assert.equal(zipFileName('2026-11-21', 14), 'openskimap-data-2026-11-21-z14.zip');
});

const features = [
  area('a1', 'Skigebiet Ifen', box(10.1, 47.3, 10.15, 47.35), { statistics: { runs: { byActivity: { downhill: { byDifficulty: { easy: { lengthInKm: 10 }, intermediate: { lengthInKm: 14.6 } } } } } } }),
  area('a2', 'Lech Zürs am Arlberg', box(10.1, 47.15, 10.25, 47.25), { statistics: { runs: { byActivity: { downhill: { byDifficulty: { easy: { lengthInKm: 100 } } } } } } }),
  area('a3', 'Zürs Langlauf', box(10.15, 47.15, 10.2, 47.2), { activities: ['nordic'] }),
  area('a4', 'Oberzürs', box(10.15, 47.15, 10.2, 47.2)),
  { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { id: 'a5', name: null } },
];

test('ski area search: accents and case ignored, downhill and name start first', () => {
  const names = searchSkiAreas(features, 'zurs').map((s) => s.name);
  assert.deepEqual(names, ['Lech Zürs am Arlberg', 'Oberzürs', 'Zürs Langlauf']);
  assert.deepEqual(searchSkiAreas(features, 'IFEN skigebiet').map((s) => s.id), ['a1']);
  assert.deepEqual(searchSkiAreas(features, '  '), []);
  assert.equal(searchSkiAreas(features, 'zurs', 1).length, 1);
  const ifen = searchSkiAreas(features, 'ifen')[0];
  assert.equal(ifen.country, 'Austria');
  assert.equal(ifen.downhillKm, 25); // 10 + 14.6, rounded
  assert.deepEqual(ifen.bbox, [10.1, 47.3, 10.15, 47.35]);
});

test('region area: a box as drawn, ski areas with their margin', () => {
  assert.deepEqual(regionBbox({ bbox: [1, 2, 3, 4] }), [1, 2, 3, 4]);
  const b = regionBbox({ skiAreas: [{ id: 'a1' }, 'Oberzürs'], marginKm: 0 }, features);
  assert.deepEqual(b, [10.1, 47.15, 10.2, 47.35]);
  const wide = regionBbox({ skiAreas: [{ id: 'a1' }], marginKm: 2 }, features);
  assert.ok(wide[0] < 10.1 && wide[3] > 47.35);
  assert.equal(regionBbox({ skiAreas: [{ id: 'nope' }] }, features), null);
});

test('size estimate', () => {
  const bbox = [10.07804, 47.29991, 10.37744, 47.43978]; // Oberstdorf: 231 terrain tiles up to z14 (build-args test)
  const est = estimateRegion(bbox, { terrain: 14, basemap: 15, ski: 16 });
  assert.equal(est.terrainTiles, 231);
  assert.ok(est.basemapTiles > est.terrainTiles);
  // about 22.6 km wide and 15.5 km high
  assert.ok(Math.abs(est.widthKm - 22.6) < 0.3, String(est.widthKm));
  assert.ok(Math.abs(est.heightKm - 15.5) < 0.3, String(est.heightKm));
});
