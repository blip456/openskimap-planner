import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArgError,
  AVG_TERRAIN_TILE_BYTES,
  countTiles,
  estimateTerrain,
  formatBytes,
  parseBuildArgs,
  resolveZoom,
} from '../lib/build-args.mjs';

const settings = { terrainMaxZoom: 14, basemapMaxZoom: 15, skiMaxZoom: 16 };

test('no arguments: zoom comes from resorts.json', () => {
  const a = parseBuildArgs([]);
  assert.deepEqual(a.zoom, { terrain: null, basemap: null, ski: null });
  assert.deepEqual(resolveZoom(a, settings), { terrain: 14, basemap: 15, ski: 16 });
  assert.deepEqual(resolveZoom(a, {}), { terrain: 14, basemap: 15, ski: 16 }); // defaults
});

test('z<N>: terrain N, basemap min(N, 15), ski unchanged', () => {
  assert.deepEqual(resolveZoom(parseBuildArgs(['z12']), settings), { terrain: 12, basemap: 12, ski: 16 });
  assert.deepEqual(resolveZoom(parseBuildArgs(['z15']), settings), { terrain: 15, basemap: 15, ski: 16 });
  assert.deepEqual(resolveZoom(parseBuildArgs(['z18']), settings), { terrain: 18, basemap: 15, ski: 16 });
  assert.deepEqual(resolveZoom(parseBuildArgs(['z1']), settings), { terrain: 1, basemap: 1, ski: 16 });
});

test('long flags override z<N>, which overrides resorts.json', () => {
  const a = parseBuildArgs(['z13', '--basemap-zoom=10', '--ski-zoom=14']);
  assert.deepEqual(resolveZoom(a, settings), { terrain: 13, basemap: 10, ski: 14 });
  const b = parseBuildArgs(['--terrain-zoom=16', 'z12']); // order does not matter
  assert.deepEqual(resolveZoom(b, settings), { terrain: 16, basemap: 12, ski: 16 });
  const c = parseBuildArgs(['--terrain-zoom=17']);
  assert.deepEqual(resolveZoom(c, settings), { terrain: 17, basemap: 15, ski: 16 });
});

test('other flags', () => {
  const a = parseBuildArgs(['--yes', '--refresh', '--refresh-basemap', '--only=ski']);
  assert.equal(a.yes, true);
  assert.equal(a.refresh, true);
  assert.equal(a.refreshBasemap, true);
  assert.equal(a.only, 'ski');
  assert.equal(parseBuildArgs([]).yes, false);
});

test('errors are clear', () => {
  const bad = (argv, re) => assert.throws(() => parseBuildArgs(argv), (e) => e instanceof ArgError && re.test(e.message), argv.join(' '));
  bad(['z0'], /out of range/);
  bad(['z19'], /out of range/);
  bad(['z'], /Unknown zoom/);
  bad(['z12a'], /Unknown zoom/);
  bad(['z1.5'], /Unknown zoom/);
  bad(['z12', 'z13'], /twice/);
  bad(['12'], /Unknown argument/);
  bad(['--terrain-zoom=19'], /out of range/);
  bad(['--terrain-zoom=abc'], /not a whole number/);
  bad(['--terrain-zoom='], /needs a number/);
  bad(['--terrain-zoom'], /needs a number/);
  bad(['--basemap-zoom=16'], /out of range/);
  bad(['--ski-zoom=5'], /out of range/);
  bad(['--bogus'], /Unknown option/);
  bad(['--yes=1'], /does not take a value/);
  bad(['--only=terrain'], /only=ski/);
  assert.throws(() => resolveZoom(parseBuildArgs([]), { terrainMaxZoom: 40 }), ArgError);
});

test('tile estimate', () => {
  // one tile at zoom 0, a 1 degree box near the equator is a few tiles at zoom 8
  const bbox = [10.07804, 47.29991, 10.37744, 47.43978]; // Oberstdorf; measured: z12 = 15 tiles, z13 = 48, z14 = 150
  assert.equal(countTiles([bbox], 0), 1);
  assert.equal(countTiles([bbox], 12), 15);
  assert.equal(countTiles([bbox], 13), 48);
  assert.equal(countTiles([bbox], 14), 150);
  assert.equal(countTiles([bbox, bbox], 14), 300); // upper bound for overlapping resorts
  const est = estimateTerrain([bbox], 14);
  assert.equal(est.perZoom.length, 15);
  assert.equal(est.tiles, 231); // the real z14 extract has 231 tiles
  assert.equal(est.bytes, 231 * AVG_TERRAIN_TILE_BYTES);
  // about 4x more tiles per extra zoom level
  const ratio = estimateTerrain([bbox], 17).tiles / estimateTerrain([bbox], 16).tiles;
  assert.ok(ratio > 3.5 && ratio < 4.5, String(ratio));
  assert.ok(Math.abs(est.bytes - 36_100_688) / 36_100_688 < 0.1, 'within 10% of the real z14 file');
});

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(5 * 1024 ** 2), '5.0 MB');
  assert.equal(formatBytes(1.5 * 1024 ** 3), '1.50 GB');
});
